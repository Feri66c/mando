-- MANDO · Migración 7 · Expediente y locación del evento (decisiones 25 y 26).
--
--   1. Expediente: los documentos que el evento necesita (seguridad, permisos, proveedores, logística,
--      administración y eventualidades). La lista sale de config/expediente.json según el tipo de evento,
--      viaja dentro de la plantilla y se copia al evento al crearlo. Cada documento nace pendiente, con plazo
--      contado desde la hora clave. La productora marca «no aplica» lo que ese evento no necesita.
--   2. Recordatorios: las reglas de reloj avisan cuando a un documento le quedan pocos días (Atención),
--      cuando venció (Crítico) y, si es no negociable y el evento ya llegó a su hora clave, Red Flag.
--   3. Locación: punto de encuentro con mapa, quién coordina, transporte y placa, antecedentes del lugar,
--      zonas killer y puntos ciegos.
-- Toda tabla nueva tiene seguridad por fila y su prueba en tests/db. La bitácora sigue sin poder editarse.

-- ---------------------------------------------------------------------------
-- 1 · Esquema
-- ---------------------------------------------------------------------------

alter type log_kind add value if not exists 'requirement_updated';
alter type log_kind add value if not exists 'location_updated';

create table if not exists event_requirements (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  key         text,                                   -- clave del catálogo; null si se agregó a mano
  category    text not null default 'administracion'
              check (category in ('seguridad', 'permisos', 'proveedores', 'logistica', 'administracion', 'eventualidades')),
  title       text not null check (length(trim(title)) > 0),
  mandatory   boolean not null default false,         -- no negociable
  due_at      timestamptz,
  status      text not null default 'pending' check (status in ('pending', 'done', 'not_applicable')),
  owner_id    uuid references profiles(id),           -- quién debe subirlo
  file_path   text,
  file_name   text,
  sha256      text,
  note        text,
  done_by     uuid references profiles(id),
  done_at     timestamptz,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create unique index if not exists event_requirements_key_idx on event_requirements (event_id, key) where key is not null;
create index if not exists event_requirements_event_idx on event_requirements (event_id, status, due_at);

alter table event_requirements enable row level security;
-- Contratos, facturas y seguros son internos: solo el equipo los ve. Se escriben con las funciones de abajo.
drop policy if exists event_requirements_read on event_requirements;
create policy event_requirements_read on event_requirements for select to authenticated
  using (public.is_event_team(event_id));

create table if not exists event_locations (
  event_id          uuid primary key references events(id) on delete cascade,
  meeting_point     text,
  map_url           text,
  coordinator       text,
  coordinator_phone text,
  transport_plate   text,
  transport_detail  text,
  antecedents       jsonb not null default '[]'::jsonb,   -- lo que ya pasó antes en este lugar
  killer_zones      text,
  blind_spots       text,
  updated_by        uuid references profiles(id),
  updated_at        timestamptz not null default now()
);

alter table event_locations enable row level security;
drop policy if exists event_locations_read on event_locations;
create policy event_locations_read on event_locations for select to authenticated
  using (public.is_event_team(event_id));

-- ---------------------------------------------------------------------------
-- 2 · El expediente nace con el evento
-- ---------------------------------------------------------------------------

create or replace function public._seed_event_requirements(p_event uuid, p_template jsonb, p_key_time timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if jsonb_typeof(p_template -> 'documentos') is distinct from 'array' then
    return;
  end if;
  insert into event_requirements (event_id, key, category, title, mandatory, due_at, sort_order)
  select p_event, d.value ->> 'clave',
         coalesce(d.value ->> 'categoria', 'administracion'),
         trim(d.value ->> 'titulo'),
         coalesce((d.value ->> 'no_negociable')::boolean, false),
         case when p_key_time is null then null
              else p_key_time + make_interval(days => coalesce((d.value ->> 'plazo_dias')::int, 0)) end,
         d.ordinality
  from jsonb_array_elements(p_template -> 'documentos') with ordinality d
  where coalesce(trim(d.value ->> 'titulo'), '') <> '' and coalesce(d.value ->> 'clave', '') <> ''
  on conflict do nothing;
end $$;

create or replace function public._events_seed_criteria() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._seed_event_criteria(new.id, new.template);
  perform public._seed_event_requirements(new.id, new.template, new.starts_at);
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Ayudas
-- ---------------------------------------------------------------------------

-- Nivel de quien llama dentro del equipo del evento. Falla si no es del equipo.
create or replace function public._my_level(p_event uuid) returns smallint
language plpgsql stable security definer set search_path = public as $$
declare v_level smallint;
begin
  if auth.uid() is null or p_event is null or not public.is_event_team(p_event) then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  select level into v_level from event_members where event_id = p_event and profile_id = auth.uid();
  return coalesce(v_level, 4);
end $$;

create or replace function public._resolve_requirement_alerts(p_req event_requirements, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._auto_resolve(p_req.event_id, 'documento_pendiente', p_req.id, p_reason, auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Acciones del expediente
-- ---------------------------------------------------------------------------

-- Cualquiera del equipo sube un documento, también después del cierre (facturas, cobranza).
create or replace function public.complete_requirement(
  p_requirement uuid, p_file_path text default null, p_file_name text default null,
  p_sha256 text default null, p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_requirements;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_path text := nullif(trim(coalesce(p_file_path, '')), '');
begin
  select * into v from event_requirements where id = p_requirement for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._my_level(v.event_id);
  if v_path is null and v_note is null then
    raise exception 'Sube el archivo o escribe el dato.' using errcode = '22023';
  end if;
  if v_path is not null and v_path not like v.event_id::text || '/expediente/%' then
    raise exception 'El archivo no pertenece al expediente de este evento.' using errcode = '22023';
  end if;

  update event_requirements
    set status = 'done', file_path = coalesce(v_path, file_path), file_name = case when v_path is null then file_name else nullif(trim(p_file_name), '') end,
        sha256 = case when v_path is null then sha256 else p_sha256 end, note = coalesce(v_note, note),
        done_by = v_me, done_at = now()
    where id = v.id;

  perform public._log(v.event_id, 'requirement_updated',
    format('%s subió «%s» al expediente.', public._actor_name(v_me), v.title),
    1, 'requirement', v.id, jsonb_build_object('status', 'done', 'sha256', p_sha256), false, v_me);
  perform public._resolve_requirement_alerts(v, 'El documento ya está en el expediente.');
end $$;

-- «No aplica» o volver a pendiente: lo deciden los niveles 1 y 2.
create or replace function public.set_requirement_status(p_requirement uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_requirements;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into v from event_requirements where id = p_requirement for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  if public._my_level(v.event_id) > 2 then
    raise exception 'Esto lo decide el productor general o el productor de campo.' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'not_applicable') then
    raise exception 'Estado desconocido.' using errcode = '22023';
  end if;
  if v.status = p_status then
    return;
  end if;
  if p_status = 'not_applicable' and v.mandatory and v_note is null then
    raise exception 'Es no negociable: explica por qué no aplica en este evento.' using errcode = '22023';
  end if;

  update event_requirements set status = p_status, note = coalesce(v_note, note), done_by = v_me, done_at = now() where id = v.id;
  perform public._log(v.event_id, 'requirement_updated',
    format('%s marcó «%s» como %s.', public._actor_name(v_me), v.title,
           case p_status when 'not_applicable' then 'no aplica' else 'pendiente' end),
    1, 'requirement', v.id, jsonb_build_object('status', p_status, 'note', v_note), false, v_me);
  if p_status = 'not_applicable' then
    perform public._resolve_requirement_alerts(v, 'El documento no aplica en este evento.');
  end if;
end $$;

-- Quién debe subirlo y para cuándo. Niveles 1 y 2.
create or replace function public.plan_requirement(p_requirement uuid, p_owner uuid, p_due_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_requirements;
begin
  select * into v from event_requirements where id = p_requirement for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  if public._my_level(v.event_id) > 2 then
    raise exception 'Esto lo decide el productor general o el productor de campo.' using errcode = '42501';
  end if;
  if p_owner is not null and not exists (
    select 1 from event_members where event_id = v.event_id and profile_id = p_owner and role <> 'viewer') then
    raise exception 'Esa persona no es del equipo de este evento.' using errcode = '22023';
  end if;
  if v.owner_id is not distinct from p_owner and v.due_at is not distinct from p_due_at then
    return;
  end if;
  update event_requirements set owner_id = p_owner, due_at = p_due_at where id = v.id;
  perform public._log(v.event_id, 'requirement_updated',
    format('%s dejó «%s» a cargo de %s%s.', public._actor_name(v_me), v.title,
           coalesce(public._actor_name(p_owner), 'nadie'),
           case when p_due_at is null then '' else format(', con plazo hasta el %s', to_char(p_due_at at time zone (select timezone from events where id = v.event_id), 'DD/MM')) end),
    1, 'requirement', v.id, jsonb_build_object('owner', p_owner, 'due_at', p_due_at), false, v_me);
end $$;

create or replace function public.add_requirement(
  p_event uuid, p_title text, p_category text, p_due_at timestamptz default null, p_mandatory boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if public._my_level(p_event) > 2 then
    raise exception 'Esto lo decide el productor general o el productor de campo.' using errcode = '42501';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Escribe el nombre del documento.' using errcode = '22023';
  end if;
  insert into event_requirements (event_id, category, title, mandatory, due_at, sort_order)
  values (p_event, coalesce(nullif(p_category, ''), 'administracion'), trim(p_title), coalesce(p_mandatory, false), p_due_at,
          coalesce((select max(sort_order) from event_requirements where event_id = p_event), 0) + 1)
  returning id into v_id;
  perform public._log(p_event, 'requirement_updated',
    format('%s agregó «%s» al expediente.', public._actor_name(v_me), trim(p_title)),
    1, 'requirement', v_id, '{}'::jsonb, false, v_me);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Recordatorios por reloj
-- ---------------------------------------------------------------------------

-- Una sola alerta por documento, que va subiendo de nivel: por vencer → vencido → no negociable vencido.
create or replace function public._evaluate_requirement_rules(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  e events;
  v_now timestamptz := now();
  v_soon jsonb := public._rule(p_event, 'documento_por_vencer');
  v_late jsonb := public._rule(p_event, 'documento_vencido');
  v_flag jsonb := public._rule(p_event, 'documento_no_negociable_vencido');
  v_days int := public._rule_param(v_soon, 'dias_antes', 2)::int;
  v_before int;
  v_after int;
  v_left int;
  v_who text;
  r event_requirements;
begin
  select * into e from events where id = p_event;
  if not found or e.status = 'closed' then
    return 0;
  end if;
  select count(*) into v_before from log_entries where event_id = p_event and kind = 'alert_raised';

  for r in
    select * from event_requirements
    where event_id = p_event and status = 'pending' and due_at is not null
      and due_at - make_interval(days => v_days) <= v_now
  loop
    v_who := case when r.owner_id is null then '' else format(' Responsable: %s.', public._actor_name(r.owner_id)) end;
    if r.due_at < v_now then
      if r.mandatory and e.starts_at is not null and e.starts_at <= v_now then
        perform public._raise_alert(p_event, coalesce((v_flag ->> 'nivel')::int, 4), 'documento_pendiente',
          format('No negociable sin documento: %s', r.title),
          'El evento ya llegó a su hora clave y el documento no está en el expediente.' || v_who, 'requirement', r.id, null);
      else
        perform public._raise_alert(p_event, coalesce((v_late ->> 'nivel')::int, 3), 'documento_pendiente',
          format('Documento vencido: %s', r.title),
          format('Su plazo era el %s.', to_char(r.due_at at time zone e.timezone, 'DD/MM')) ||
            case when r.mandatory then ' Es un requisito no negociable.' else '' end || v_who, 'requirement', r.id, null);
      end if;
    else
      v_left := ceil(extract(epoch from (r.due_at - v_now)) / 86400)::int;
      perform public._raise_alert(p_event, coalesce((v_soon ->> 'nivel')::int, 2), 'documento_pendiente',
        format('Falta subir: %s', r.title),
        format('%s para su plazo.', case when v_left <= 1 then 'Queda menos de 1 día' else format('Quedan %s días', v_left) end) ||
          case when r.mandatory then ' Es un requisito no negociable.' else '' end || v_who, 'requirement', r.id, null);
    end if;
  end loop;

  select count(*) into v_after from log_entries where event_id = p_event and kind = 'alert_raised';
  return v_after - v_before;
end $$;

create or replace function public.evaluate_clock_rules(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_team(p_event);
  return public._evaluate_clock_rules(p_event) + public._evaluate_requirement_rules(p_event);
end $$;

-- Las reglas de la hoja de ruta corren cerca del evento; las del expediente, desde antes y hasta después.
create or replace function public.run_clock_rules_all() returns int
language plpgsql security definer set search_path = public as $$
declare e record; v_total int := 0;
begin
  for e in
    select id,
           (starts_at is not null and starts_at - interval '1 day' <= now()
            and coalesce(ends_at, starts_at) + interval '1 day' >= now()) as near
    from events
    where status in ('planned', 'live')
  loop
    if e.near then
      v_total := v_total + public._evaluate_clock_rules(e.id);
    end if;
    v_total := v_total + public._evaluate_requirement_rules(e.id);
  end loop;
  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- 6 · Locación
-- ---------------------------------------------------------------------------

-- p_data: meeting_point, map_url, coordinator, coordinator_phone, transport_plate, transport_detail,
--         antecedents (lista de textos), killer_zones, blind_spots. Niveles 1 y 2.
create or replace function public.set_location(p_event uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_url text := nullif(trim(coalesce(p_data ->> 'map_url', '')), '');
  v_antecedents jsonb;
begin
  if public._my_level(p_event) > 2 then
    raise exception 'Esto lo decide el productor general o el productor de campo.' using errcode = '42501';
  end if;
  if (select status from events where id = p_event) = 'closed' then
    raise exception 'El evento está cerrado: ya no acepta cambios.' using errcode = '42501';
  end if;
  if v_url is not null and (v_url !~ '^https://[^[:space:]]+\.[^[:space:]]+$' or length(v_url) > 500) then
    raise exception 'Pega el enlace del mapa completo, empezando con https://' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(trim(a.value)), '[]'::jsonb) into v_antecedents
  from jsonb_array_elements_text(case when jsonb_typeof(p_data -> 'antecedents') = 'array' then p_data -> 'antecedents' else '[]'::jsonb end) a
  where trim(a.value) <> '';
  if jsonb_array_length(v_antecedents) > 10 then
    raise exception 'Deja como máximo 10 antecedentes.' using errcode = '22023';
  end if;

  insert into event_locations (event_id, meeting_point, map_url, coordinator, coordinator_phone, transport_plate,
                               transport_detail, antecedents, killer_zones, blind_spots, updated_by, updated_at)
  values (p_event,
          nullif(trim(coalesce(p_data ->> 'meeting_point', '')), ''), v_url,
          nullif(trim(coalesce(p_data ->> 'coordinator', '')), ''),
          nullif(regexp_replace(coalesce(p_data ->> 'coordinator_phone', ''), '[^0-9+]', '', 'g'), ''),
          nullif(upper(trim(coalesce(p_data ->> 'transport_plate', ''))), ''),
          nullif(trim(coalesce(p_data ->> 'transport_detail', '')), ''),
          v_antecedents,
          nullif(trim(coalesce(p_data ->> 'killer_zones', '')), ''),
          nullif(trim(coalesce(p_data ->> 'blind_spots', '')), ''),
          v_me, now())
  on conflict (event_id) do update set
    meeting_point = excluded.meeting_point, map_url = excluded.map_url, coordinator = excluded.coordinator,
    coordinator_phone = excluded.coordinator_phone, transport_plate = excluded.transport_plate,
    transport_detail = excluded.transport_detail, antecedents = excluded.antecedents,
    killer_zones = excluded.killer_zones, blind_spots = excluded.blind_spots,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  perform public._log(p_event, 'location_updated',
    format('%s actualizó los datos de la locación.', public._actor_name(v_me)),
    1, 'event', p_event, '{}'::jsonb, false, v_me);
end $$;

-- ---------------------------------------------------------------------------
-- 7 · Archivos del expediente, permisos y tiempo real
-- ---------------------------------------------------------------------------

-- Los archivos del expediente van al mismo cubo privado, en <evento>/expediente/. Los sube el equipo,
-- también con el evento cerrado (facturas y cobranza llegan después). Leerlos sigue siendo solo del equipo.
create or replace function public.can_upload_requirement_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 2) <> 'expediente' or split_part(p_name, '/', 3) = '' then
    return false;
  end if;
  return public.is_event_team(split_part(p_name, '/', 1)::uuid);
end $$;

revoke execute on function public.can_upload_requirement_file(text) from public, anon;
grant execute on function public.can_upload_requirement_file(text) to authenticated;

revoke execute on function public._seed_event_requirements(uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public._my_level(uuid) from public, anon, authenticated;
revoke execute on function public._resolve_requirement_alerts(event_requirements, text) from public, anon, authenticated;
revoke execute on function public._evaluate_requirement_rules(uuid) from public, anon, authenticated;
revoke execute on function public.run_clock_rules_all() from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.complete_requirement(uuid, text, text, text, text)',
    'public.set_requirement_status(uuid, text, text)',
    'public.plan_requirement(uuid, uuid, timestamptz)',
    'public.add_requirement(uuid, text, text, timestamptz, boolean)',
    'public.evaluate_clock_rules(uuid)',
    'public.set_location(uuid, jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists expediente_files_insert on storage.objects;
    create policy expediente_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'evidences' and public.can_upload_requirement_file(name));
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table event_requirements; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table event_locations; exception when duplicate_object then null; end;
  end if;
end $$;
