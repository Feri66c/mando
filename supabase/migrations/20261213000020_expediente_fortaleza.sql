-- MANDO · Expediente como fortaleza (decisiones 74 a 77)
--
-- 1 · Tope de los documentos: lo que se pide antes del evento vence, como máximo, 48 horas antes de la hora clave.
-- 2 · Declaración jurada: quien sube un documento declara que es veraz y queda registrado con su hora.
-- 3 · Línea legal: con responsable asignado, solo esa persona sube el documento y solo el backend lo cambia o lo quita.
-- 4 · Presión: MANDO anota en la bitácora cuando a un documento le quedan 15, 7, 3 y 2 días, y cuando vence.
--
-- Es seguro ejecutarla más de una vez.

alter table event_requirements add column if not exists sworn_at timestamptz;      -- cuándo se declaró que el documento es veraz
alter table event_requirements add column if not exists pressure_mark int;         -- último umbral de presión anotado (días); 0 = vencido

-- ---------------------------------------------------------------------------
-- 1 · Tope: 48 horas antes de la hora clave (la plantilla del evento puede traer otro número)
-- ---------------------------------------------------------------------------

create or replace function public._requirement_cap(p_event uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select starts_at - make_interval(hours => coalesce(nullif(template ->> 'tope_documentos_horas', '')::int, 48))
  from events where id = p_event
$$;

create or replace function public._seed_event_requirements(p_event uuid, p_template jsonb, p_key_time timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cap timestamptz := p_key_time - make_interval(hours => coalesce(nullif(p_template ->> 'tope_documentos_horas', '')::int, 48));
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
              -- lo que se pide antes del evento nunca vence después del tope
              when coalesce((d.value ->> 'plazo_dias')::int, 0) <= 0
                then least(p_key_time + make_interval(days => coalesce((d.value ->> 'plazo_dias')::int, 0)), v_cap)
              else p_key_time + make_interval(days => (d.value ->> 'plazo_dias')::int) end,
         d.ordinality
  from jsonb_array_elements(p_template -> 'documentos') with ordinality d
  where coalesce(trim(d.value ->> 'titulo'), '') <> '' and coalesce(d.value ->> 'clave', '') <> ''
  on conflict do nothing;
end $$;

-- Documentos pendientes de eventos ya creados: los que vencían entre el tope y la hora clave pasan al tope.
update event_requirements r
  set due_at = public._requirement_cap(r.event_id)
  from events e
  where e.id = r.event_id and r.status = 'pending' and e.starts_at is not null and e.status <> 'closed'
    and r.due_at > public._requirement_cap(r.event_id) and r.due_at <= e.starts_at;

-- ---------------------------------------------------------------------------
-- 2 y 3 · Subir con declaración jurada; con responsable asignado, solo esa persona
-- ---------------------------------------------------------------------------

drop function if exists public.complete_requirement(uuid, text, text, text, text);
create or replace function public.complete_requirement(
  p_requirement uuid, p_file_path text default null, p_file_name text default null,
  p_sha256 text default null, p_note text default null, p_sworn boolean default false
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
  if v.owner_id is not null and v.owner_id <> v_me then
    raise exception 'Este documento está a cargo de %. Solo esa persona lo sube; el backend puede cambiar al responsable.',
      public._actor_name(v.owner_id) using errcode = '42501';
  end if;
  if v_path is null and v_note is null then
    raise exception 'Sube el archivo o escribe el dato.' using errcode = '22023';
  end if;
  if v_path is not null and v_path not like v.event_id::text || '/expediente/%' then
    raise exception 'El archivo no pertenece al expediente de este evento.' using errcode = '22023';
  end if;
  if not coalesce(p_sworn, false) then
    raise exception 'Falta tu declaración jurada: confirma que el documento es veraz y está verificado.' using errcode = '22023';
  end if;

  update event_requirements
    set status = 'done', file_path = coalesce(v_path, file_path), file_name = case when v_path is null then file_name else nullif(trim(p_file_name), '') end,
        sha256 = case when v_path is null then sha256 else p_sha256 end, note = coalesce(v_note, note),
        done_by = v_me, done_at = now(), sworn_at = now()
    where id = v.id;

  perform public._log(v.event_id, 'requirement_updated',
    format('%s subió «%s» al expediente y lo visó bajo declaración jurada.', public._actor_name(v_me), v.title),
    1, 'requirement', v.id, jsonb_build_object('status', 'done', 'sha256', p_sha256, 'sworn', true), false, v_me);
  perform public._resolve_requirement_alerts(v, 'El documento ya está en el expediente.');
end $$;

-- Responsable y plazo. Niveles 1 y 2 asignan; una vez asignado, solo el backend lo cambia o lo quita.
create or replace function public.plan_requirement(p_requirement uuid, p_owner uuid, p_due_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_requirements;
  e events;
  v_cap timestamptz;
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
  -- La línea legal no se quiebra: el responsable ya asignado solo lo cambia el backend.
  if v.owner_id is not null and v.owner_id is distinct from p_owner and not public.is_event_backend(v.event_id) then
    raise exception 'Este documento ya tiene responsable (%). Solo el backend puede cambiarlo o quitarlo.',
      public._actor_name(v.owner_id) using errcode = '42501';
  end if;
  -- Tope: lo que se pide antes del evento vence, como máximo, 48 horas antes.
  select * into e from events where id = v.event_id;
  v_cap := public._requirement_cap(v.event_id);
  -- Si se eligió el mismo día del tope, vale la hora del tope.
  if p_due_at is not null and v_cap is not null and p_due_at > v_cap
     and (p_due_at at time zone e.timezone)::date = (v_cap at time zone e.timezone)::date then
    p_due_at := v_cap;
  end if;
  if p_due_at is not null and v_cap is not null and p_due_at is distinct from v.due_at
     and p_due_at > v_cap and (v.due_at is null or v.due_at <= e.starts_at) then
    raise exception 'El plazo tope de los documentos es 48 horas antes del evento: hasta el %.',
      to_char(v_cap at time zone e.timezone, 'DD/MM HH24:MI') using errcode = '22023';
  end if;

  update event_requirements
    set owner_id = p_owner, due_at = p_due_at,
        pressure_mark = case when p_due_at is distinct from v.due_at then null else pressure_mark end
    where id = v.id;
  perform public._log(v.event_id, 'requirement_updated',
    case when v.owner_id is not null and v.owner_id is distinct from p_owner
      then format('%s cambió al responsable de «%s»: era %s y ahora es %s.', public._actor_name(v_me), v.title,
                  public._actor_name(v.owner_id), case when p_owner is null then 'quien lo suba' else public._actor_name(p_owner) end)
      else format('%s dejó «%s» a cargo de %s%s.', public._actor_name(v_me), v.title,
                  case when p_owner is null then 'quien lo suba' else public._actor_name(p_owner) end,
                  case when p_due_at is null then '' else format(', con plazo hasta el %s', to_char(p_due_at at time zone e.timezone, 'DD/MM')) end)
    end,
    1, 'requirement', v.id, jsonb_build_object('owner', p_owner, 'previous_owner', v.owner_id, 'due_at', p_due_at), false, v_me);
end $$;

create or replace function public.add_requirement(
  p_event uuid, p_title text, p_category text, p_due_at timestamptz default null, p_mandatory boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  e events;
  v_cap timestamptz;
begin
  if public._my_level(p_event) > 2 then
    raise exception 'Esto lo decide el productor general o el productor de campo.' using errcode = '42501';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Escribe el nombre del documento.' using errcode = '22023';
  end if;
  select * into e from events where id = p_event;
  v_cap := public._requirement_cap(p_event);
  if p_due_at is not null and v_cap is not null and p_due_at > v_cap
     and (p_due_at at time zone e.timezone)::date = (v_cap at time zone e.timezone)::date then
    p_due_at := v_cap;
  end if;
  if p_due_at is not null and v_cap is not null and p_due_at > v_cap and p_due_at <= coalesce(e.ends_at, e.starts_at) then
    raise exception 'El plazo tope de los documentos es 48 horas antes del evento: hasta el %.',
      to_char(v_cap at time zone e.timezone, 'DD/MM HH24:MI') using errcode = '22023';
  end if;
  insert into event_requirements (event_id, category, title, mandatory, due_at, sort_order)
  values (p_event, coalesce(nullif(p_category, ''), 'administracion'), trim(p_title), coalesce(p_mandatory, false),
          coalesce(p_due_at, v_cap), -- sin fecha, vale el tope
          coalesce((select max(sort_order) from event_requirements where event_id = p_event), 0) + 1)
  returning id into v_id;
  perform public._log(p_event, 'requirement_updated',
    format('%s agregó «%s» al expediente.', public._actor_name(v_me), trim(p_title)),
    1, 'requirement', v_id, '{}'::jsonb, false, v_me);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Presión en la bitácora: 15, 7, 3 y 2 días, y al vencer. Una sola anotación por umbral.
-- ---------------------------------------------------------------------------

create or replace function public._log_requirement_pressure(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  e events;
  v_now timestamptz := now();
  v_steps int[];
  v_left numeric;
  v_mark int;
  v_count int := 0;
  r event_requirements;
begin
  select * into e from events where id = p_event;
  if not found or e.status = 'closed' then
    return 0;
  end if;
  select coalesce(array_agg(x::int order by x::int desc), array[15, 7, 3, 2]) into v_steps
    from jsonb_array_elements_text(case when jsonb_typeof(e.template -> 'presion_dias') = 'array' then e.template -> 'presion_dias' else '[]'::jsonb end) x;
  if v_steps is null or cardinality(v_steps) = 0 then
    v_steps := array[15, 7, 3, 2];
  end if;

  for r in select * from event_requirements where event_id = p_event and status = 'pending' and due_at is not null for update loop
    v_left := extract(epoch from (r.due_at - v_now)) / 86400;
    if v_left < 0 then
      v_mark := 0;
    else
      select min(s) into v_mark from unnest(v_steps) s where v_left <= s;
    end if;
    if v_mark is null or (r.pressure_mark is not null and r.pressure_mark <= v_mark) then
      continue;
    end if;
    update event_requirements set pressure_mark = v_mark where id = r.id;
    perform public._log(p_event, 'requirement_updated',
      format('Presión: %s%s%s',
        case when v_mark = 0 then format('«%s» pasó su plazo del %s y sigue sin subirse.', r.title, to_char(r.due_at at time zone e.timezone, 'DD/MM'))
             when ceil(v_left) <= 1 then format('a «%s» le queda menos de 1 día de plazo.', r.title)
             else format('a «%s» le quedan %s días de plazo.', r.title, ceil(v_left)::int) end,
        case when r.mandatory then ' Es no negociable.' else '' end,
        case when r.owner_id is null then ' Aún no tiene responsable.' else format(' Responsable: %s.', public._actor_name(r.owner_id)) end),
      case when v_mark = 0 then 3 else 2 end, 'requirement', r.id,
      jsonb_build_object('pressure', v_mark, 'due_at', r.due_at), false, null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.evaluate_clock_rules(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_team(p_event);
  perform public._log_requirement_pressure(p_event);
  return public._evaluate_clock_rules(p_event) + public._evaluate_requirement_rules(p_event);
end $$;

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
    perform public._log_requirement_pressure(e.id);
    v_total := v_total + public._evaluate_requirement_rules(e.id);
  end loop;
  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'public._requirement_cap(uuid)', 'public._log_requirement_pressure(uuid)',
    'public._seed_event_requirements(uuid, jsonb, timestamptz)', 'public.run_clock_rules_all()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.complete_requirement(uuid, text, text, text, text, boolean)',
    'public.plan_requirement(uuid, uuid, timestamptz)',
    'public.add_requirement(uuid, text, text, timestamptz, boolean)',
    'public.evaluate_clock_rules(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Último minuto (decisión 80): lo que llega a última hora queda en la bitácora, con su comprobante
-- ---------------------------------------------------------------------------

alter table evidences drop constraint if exists evidences_tag_check;
alter table evidences add constraint evidences_tag_check check (tag in ('wow', 'eventualidad', 'ultimo_minuto'));

-- `p_kind` es la clave del tipo (config/ultimo-minuto.json) y `p_label` su nombre para la bitácora.
create or replace function public.last_minute(
  p_event uuid, p_kind text, p_label text, p_note text, p_file_path text default null,
  p_sha256 text default null, p_captured_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_path text := nullif(trim(coalesce(p_file_path, '')), '');
  v_label text := nullif(trim(coalesce(p_label, '')), '');
  v_id uuid;
begin
  perform public._require_team(p_event);
  if p_kind is null or p_kind !~ '^[a-z][a-z0-9-]{1,30}$' or v_label is null or length(v_label) > 60 then
    raise exception 'Elige qué quieres ingresar de último minuto.' using errcode = '22023';
  end if;
  if v_note is null then
    raise exception 'Cuenta en una línea qué llegó de último minuto.' using errcode = '22023';
  end if;
  if length(v_note) > 500 then
    raise exception 'La nota es muy larga.' using errcode = '22023';
  end if;

  v_id := public.add_evidence(
    p_event => p_event,
    p_kind => (case when v_path is null then 'note' when v_path ~* '\.(jpe?g|png|webp|heic|heif|gif)$' then 'photo' else 'document' end)::evidence_kind,
    p_file_path => v_path, p_note => format('%s: %s', v_label, v_note), p_sha256 => p_sha256, p_captured_at => p_captured_at,
    p_visible => false);
  update evidences set tag = 'ultimo_minuto' where id = v_id;

  perform public._log(p_event, 'moment_marked',
    format('Último minuto · %s: %s (%s%s)', v_label, v_note, public._actor_name(v_me),
           case when v_path is null then '' else ', con comprobante' end),
    2, 'evidence', v_id, jsonb_build_object('tag', 'ultimo_minuto', 'kind', p_kind, 'with_file', v_path is not null), false, v_me);
  return v_id;
end $$;

revoke execute on function public.last_minute(uuid, text, text, text, text, text, timestamptz) from public, anon;
grant execute on function public.last_minute(uuid, text, text, text, text, text, timestamptz) to authenticated, service_role;
