-- MANDO · Migración 19 · Minuto a minuto, origen de los cambios, momentos wow y People Experience
-- (decisiones 65 a 69).
--
--   1. Cada cambio de la hoja de ruta lleva su origen: cliente, producción o eventualidad.
--   2. Cada cambio aplicado crea un «nuevo minuto a minuto»: una versión guardada, que no se edita.
--   3. Momento wow y Eventualidad: se capturan de un toque y quedan marcados para el cierre.
--   4. People Experience: los números del evento para explicar el resultado con datos.
--   5. Brief: hasta 10 000 letras, con sinopsis y documento adjunto.
-- Toda tabla nueva tiene seguridad por fila y su prueba en tests/db. La bitácora sigue sin poder editarse.

alter type log_kind add value if not exists 'route_version';
alter type log_kind add value if not exists 'moment_marked';

-- ---------------------------------------------------------------------------
-- 1 · Origen de los cambios y versiones del minuto a minuto
-- ---------------------------------------------------------------------------

alter table change_requests add column if not exists origin text check (origin in ('cliente', 'produccion', 'eventualidad'));

create table if not exists route_versions (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references events(id) on delete cascade,
  version           int not null check (version >= 2),      -- la 1 es el plan publicado
  origin            text check (origin in ('cliente', 'produccion', 'eventualidad')),
  reason            text,
  change_request_id uuid references change_requests(id),
  snapshot          jsonb not null,                          -- la hoja de ruta tal como quedó
  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now(),
  unique (event_id, version)
);

alter table route_versions enable row level security;
-- La versión guarda la hoja de ruta completa: la lee quien ve todo el evento.
drop policy if exists route_versions_read on route_versions;
create policy route_versions_read on route_versions for select to authenticated using (public.sees_all(event_id));

create or replace function public._origin_label(p_origin text) returns text
language sql immutable as $$
  select case p_origin when 'cliente' then 'pedido del cliente' when 'produccion' then 'producción'
                       when 'eventualidad' then 'eventualidad' else 'sin clasificar' end
$$;

-- Una versión solo cambia en su origen, cuando alguien clasifica el cambio después. Nunca se borra.
create or replace function public._route_versions_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' or new.snapshot is distinct from old.snapshot or new.version is distinct from old.version
     or new.event_id is distinct from old.event_id or new.created_at is distinct from old.created_at then
    raise exception 'Las versiones del minuto a minuto no se editan ni se borran.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists route_versions_guard on route_versions;
create trigger route_versions_guard before update or delete on route_versions
  for each row execute function public._route_versions_guard();

-- Al aplicarse un cambio, se guarda cómo quedó la hoja de ruta y se anota en la bitácora.
create or replace function public._change_requests_version() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_version int; v_id uuid;
begin
  if new.applied_at is null or old.applied_at is not null then return new; end if;
  v_version := coalesce((select max(version) from route_versions where event_id = new.event_id), 1) + 1;
  insert into route_versions (event_id, version, origin, reason, change_request_id, snapshot, created_by)
  values (new.event_id, v_version, new.origin, new.reason, new.id,
          (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', i.id, 'title', i.title, 'start', i.current_start, 'end', i.current_end,
                    'area', a.name, 'milestone', i.is_milestone, 'status', i.status)
                    order by i.current_start, i.sort_order), '[]'::jsonb)
           from route_items i left join areas a on a.id = i.area_id
           where i.event_id = new.event_id and i.status <> 'cancelled'),
          auth.uid())
  returning id into v_id;
  perform public._log(new.event_id, 'route_version',
    format('Nuevo minuto a minuto: versión %s. Origen: %s.', v_version, public._origin_label(new.origin)),
    null, 'route_version', v_id, jsonb_build_object('version', v_version, 'origin', new.origin), false, auth.uid());
  return new;
end $$;
drop trigger if exists change_requests_version on change_requests;
create trigger change_requests_version after update of applied_at on change_requests
  for each row execute function public._change_requests_version();

-- Clasificar un cambio: lo hace quien lo pidió, o producción (niveles 1 y 2). Sirve antes y después de aplicarlo.
create or replace function public.set_change_origin(p_request uuid, p_origin text) returns void
language plpgsql security definer set search_path = public as $$
declare v_req change_requests;
begin
  select * into v_req from change_requests where id = p_request for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._require_team(v_req.event_id);
  if v_req.requested_by <> auth.uid() and public._my_level(v_req.event_id) > 2 then
    raise exception 'El origen lo marca quien pidió el cambio o producción.' using errcode = '42501';
  end if;
  if p_origin is null or p_origin not in ('cliente', 'produccion', 'eventualidad') then
    raise exception 'Elige de dónde viene el cambio: cliente, producción o eventualidad.' using errcode = '22023';
  end if;
  update change_requests set origin = p_origin where id = p_request;
  update route_versions set origin = p_origin where change_request_id = p_request;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Momento wow y Eventualidad
