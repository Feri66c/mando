-- MANDO · Migración 8 · Aprobaciones del cliente (decisiones 28 y 29).
--
--   1. Elementos base: casting, uniforme, utilería y referencias visuales. La productora sube cada elemento
--      con su foto; el cliente lo aprueba o pide un cambio, en vivo. Cada decisión queda en la bitácora.
--   2. Grupos por evento: salen del tipo de evento (config/aprobaciones.json) y la productora los ajusta
--      según el brief.
--   3. Sin todo aprobado no se empieza: mientras un grupo prendido no tenga elementos o quede algo sin
--      aprobar, las piezas clave del evento no se pueden marcar como empezadas.
-- Toda tabla nueva tiene seguridad por fila y su prueba en tests/db. La bitácora sigue sin poder editarse.

-- ---------------------------------------------------------------------------
-- 1 · Esquema
-- ---------------------------------------------------------------------------

alter type log_kind add value if not exists 'approval_updated';

alter table events add column if not exists approval_groups text[] not null default '{}';

create table if not exists event_approvals (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  group_key   text not null check (group_key in ('casting', 'uniforme', 'utileria', 'referencias')),
  code        text not null,                           -- código corto: C-01, U-02...
  name        text not null check (length(trim(name)) > 0),
  detail      text,
  file_path   text,
  sha256      text,
  version     int not null default 1,                  -- sube cada vez que se reemplaza
  status      text not null default 'pending' check (status in ('pending', 'approved', 'changes_requested')),
  decision_note text,
  decided_by  uuid references profiles(id),
  decided_at  timestamptz,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  removed_at  timestamptz,
  unique (event_id, code)
);
create index if not exists event_approvals_event_idx on event_approvals (event_id, group_key, created_at);

alter table event_approvals enable row level security;
-- El cliente es quien aprueba: todo miembro del evento ve los elementos. Se escriben con las funciones de abajo.
drop policy if exists event_approvals_read on event_approvals;
create policy event_approvals_read on event_approvals for select to authenticated
  using (public.is_event_member(event_id));

-- ---------------------------------------------------------------------------
-- 2 · Los grupos nacen con el evento
-- ---------------------------------------------------------------------------

create or replace function public._events_seed_criteria() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._seed_event_criteria(new.id, new.template);
  perform public._seed_event_requirements(new.id, new.template, new.starts_at);
  if jsonb_typeof(new.template -> 'aprobaciones') = 'array' then
    update events set approval_groups = coalesce((
      select array_agg(a.value ->> 'clave' order by a.ordinality)
      from jsonb_array_elements(new.template -> 'aprobaciones') with ordinality a
      where a.value ->> 'clave' in ('casting', 'uniforme', 'utileria', 'referencias')
    ), '{}') where id = new.id;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Acciones de la productora (niveles 1 a 3)
-- ---------------------------------------------------------------------------

create or replace function public._approval_prefix(p_group text) returns text
language sql immutable as $$
  select case p_group when 'casting' then 'C' when 'uniforme' then 'U' when 'utileria' then 'T' when 'referencias' then 'R' end
$$;

create or replace function public._check_approval_file(p_event uuid, p_path text) returns void
language plpgsql immutable as $$
begin
  if p_path is not null and p_path not like p_event::text || '/aprobaciones/%' then
    raise exception 'La foto no pertenece a las aprobaciones de este evento.' using errcode = '22023';
  end if;
end $$;