-- ---------------------------------------------------------------------------

alter table evidences add column if not exists tag text check (tag in ('wow', 'eventualidad'));
create index if not exists evidences_tag_idx on evidences (event_id, tag) where tag is not null;

-- Un toque: foto (o una línea) marcada como momento wow o como eventualidad. El momento wow lo ve el cliente;
-- la eventualidad se queda con el equipo.
create or replace function public.mark_moment(
  p_event uuid, p_tag text, p_note text default null, p_file_path text default null,
  p_sha256 text default null, p_captured_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_path text := nullif(trim(coalesce(p_file_path, '')), '');
  v_id uuid;
begin
  perform public._require_team(p_event);
  if p_tag is null or p_tag not in ('wow', 'eventualidad') then
    raise exception 'Elige momento wow o eventualidad.' using errcode = '22023';
  end if;
  if p_tag = 'eventualidad' and v_note is null then
    raise exception 'Cuenta en una línea qué pasó.' using errcode = '22023';
  end if;
  if p_tag = 'wow' and v_path is null and v_note is null then
    raise exception 'Toma la foto del momento.' using errcode = '22023';
  end if;
  if length(coalesce(v_note, '')) > 500 then
    raise exception 'La nota es muy larga.' using errcode = '22023';
  end if;

  v_id := public.add_evidence(
    p_event => p_event, p_kind => (case when v_path is null then 'note' else 'photo' end)::evidence_kind,
    p_file_path => v_path, p_note => v_note, p_sha256 => p_sha256, p_captured_at => p_captured_at,
    p_visible => p_tag = 'wow');
  update evidences set tag = p_tag where id = v_id;

  perform public._log(p_event, 'moment_marked',
    format('%s marcó %s%s', public._actor_name(v_me),
           case p_tag when 'wow' then 'un momento wow' else 'una eventualidad' end, coalesce(': ' || v_note, '.')),
    case when p_tag = 'eventualidad' then 2 end, 'evidence', v_id, jsonb_build_object('tag', p_tag), p_tag = 'wow', v_me);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · People Experience: los números del evento
-- ---------------------------------------------------------------------------

-- Solo números, sin nombres. Los lee producción (niveles 1 y 2). `p_tolerance_min`: cuántos minutos de
-- demora todavía cuentan como «a tiempo».
create or replace function public.people_experience(p_event uuid, p_tolerance_min int default 10) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from event_members m where m.event_id = p_event and m.profile_id = auth.uid()
                 and m.role <> 'viewer' and coalesce(m.level, 4) <= 2) then
    raise exception 'El análisis del evento lo ve el productor general o el productor de campo.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'changes', (select coalesce(jsonb_object_agg(o, n), '{}'::jsonb)
                from (select coalesce(origin, 'sin_clasificar') as o, count(*) as n from change_requests
                      where event_id = p_event and applied_at is not null group by 1) t),
    'versions', (select coalesce(max(version), 1) from route_versions where event_id = p_event),
    'emergencies', (select coalesce(jsonb_object_agg(w, n), '{}'::jsonb)
                    from (select time_window as w, count(*) as n from emergency_changes where event_id = p_event group by 1) t),
    'wow', (select count(*) from evidences where event_id = p_event and tag = 'wow'),
    'eventualidades', (select count(*) from evidences where event_id = p_event and tag = 'eventualidad'),
    'items_total', (select count(*) from route_items where event_id = p_event and status <> 'cancelled'),
    'items_done', (select count(*) from route_items where event_id = p_event and status = 'done'),
    'items_started', (select count(*) from route_items where event_id = p_event and status <> 'cancelled' and actual_start is not null),
    'items_on_time', (select count(*) from route_items where event_id = p_event and status <> 'cancelled' and actual_start is not null
                      and actual_start <= planned_start + make_interval(mins => greatest(coalesce(p_tolerance_min, 10), 0))),
    'alerts_total', (select count(*) from alerts where event_id = p_event),
    'alerts_resolved', (select count(*) from alerts where event_id = p_event and status = 'resolved'),
    'mandos', (select count(*) from event_members where event_id = p_event and role <> 'viewer'),
    'field_people', (select count(*) from event_people where event_id = p_event),
    'client_stars', (select round(avg(stars), 1) from event_feedback where event_id = p_event and kind = 'satisfaction'),
    'learnings', (select count(*) from event_feedback where event_id = p_event and kind = 'learnings')
  );
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Brief: 10 000 letras, sinopsis y documento
-- ---------------------------------------------------------------------------

alter table event_briefs drop constraint if exists event_briefs_summary_check;
alter table event_briefs add constraint event_briefs_summary_check check (length(trim(summary)) between 1 and 10000);
alter table event_briefs add column if not exists synopsis text check (synopsis is null or length(synopsis) <= 600);
alter table event_briefs add column if not exists document_path text;
alter table event_briefs add column if not exists document_name text;

drop function if exists public.set_brief(uuid, text, text, text);
create or replace function public.set_brief(
  p_event uuid, p_summary text, p_objective text default null, p_attendees text default null,
  p_synopsis text default null, p_document_path text default null, p_document_name text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_summary text := nullif(trim(coalesce(p_summary, '')), '');
  v_synopsis text := nullif(trim(coalesce(p_synopsis, '')), '');
  v_path text := nullif(trim(coalesce(p_document_path, '')), '');
  v_version int;
begin
  perform public._require_team(p_event);
  if not public.is_event_backend(p_event) then
    raise exception 'El brief lo carga el backend.' using errcode = '42501';
  end if;
  if v_summary is null then
    raise exception 'Escribe el brief del evento.' using errcode = '22023';
  end if;
  if length(v_summary) > 10000 then
    raise exception 'El brief pasa de 10 000 letras. Resúmelo.' using errcode = '22023';
  end if;
  if length(coalesce(v_synopsis, '')) > 600 then
    raise exception 'La sinopsis pasa de 600 letras.' using errcode = '22023';
  end if;
  if v_path is not null and v_path not like p_event::text || '/brief/%' then
    raise exception 'El documento no pertenece a este evento.' using errcode = '22023';
  end if;
  insert into event_briefs (event_id, summary, objective, attendees, synopsis, document_path, document_name, updated_by)
  values (p_event, v_summary, nullif(trim(coalesce(p_objective, '')), ''), nullif(trim(coalesce(p_attendees, '')), ''),
          v_synopsis, v_path, case when v_path is not null then nullif(trim(coalesce(p_document_name, '')), '') end, v_me)
  on conflict (event_id) do update
    set version = event_briefs.version + 1, summary = excluded.summary, objective = excluded.objective,
        attendees = excluded.attendees, synopsis = excluded.synopsis,
        -- el documento se conserva si no se adjunta uno nuevo
        document_path = coalesce(excluded.document_path, event_briefs.document_path),
        document_name = case when excluded.document_path is not null then excluded.document_name else event_briefs.document_name end,
        updated_by = v_me, updated_at = now()
  returning version into v_version;
  perform public._log(p_event, 'brief_updated',
    format('%s %s el brief (versión %s).', public._actor_name(v_me),
           case when v_version = 1 then 'cargó' else 'corrigió' end, v_version),
    1, 'brief', p_event, jsonb_build_object('version', v_version, 'document', v_path is not null), false, v_me);
  return v_version;
end $$;

-- El documento del brief lo lee todo el equipo: es lo primero que cada persona tiene que conocer.
create or replace function public.can_read_brief_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_event uuid;
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 2) <> 'brief' then
    return false;
  end if;
  v_event := split_part(p_name, '/', 1)::uuid;
  return public.is_event_team(v_event)
     and exists (select 1 from event_briefs b where b.event_id = v_event and b.document_path = p_name);
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Permisos
-- ---------------------------------------------------------------------------

grant all on route_versions to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public._origin_label(text)', 'public._route_versions_guard()', 'public._change_requests_version()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.set_change_origin(uuid, text)',
    'public.mark_moment(uuid, text, text, text, text, timestamptz)',
    'public.people_experience(uuid, int)',
    'public.set_brief(uuid, text, text, text, text, text, text)',
    'public.can_read_brief_file(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists brief_files_read on storage.objects;
    create policy brief_files_read on storage.objects for select to authenticated
      using (bucket_id = 'evidences' and public.can_read_brief_file(name));
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table route_versions; exception when duplicate_object then null; end;
  end if;
end $$;