-- Qué grupos pide este evento, según el brief. Niveles 1 y 2.
create or replace function public.set_approval_groups(p_event uuid, p_groups text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_groups text[];
begin
  if public._my_level(p_event) > 2 then
    raise exception 'Esto lo decide el productor general o el productor de campo.' using errcode = '42501';
  end if;
  perform public._require_team(p_event);
  select coalesce(array_agg(g order by array_position(array['casting', 'uniforme', 'utileria', 'referencias'], g)), '{}')
    into v_groups
  from (select distinct unnest(coalesce(p_groups, '{}')) as g) x
  where g in ('casting', 'uniforme', 'utileria', 'referencias');
  if v_groups = (select approval_groups from events where id = p_event) then
    return;
  end if;
  update events set approval_groups = v_groups where id = p_event;
  perform public._log(p_event, 'approval_updated',
    format('%s definió lo que el cliente aprueba antes de empezar: %s.', public._actor_name(v_me),
           case when cardinality(v_groups) = 0 then 'nada' else array_to_string(v_groups, ', ') end),
    1, 'event', p_event, jsonb_build_object('groups', v_groups), true, v_me);
end $$;

create or replace function public.add_approval_item(
  p_event uuid, p_group text, p_name text, p_detail text default null, p_file_path text default null, p_sha256 text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_n int;
  v_code text;
  v_path text := nullif(trim(coalesce(p_file_path, '')), '');
begin
  perform public._require_coordinator(p_event);
  if public._approval_prefix(p_group) is null then
    raise exception 'Grupo desconocido.' using errcode = '22023';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Escribe el nombre del elemento.' using errcode = '22023';
  end if;
  perform public._check_approval_file(p_event, v_path);
  perform 1 from events where id = p_event for update;   -- un código a la vez
  select count(*) + 1 into v_n from event_approvals where event_id = p_event and group_key = p_group;
  v_code := public._approval_prefix(p_group) || '-' || lpad(v_n::text, 2, '0');

  insert into event_approvals (event_id, group_key, code, name, detail, file_path, sha256, created_by)
  values (p_event, p_group, v_code, trim(p_name), nullif(trim(coalesce(p_detail, '')), ''), v_path, p_sha256, v_me)
  returning id into v_id;
  perform public._log(p_event, 'approval_updated',
    format('%s subió %s «%s» para aprobación.', public._actor_name(v_me), v_code, trim(p_name)),
    1, 'approval', v_id, jsonb_build_object('group', p_group, 'status', 'pending'), true, v_me);
  return v_id;
end $$;

-- Reemplazar vuelve el elemento a «por aprobar». p_action: 'replace' | 'remove'.
create or replace function public.update_approval_item(
  p_item uuid, p_action text, p_name text default null, p_detail text default null,
  p_file_path text default null, p_sha256 text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_approvals;
  v_path text := nullif(trim(coalesce(p_file_path, '')), '');
begin
  select * into v from event_approvals where id = p_item and removed_at is null for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._require_coordinator(v.event_id);

  if p_action = 'replace' then
    perform public._check_approval_file(v.event_id, v_path);
    update event_approvals
      set name = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
          detail = coalesce(nullif(trim(coalesce(p_detail, '')), ''), detail),
          file_path = coalesce(v_path, file_path), sha256 = case when v_path is null then sha256 else p_sha256 end,
          version = version + 1, status = 'pending', decided_by = null, decided_at = null
      where id = v.id;
    perform public._log(v.event_id, 'approval_updated',
      format('%s reemplazó %s «%s»: vuelve a estar por aprobar.', public._actor_name(v_me), v.code, v.name),
      1, 'approval', v.id, jsonb_build_object('group', v.group_key, 'status', 'pending', 'version', v.version + 1), true, v_me);
  elsif p_action = 'remove' then
    update event_approvals set removed_at = now() where id = v.id;
    perform public._log(v.event_id, 'approval_updated',
      format('%s retiró %s «%s».', public._actor_name(v_me), v.code, v.name),
      1, 'approval', v.id, jsonb_build_object('group', v.group_key, 'removed', true), true, v_me);
  else
    raise exception 'Acción desconocida.' using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · La decisión del cliente
-- ---------------------------------------------------------------------------

-- Aprueba el cliente. El productor general puede registrar una aprobación que el cliente dio por otro medio,
-- y debe decir cómo la recibió. Pedir un cambio siempre lleva el motivo.
create or replace function public.decide_approval(p_item uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_approvals;
  v_role event_role;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_status text;
begin
  select * into v from event_approvals where id = p_item and removed_at is null for update;
  if not found or v_me is null then
    raise exception 'No tienes permiso para decidir esto.' using errcode = '42501';
  end if;
  v_role := public.my_event_role(v.event_id);
  if v_role is null or v_role = 'producer' then
    raise exception 'La aprobación la da el cliente.' using errcode = '42501';
  end if;
  if (select status from events where id = v.event_id) = 'closed' then
    raise exception 'El evento está cerrado: ya no acepta cambios.' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'Indica si apruebas o pides un cambio.' using errcode = '22023';
  end if;
  if not p_approve and v_note is null then
    raise exception 'Cuenta qué hay que cambiar.' using errcode = '22023';
  end if;
  if v_role = 'backend' and v_note is null then
    raise exception 'Anota cómo te dio el cliente su aprobación (llamada, correo, WhatsApp).' using errcode = '22023';
  end if;

  v_status := case when p_approve then 'approved' else 'changes_requested' end;
  update event_approvals set status = v_status, decision_note = v_note, decided_by = v_me, decided_at = now() where id = v.id;
  perform public._log(v.event_id, 'approval_updated',
    case
      when v_role = 'backend' then format('%s registró que el cliente %s %s «%s»: %s', public._actor_name(v_me),
                                          case when p_approve then 'aprobó' else 'pidió un cambio en' end, v.code, v.name, v_note)
      when p_approve then format('%s aprobó %s «%s».', public._actor_name(v_me), v.code, v.name)
      else format('%s pidió un cambio en %s «%s»: %s', public._actor_name(v_me), v.code, v.name, v_note)
    end,
    case when p_approve then 1 else 2 end, 'approval', v.id,
    jsonb_build_object('group', v.group_key, 'status', v_status, 'version', v.version, 'on_behalf', v_role = 'backend'), true, v_me);
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Sin todo aprobado no se empieza
-- ---------------------------------------------------------------------------

-- Texto con lo que falta, o null si el evento está listo. La misma cuenta que usa la pantalla.
create or replace function public._approvals_missing(p_event uuid) returns text
language sql stable security definer set search_path = public as $$
  select string_agg(
           case when t.total = 0 then g.name || ': falta subirlo' else g.name || ': ' || t.open || ' por aprobar' end,
           '; ' order by g.ord)
  from events e
  cross join lateral unnest(e.approval_groups) with ordinality as u(key, ord0)
  join (values ('casting', 'Casting', 1), ('uniforme', 'Uniforme', 2), ('utileria', 'Utilería', 3), ('referencias', 'Referencias visuales', 4))
       as g(key, name, ord) on g.key = u.key
  cross join lateral (
    select count(*) as total, count(*) filter (where a.status <> 'approved') as open
    from event_approvals a where a.event_id = e.id and a.group_key = u.key and a.removed_at is null
  ) t
  where e.id = p_event and (t.total = 0 or t.open > 0)
$$;

create or replace function public._route_items_approval_gate() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_missing text;
begin
  if new.is_milestone and old.actual_start is null and new.actual_start is not null then
    v_missing := public._approvals_missing(new.event_id);
    if v_missing is not null then
      raise exception 'No se puede empezar «%»: falta la aprobación del cliente (%).', new.title, v_missing using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists route_items_approval_gate on route_items;
create trigger route_items_approval_gate before update of actual_start on route_items
  for each row execute function public._route_items_approval_gate();

-- ---------------------------------------------------------------------------
-- 6 · Fotos, permisos y tiempo real
-- ---------------------------------------------------------------------------

-- Las fotos van al cubo privado, en <evento>/aprobaciones/. Las sube el equipo; las ve todo miembro del evento,
-- porque el cliente tiene que verlas para aprobar.
create or replace function public.can_upload_approval_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_event uuid;
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 2) <> 'aprobaciones' or split_part(p_name, '/', 3) = '' then
    return false;
  end if;
  v_event := split_part(p_name, '/', 1)::uuid;
  return public.is_event_team(v_event) and coalesce((select status from events where id = v_event) <> 'closed', false);
end $$;

create or replace function public.can_read_approval_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 2) <> 'aprobaciones' then
    return false;
  end if;
  return public.is_event_member(split_part(p_name, '/', 1)::uuid);
end $$;

revoke execute on function public.can_upload_approval_file(text) from public, anon;
revoke execute on function public.can_read_approval_file(text) from public, anon;
grant execute on function public.can_upload_approval_file(text) to authenticated;
grant execute on function public.can_read_approval_file(text) to authenticated;

revoke execute on function public._approval_prefix(text) from public, anon, authenticated;
revoke execute on function public._check_approval_file(uuid, text) from public, anon, authenticated;
revoke execute on function public._approvals_missing(uuid) from public, anon, authenticated;
revoke execute on function public._route_items_approval_gate() from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.set_approval_groups(uuid, text[])',
    'public.add_approval_item(uuid, text, text, text, text, text)',
    'public.update_approval_item(uuid, text, text, text, text, text)',
    'public.decide_approval(uuid, boolean, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists aprobaciones_files_insert on storage.objects;
    create policy aprobaciones_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'evidences' and public.can_upload_approval_file(name));
    drop policy if exists aprobaciones_files_read on storage.objects;
    create policy aprobaciones_files_read on storage.objects for select to authenticated
      using (bucket_id = 'evidences' and public.can_read_approval_file(name));
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table event_approvals; exception when duplicate_object then null; end;
  end if;
end $$;
