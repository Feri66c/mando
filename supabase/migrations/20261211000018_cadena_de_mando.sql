-- MANDO · Migración 18 · Cadena de mando, visibilidad por persona, marcas y tercerización (decisiones 59 a 64).
--
--   1. Cadena de mando: cada persona del equipo puede tener un área, un mando al que reporta y su visibilidad.
--      Un mando central puede tener 8, 12 o 20 submandos bajo el mismo evento.
--   2. Visibilidad: «completa» (todo el evento), «area» (solo las actividades de su área) o «propia» (solo lo suyo).
--      Lo decide la base de datos, no la pantalla. Un submando nunca ve presupuesto, casting, expediente ajeno,
--      citados ni avisos al cliente: ve su mando, como un MANDO Express del equipo.
--   3. Marcas del evento: logos del cliente, de la agencia y de la productora. Modalidad del evento: directo,
--      de agencia o tercerizado.
--   4. Cambios de emergencia: 48 h, 24 h o último minuto. Solo se agregan; quedan en la bitácora.
--   5. Lista de ingreso para el local, con documento y cargo.
-- Toda tabla nueva tiene seguridad por fila y su prueba en tests/db. La bitácora sigue sin poder editarse.

alter type log_kind add value if not exists 'command_set';
alter type log_kind add value if not exists 'emergency_change';
alter type log_kind add value if not exists 'brand_updated';

-- ---------------------------------------------------------------------------
-- 1 · Esquema
-- ---------------------------------------------------------------------------

alter table event_members add column if not exists area_id uuid references areas(id) on delete set null;
alter table event_members add column if not exists reports_to uuid references profiles(id);
alter table event_members add column if not exists visibility text not null default 'completa'
  check (visibility in ('completa', 'area', 'propia'));
-- Los productores (niveles 1 y 2) siempre ven todo: limitar lo que alguien ve es para coordinación y técnicos.
-- Así, todo permiso que ya dependía del nivel (banco de talentos, documentos, presupuesto) sigue valiendo igual.
alter table event_members drop constraint if exists event_members_visibility_level;
alter table event_members add constraint event_members_visibility_level
  check (visibility = 'completa' or (role = 'producer' and level >= 3));
create index if not exists event_members_reports_idx on event_members (event_id, reports_to);

alter table invitations add column if not exists area_id uuid references areas(id) on delete set null;
alter table invitations add column if not exists reports_to uuid references profiles(id);
alter table invitations add column if not exists visibility text check (visibility in ('completa', 'area', 'propia'));

alter table events add column if not exists modality text not null default 'directo'
  check (modality in ('directo', 'agencia', 'tercerizado'));
alter table events add column if not exists agency_name text;

create table if not exists event_brands (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id) on delete cascade,
  kind       text not null check (kind in ('cliente', 'agencia', 'productora')),
  name       text not null check (length(trim(name)) between 1 and 80),
  file_path  text,                              -- logo en el cubo privado, <evento>/marcas/. null = solo el nombre
  sort_order int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists event_brands_name_idx on event_brands (event_id, kind, lower(name));

create table if not exists emergency_changes (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events(id) on delete cascade,
  kind         text not null check (kind in ('persona', 'proveedor', 'horario', 'locacion', 'otro')),
  time_window  text not null check (time_window in ('con_tiempo', '48h', '24h', 'ultimo_minuto')),
  title        text not null check (length(trim(title)) between 1 and 160),
  detail       text check (detail is null or length(detail) <= 1000),
  hours_before numeric(8, 1),                   -- horas que faltaban para el evento; negativo = ya empezó
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists emergency_changes_event_idx on emergency_changes (event_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2 · Quién ve qué
-- ---------------------------------------------------------------------------

-- Ve todo el evento: el backend y quien tiene visibilidad completa. El cliente nunca.
create or replace function public.sees_all(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_members m
                 where m.event_id = p_event and m.profile_id = auth.uid()
                   and m.role <> 'viewer' and (m.role = 'backend' or m.visibility = 'completa'))
$$;

-- Una actividad de la hoja de ruta. El submando ve las de su área, las que tiene a su cargo y los hitos
-- del evento (necesita saber a qué hora abren puertas).
create or replace function public.can_see_item(p_event uuid, p_area uuid, p_owner uuid, p_milestone boolean, p_visible boolean)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when m.role = 'viewer' then coalesce(p_visible, false)
      when m.role = 'backend' or m.visibility = 'completa' then true
      when p_owner = auth.uid() or coalesce(p_milestone, false) then true
      when m.visibility = 'area' then p_area is not null and p_area = m.area_id
      else false
    end
    from event_members m where m.event_id = p_event and m.profile_id = auth.uid()), false)
$$;

create or replace function public.can_see_item_id(p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.can_see_item(i.event_id, i.area_id, i.owner_id, i.is_milestone, i.visible_to_viewer)
                   from route_items i where i.id = p_item), false)
$$;

-- Lo que cuelga de una actividad (alertas, evidencias, bitácora, cambios, momentos): el cliente ve lo visible,
-- quien ve todo ve todo, y el submando ve lo que hizo él y lo de las actividades que le tocan.
create or replace function public.can_see_scoped(p_event uuid, p_visible boolean, p_actor uuid, p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when m.role = 'viewer' then coalesce(p_visible, false)
      when m.role = 'backend' or m.visibility = 'completa' then true
      else coalesce(p_actor = auth.uid(), false) or (p_item is not null and public.can_see_item_id(p_item))
    end
    from event_members m where m.event_id = p_event and m.profile_id = auth.uid()), false)
$$;

drop policy if exists route_items_read on route_items;
create policy route_items_read on route_items for select to authenticated
  using (public.can_see_item(event_id, area_id, owner_id, is_milestone, visible_to_viewer));

drop policy if exists alerts_read on alerts;
create policy alerts_read on alerts for select to authenticated
  using (public.can_see_scoped(event_id, visible_to_viewer, raised_by, case when entity_type = 'route_item' then entity_id end));

drop policy if exists evidences_read on evidences;
create policy evidences_read on evidences for select to authenticated
  using (public.can_see_scoped(event_id, visible_to_viewer, captured_by, route_item_id));

drop policy if exists log_read on log_entries;
create policy log_read on log_entries for select to authenticated
  using (public.can_see_scoped(event_id, visible_to_viewer, actor_id, case when entity_type = 'route_item' then entity_id end));

drop policy if exists change_requests_read on change_requests;
create policy change_requests_read on change_requests for select to authenticated
  using (public.can_see_scoped(event_id, false, requested_by, item_id));

drop policy if exists moments_read on critical_moments;
create policy moments_read on critical_moments for select to authenticated
  using (public.can_see_scoped(event_id, false, opened_by, route_item_id));

-- Los compromisos se ven si se ve su momento (la subconsulta pasa por la política de arriba).
drop policy if exists commitments_read on commitments;
create policy commitments_read on commitments for select to authenticated
  using (public.sees_all(event_id)
         or (public.is_event_team(event_id) and exists (select 1 from critical_moments m where m.id = moment_id)));

-- Expediente: contratos, facturas y seguros. El submando solo ve lo que le toca subir o lo que subió.
drop policy if exists event_requirements_read on event_requirements;
create policy event_requirements_read on event_requirements for select to authenticated
  using (public.sees_all(event_id)
         or (public.is_event_team(event_id) and (owner_id = auth.uid() or done_by = auth.uid())));

-- Citados (teléfonos y correos), casting y avisos al cliente: solo quien ve todo. El cliente sigue viendo lo suyo.
drop policy if exists event_guests_read on event_guests;
create policy event_guests_read on event_guests for select to authenticated using (public.sees_all(event_id));

drop policy if exists event_approvals_read on event_approvals;
create policy event_approvals_read on event_approvals for select to authenticated
  using (public.sees_all(event_id) or public.my_event_role(event_id) = 'viewer');

drop policy if exists client_notices_read on client_notices;
create policy client_notices_read on client_notices for select to authenticated
  using (public.sees_all(event_id) or public.my_event_role(event_id) = 'viewer');

-- Presupuesto: además del nivel, hace falta visibilidad completa. Un submando nunca ve montos.
create or replace function public.can_see_budget(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_members m where m.event_id = p_event and m.profile_id = auth.uid()
                 and (m.role = 'viewer' or m.role = 'backend'
                      or (coalesce(m.level, 4) <= 2 and m.visibility = 'completa')))
$$;
create or replace function public.can_see_budget_lines(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_members m where m.event_id = p_event and m.profile_id = auth.uid()
                 and (m.role = 'backend'
                      or (m.role = 'producer' and coalesce(m.level, 4) <= 2 and m.visibility = 'completa'
                          and coalesce((select breakdown_visible from event_budgets b where b.event_id = p_event), false))))
$$;

-- Lo que dejaron los demás en la encuesta de cierre: niveles 1 y 2 con visibilidad completa.
create or replace function public.can_read_feedback(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from event_members
    where event_id = p_event and profile_id = auth.uid() and role <> 'viewer' and level is not null and level <= 2
      and (role = 'backend' or visibility = 'completa')
  );
$$;

-- La base de personas y el banco de talentos: igual, niveles 1 y 2 con visibilidad completa.
create or replace function public.can_manage_people(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_org_admin(p_org)
      or exists (select 1 from event_members m join events e on e.id = m.event_id
                 where e.organization_id = p_org and m.profile_id = auth.uid()
                   and m.role <> 'viewer' and coalesce(m.level, 4) <= 2
                   and (m.role = 'backend' or m.visibility = 'completa'))
$$;

-- Archivos del cubo privado. Antes todo el equipo leía cualquier archivo del evento; ahora el submando lee
-- solo los de las evidencias que ve, los documentos que le tocan y los logos.
create or replace function public.can_read_evidence_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_event uuid;
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_event := split_part(p_name, '/', 1)::uuid;
  return public.sees_all(v_event)
      or exists (select 1 from evidences ev
                 where ev.file_path = p_name and ev.event_id = v_event
                   and public.can_see_scoped(ev.event_id, ev.visible_to_viewer, ev.captured_by, ev.route_item_id))
      or (public.is_event_team(v_event)
          and exists (select 1 from event_requirements r
                      where r.file_path = p_name and r.event_id = v_event
                        and (r.owner_id = auth.uid() or r.done_by = auth.uid())));
end $$;

create or replace function public.can_read_approval_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_event uuid;
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 2) <> 'aprobaciones' then
    return false;
  end if;
  v_event := split_part(p_name, '/', 1)::uuid;
  return public.sees_all(v_event) or coalesce(public.my_event_role(v_event) = 'viewer', false);
end $$;

-- Un submando solo marca «en curso» o «cumplida» las actividades de su mando.
create or replace function public._route_items_scope_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.status is distinct from old.status and new.status in ('in_progress', 'done')
     and public.is_event_team(old.event_id)
     and not public.can_see_item(old.event_id, old.area_id, old.owner_id, old.is_milestone, old.visible_to_viewer) then
    raise exception 'Esa actividad no es de tu mando.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists route_items_scope_guard on route_items;
create trigger route_items_scope_guard before update of status on route_items
  for each row execute function public._route_items_scope_guard();

-- Tampoco pide cambios sobre actividades que no ve.
create or replace function public._change_requests_scope_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.item_id is not null and public.is_event_team(new.event_id)
     and not public.can_see_item_id(new.item_id) then
    raise exception 'Esa actividad no es de tu mando.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists change_requests_scope_guard on change_requests;
create trigger change_requests_scope_guard before insert on change_requests
  for each row execute function public._change_requests_scope_guard();

-- Las invitaciones las ve el backend y quien las hizo.
drop policy if exists invitations_read on invitations;
create policy invitations_read on invitations for select to authenticated
  using (public.is_event_backend(event_id) or (invited_by = auth.uid() and public.sees_all(event_id)));

-- ---------------------------------------------------------------------------
-- 3 · Armar la cadena de mando
-- ---------------------------------------------------------------------------

-- Busca el área por nombre dentro del evento; si no existe, la crea.
create or replace function public._area_by_name(p_event uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_name text := nullif(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), ''); v_id uuid;
begin
  if v_name is null then return null; end if;
  if length(v_name) > 60 then
    raise exception 'El nombre del área es muy largo.' using errcode = '22023';
  end if;
  select id into v_id from areas where event_id = p_event and lower(name) = lower(v_name) limit 1;
  if v_id is null then
    insert into areas (event_id, name, sort_order)
    values (p_event, v_name, coalesce((select max(sort_order) from areas where event_id = p_event), 0) + 1)
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- ¿Puede quien llama dar mando a alguien de ese nivel? El backend, siempre. El productor de campo con
-- visibilidad completa, solo a coordinación y técnicos (niveles 3 y 4): sus submandos.
create or replace function public._can_command(p_event uuid, p_target_level int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_members m
                 where m.event_id = p_event and m.profile_id = auth.uid()
                   and (m.role = 'backend'
                        or (m.role = 'producer' and m.level = 2 and m.visibility = 'completa' and coalesce(p_target_level, 0) >= 3)))
$$;

-- El mando al que reporta tiene que ser del equipo, con igual o mayor jerarquía, y sin cerrar un círculo.
create or replace function public._check_reports_to(p_event uuid, p_profile uuid, p_level int, p_reports_to uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_boss event_members; v_cursor uuid := p_reports_to; v_steps int := 0;
begin
  if p_reports_to is null then return; end if;
  select * into v_boss from event_members where event_id = p_event and profile_id = p_reports_to;
  if not found or v_boss.role = 'viewer' or p_reports_to = p_profile or coalesce(v_boss.level, 4) > coalesce(p_level, 4) then
    raise exception 'El mando tiene que ser alguien del equipo con igual o mayor jerarquía.' using errcode = '22023';
  end if;
  while v_cursor is not null and v_steps < 50 loop
    if v_cursor = p_profile then
      raise exception 'Esa persona ya está bajo el mando de quien quieres asignarle.' using errcode = '22023';
    end if;
    select reports_to into v_cursor from event_members where event_id = p_event and profile_id = v_cursor;
    v_steps := v_steps + 1;
  end loop;
end $$;

create or replace function public._visibility_label(p_visibility text) returns text
language sql immutable as $$
  select case p_visibility when 'completa' then 'todo el evento' when 'area' then 'solo su área' else 'solo lo suyo' end
$$;

-- Definir el área, el mando y la visibilidad de una persona del equipo.
create or replace function public.set_member_command(
  p_event uuid, p_profile uuid, p_area text, p_reports_to uuid, p_visibility text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_target event_members; v_area uuid;
begin
  perform public._require_team(p_event);
  select * into v_target from event_members where event_id = p_event and profile_id = p_profile;
  if not found or v_target.role = 'viewer' then
    raise exception 'Esa persona no es del equipo.' using errcode = '22023';
  end if;
  if not public._can_command(p_event, v_target.level) then
    raise exception 'La cadena de mando la arma el backend o el productor a cargo.' using errcode = '42501';
  end if;
  if p_visibility is null or p_visibility not in ('completa', 'area', 'propia') then
    raise exception 'Elige qué ve esta persona.' using errcode = '22023';
  end if;
  if v_target.role = 'backend' and p_visibility <> 'completa' then
    raise exception 'El backend siempre ve todo el evento.' using errcode = '22023';
  end if;
  if coalesce(v_target.level, 4) <= 2 and p_visibility <> 'completa' then
    raise exception 'Un productor ve todo el evento. Para limitar lo que ve, dale un cargo de coordinación o técnico.' using errcode = '22023';
  end if;
  perform public._check_reports_to(p_event, p_profile, v_target.level, p_reports_to);
  v_area := public._area_by_name(p_event, p_area);
  if p_visibility = 'area' and v_area is null then
    raise exception 'Para ver solo su área, primero dile cuál es su área.' using errcode = '22023';
  end if;

  update event_members set area_id = v_area, reports_to = p_reports_to, visibility = p_visibility
   where event_id = p_event and profile_id = p_profile;

  perform public._log(p_event, 'command_set',
    format('%s definió el mando de %s: área %s, reporta a %s, ve %s.',
           public._actor_name(v_me), public._actor_name(p_profile),
           coalesce((select name from areas where id = v_area), 'sin área'),
           coalesce(public._actor_name(p_reports_to), 'el mando central'),
           public._visibility_label(p_visibility)),
    1, 'member', p_profile, jsonb_build_object('area_id', v_area, 'reports_to', p_reports_to, 'visibility', p_visibility), false, v_me);
end $$;

-- Invitar: ahora también con área, mando y visibilidad. El productor de campo puede invitar a sus submandos.
drop function if exists public.invite_to_event(uuid, text, text, text, event_role, smallint);
create or replace function public.invite_to_event(
  p_event uuid, p_email text, p_full_name text, p_title text, p_role event_role, p_level smallint default null,
  p_area text default null, p_reports_to uuid default null, p_visibility text default null
) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_me uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user uuid;
  v_inv uuid;
  v_event_name text;
  v_is_backend boolean := public.is_event_backend(p_event);
  v_area uuid;
  v_boss uuid := p_reports_to;
  v_visibility text := p_visibility;
begin
  if p_event is null or not (v_is_backend or (p_role = 'producer' and public._can_command(p_event, p_level))) then
    raise exception 'Solo el productor general del evento puede invitar.' using errcode = '42501';
  end if;
  if (select status from events where id = p_event) = 'closed' then
    raise exception 'El evento está cerrado: ya no acepta cambios.' using errcode = '42501';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Escribe un correo válido.' using errcode = '22023';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Escribe el nombre de la persona.' using errcode = '22023';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Elige el cargo de la persona.' using errcode = '22023';
  end if;
  perform public._check_role_level(p_role, p_level);

  -- Lo que ve: si no se dice, sale del nivel. Productores, todo; coordinación, su área; técnicos, lo suyo.
  if p_role = 'viewer' then
    v_visibility := null; v_boss := null;
  else
    if v_visibility is null then
      v_visibility := case when p_level <= 2 then 'completa' when p_level = 3 then 'area' else 'propia' end;
    end if;
    if v_visibility not in ('completa', 'area', 'propia') then
      raise exception 'Elige qué ve esta persona.' using errcode = '22023';
    end if;
    if p_level <= 2 and v_visibility <> 'completa' then
      raise exception 'Un productor ve todo el evento. Para limitar lo que ve, dale un cargo de coordinación o técnico.' using errcode = '22023';
    end if;
    if v_boss is null and not v_is_backend then v_boss := v_me; end if;   -- quien invita a su submando es su mando
    perform public._check_reports_to(p_event, null, p_level, v_boss);
    v_area := public._area_by_name(p_event, p_area);
    if v_visibility = 'area' and v_area is null then v_visibility := 'propia'; end if;  -- sin área todavía: ve solo lo suyo
  end if;

  if exists (select 1 from invitations where event_id = p_event and email = v_email and revoked_at is null) then
    raise exception 'Esa persona ya tiene una invitación a este evento.' using errcode = '23505';
  end if;

  select id into v_user from auth.users where lower(email) = v_email limit 1;
  if v_user is not null and exists (select 1 from event_members where event_id = p_event and profile_id = v_user) then
    raise exception 'Esa persona ya es parte del equipo.' using errcode = '23505';
  end if;

  insert into invitations (event_id, email, full_name, role, title, level, invited_by, accepted_at, accepted_by, area_id, reports_to, visibility)
  values (p_event, v_email, trim(p_full_name), p_role, trim(p_title), p_level, v_me,
          case when v_user is not null then now() end, v_user, v_area, v_boss, v_visibility)
  returning id into v_inv;

  if v_user is not null then
    insert into event_members (event_id, profile_id, role, title, level, invited_by, area_id, reports_to, visibility)
    values (p_event, v_user, p_role, trim(p_title), p_level, v_me, v_area, v_boss, coalesce(v_visibility, 'completa'));
  end if;

  select name into v_event_name from events where id = p_event;
  perform public._log(p_event, 'member_invited',
    format('%s invitó a %s como %s.', public._actor_name(v_me), trim(p_full_name), trim(p_title)),
    1, 'invitation', v_inv,
    jsonb_build_object('role', p_role, 'level', p_level, 'area_id', v_area, 'reports_to', v_boss, 'visibility', v_visibility), false, v_me);

  return jsonb_build_object('invitation_id', v_inv, 'joined', v_user is not null, 'event_name', v_event_name);
end $$;

-- Retirar una invitación: el backend, o quien la hizo.
create or replace function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_event uuid; v_by uuid;
begin
  select event_id, invited_by into v_event, v_by from invitations where id = p_invitation;
  if v_event is null or not (public.is_event_backend(v_event) or (v_by = auth.uid() and public.sees_all(v_event))) then
    raise exception 'Solo el productor general del evento puede retirar invitaciones.' using errcode = '42501';
  end if;
  update invitations set revoked_at = now()
   where id = p_invitation and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'Esa invitación ya fue aceptada o retirada.' using errcode = '22023';
  end if;
end $$;

-- Al entrar con su código, la persona se une con el área, el mando y la visibilidad que le dieron.
create or replace function public.claim_invitations() returns int
language plpgsql security definer set search_path = public, auth as $$
declare
  v_me uuid := auth.uid();
  v_email text;
  v_inv record;
  v_count int := 0;
begin
  if v_me is null then
    raise exception 'Inicia sesión primero.' using errcode = '42501';
  end if;
  v_email := public._email_of(v_me);
  if v_email is null then return 0; end if;

  for v_inv in
    select * from invitations where email = v_email and accepted_at is null and revoked_at is null
    order by created_at
  loop
    insert into profiles (id, full_name) values (v_me, v_inv.full_name)
    on conflict (id) do update set full_name = excluded.full_name
      where profiles.full_name = split_part(v_email, '@', 1);

    insert into event_members (event_id, profile_id, role, title, level, invited_by, area_id, reports_to, visibility)
    values (v_inv.event_id, v_me, v_inv.role, v_inv.title, v_inv.level, v_inv.invited_by, v_inv.area_id,
            -- si su mando ya no está en el equipo, queda bajo el mando central
            (select m.profile_id from event_members m where m.event_id = v_inv.event_id and m.profile_id = v_inv.reports_to and m.role <> 'viewer'),
            coalesce(v_inv.visibility, 'completa'))
    on conflict (event_id, profile_id) do nothing;

    update invitations set accepted_at = now(), accepted_by = v_me where id = v_inv.id;
    perform public._log(v_inv.event_id, 'member_joined',
      format('%s activó su mando como %s.', public._actor_name(v_me), v_inv.title),
      1, 'invitation', v_inv.id, '{}'::jsonb, false, v_me);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- La cadena de mando que ve la pantalla. Quien ve todo, ve a todo el equipo. El submando ve su propia fila,
-- a su mando y a quienes tiene a cargo. El cliente no ve nada.
create or replace function public.command_chain(p_event uuid)
returns table (profile_id uuid, full_name text, title text, role event_role, level smallint, area_id uuid, area_name text,
               reports_to uuid, reports_to_name text, visibility text, subordinates int, active boolean)
language sql stable security definer set search_path = public as $$
  select m.profile_id, p.full_name, m.title, m.role, m.level, m.area_id, a.name, m.reports_to, b.full_name, m.visibility,
         (select count(*) from event_members s where s.event_id = m.event_id and s.reports_to = m.profile_id)::int,
         m.welcomed_at is not null
  from event_members m
  join profiles p on p.id = m.profile_id
  left join areas a on a.id = m.area_id
  left join profiles b on b.id = m.reports_to
  where m.event_id = p_event and m.role <> 'viewer'
    and (public.sees_all(p_event)
         or (public.is_event_team(p_event)
             and (m.profile_id = auth.uid() or m.reports_to = auth.uid()
                  or m.profile_id = (select me.reports_to from event_members me where me.event_id = p_event and me.profile_id = auth.uid()))))
  order by coalesce(m.level, 9), p.full_name
$$;

-- ---------------------------------------------------------------------------
-- 4 · Marcas del evento y modalidad
-- ---------------------------------------------------------------------------

alter table event_brands enable row level security;
-- Las marcas las ve todo miembro del evento: es su evento. Se escriben solo con las funciones de abajo.
drop policy if exists event_brands_read on event_brands;
create policy event_brands_read on event_brands for select to authenticated using (public.is_event_member(event_id));

create or replace function public.add_event_brand(p_event uuid, p_kind text, p_name text, p_file_path text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_name text := nullif(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  v_path text := nullif(trim(coalesce(p_file_path, '')), '');
  v_id uuid;
begin
  perform public._require_team(p_event);
  if not public.is_event_backend(p_event) then
    raise exception 'Las marcas del evento las carga el backend.' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('cliente', 'agencia', 'productora') then
    raise exception 'Elige si la marca es del cliente, de la agencia o de la productora.' using errcode = '22023';
  end if;
  if v_name is null or length(v_name) > 80 then
    raise exception 'Escribe el nombre de la marca.' using errcode = '22023';
  end if;
  if v_path is not null and v_path not like p_event::text || '/marcas/%' then
    raise exception 'El logo no pertenece a este evento.' using errcode = '22023';
  end if;

  select id into v_id from event_brands where event_id = p_event and kind = p_kind and lower(name) = lower(v_name);
  if v_id is null then
    insert into event_brands (event_id, kind, name, file_path, sort_order, created_by)
    values (p_event, p_kind, v_name, v_path,
            coalesce((select max(sort_order) from event_brands where event_id = p_event), 0) + 1, v_me)
    returning id into v_id;
  else
    update event_brands set name = v_name, file_path = coalesce(v_path, file_path) where id = v_id;
  end if;

  perform public._log(p_event, 'brand_updated',
    format('%s cargó la marca «%s» (%s).', public._actor_name(v_me), v_name, p_kind),
    1, 'brand', v_id, jsonb_build_object('kind', p_kind, 'logo', v_path is not null), false, v_me);
  return v_id;
end $$;

create or replace function public.remove_event_brand(p_brand uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v event_brands;
begin
  select * into v from event_brands where id = p_brand;
  if not found or not public.is_event_backend(v.event_id) then
    raise exception 'Las marcas del evento las carga el backend.' using errcode = '42501';
  end if;
  perform public._require_team(v.event_id);
  delete from event_brands where id = v.id;
  perform public._log(v.event_id, 'brand_updated',
    format('%s quitó la marca «%s».', public._actor_name(v_me), v.name),
    1, 'brand', v.id, jsonb_build_object('kind', v.kind, 'removed', true), false, v_me);
end $$;

-- Directo, de agencia o tercerizado. Si hay agencia, se guarda su nombre.
create or replace function public.set_event_modality(p_event uuid, p_modality text, p_agency text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_agency text := nullif(trim(coalesce(p_agency, '')), '');
begin
  perform public._require_team(p_event);
  if not public.is_event_backend(p_event) then
    raise exception 'La modalidad del evento la define el backend.' using errcode = '42501';
  end if;
  if p_modality is null or p_modality not in ('directo', 'agencia', 'tercerizado') then
    raise exception 'Elige la modalidad del evento.' using errcode = '22023';
  end if;
  if length(coalesce(v_agency, '')) > 80 then
    raise exception 'El nombre de la agencia es muy largo.' using errcode = '22023';
  end if;
  update events set modality = p_modality, agency_name = case when p_modality = 'directo' then null else v_agency end
   where id = p_event;
  perform public._log(p_event, 'note',
    format('%s marcó el evento como %s%s.', public._actor_name(v_me),
           case p_modality when 'directo' then 'directo con el cliente' when 'agencia' then 'evento de agencia' else 'tercerización' end,
           case when p_modality <> 'directo' and v_agency is not null then ' (' || v_agency || ')' else '' end),
    1, 'event', p_event, jsonb_build_object('modality', p_modality, 'agency', v_agency), false, v_me);
end $$;

-- Logos: <evento>/marcas/. Los sube el backend (PNG, JPG o WebP); los ve todo miembro del evento.
create or replace function public.can_upload_brand_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_event uuid;
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 2) <> 'marcas' or p_name !~* '\.(png|jpe?g|webp)$' then
    return false;
  end if;
  v_event := split_part(p_name, '/', 1)::uuid;
  return public.is_event_backend(v_event) and coalesce((select status from events where id = v_event) <> 'closed', false);
end $$;

create or replace function public.can_read_brand_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 2) <> 'marcas' then
    return false;
  end if;
  return public.is_event_member(split_part(p_name, '/', 1)::uuid);
end $$;

-- La subida general de evidencias no sirve para la carpeta de marcas: ahí solo entra el backend.
create or replace function public.can_upload_evidence_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_event uuid;
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 2) in ('', 'marcas') then
    return false;
  end if;
  v_event := split_part(p_name, '/', 1)::uuid;
  return public.is_event_team(v_event)
     and coalesce((select status from events where id = v_event) <> 'closed', false);
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Cambios de emergencia
-- ---------------------------------------------------------------------------

alter table emergency_changes enable row level security;
-- Los ve quien ve todo el evento, y cada quien los que reportó. Solo se agregan.
drop policy if exists emergency_changes_read on emergency_changes;
create policy emergency_changes_read on emergency_changes for select to authenticated
  using (public.sees_all(event_id) or (created_by = auth.uid() and public.is_event_team(event_id)));

create or replace function public._forbid_emergency_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'Los cambios de emergencia no se editan ni se borran.' using errcode = '42501';
end $$;
drop trigger if exists emergency_changes_no_update on emergency_changes;
create trigger emergency_changes_no_update before update or delete on emergency_changes
  for each row execute function public._forbid_emergency_mutation();

-- Reportar un cambio de emergencia. La ventana la calcula el servidor con la hora del evento:
-- más de 48 h = con tiempo; hasta 48 h; hasta 24 h; a 2 h o menos (o con el evento en marcha) = último minuto.
create or replace function public.report_emergency_change(p_event uuid, p_kind text, p_title text, p_detail text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_title text := nullif(regexp_replace(trim(coalesce(p_title, '')), '\s+', ' ', 'g'), '');
  v_detail text := nullif(trim(coalesce(p_detail, '')), '');
  v_hours numeric;
  v_window text;
  v_label text;
  v_level int;
  v_id uuid;
begin
  perform public._require_team(p_event);
  if public._my_level(p_event) > 3 then
    raise exception 'Los cambios de emergencia los reporta producción o coordinación.' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('persona', 'proveedor', 'horario', 'locacion', 'otro') then
    raise exception 'Elige qué cambia.' using errcode = '22023';
  end if;
  if v_title is null or length(v_title) > 160 then
    raise exception 'Cuenta en una línea qué cambia.' using errcode = '22023';
  end if;
  if length(coalesce(v_detail, '')) > 1000 then
    raise exception 'El detalle es muy largo.' using errcode = '22023';
  end if;

  select round(extract(epoch from (starts_at - now())) / 3600.0, 1) into v_hours from events where id = p_event;
  v_window := case when v_hours is null or v_hours > 48 then 'con_tiempo'
                   when v_hours > 24 then '48h' when v_hours > 2 then '24h' else 'ultimo_minuto' end;
  v_label := case v_window when 'con_tiempo' then 'con tiempo' when '48h' then '48 h antes'
                           when '24h' then '24 h antes' else 'último minuto' end;
  v_level := case v_window when '48h' then 1 when '24h' then 2 when 'ultimo_minuto' then 3 end;

  insert into emergency_changes (event_id, kind, time_window, title, detail, hours_before, created_by)
  values (p_event, p_kind, v_window, v_title, v_detail, v_hours, v_me)
  returning id into v_id;

  if v_level is not null then
    perform public._raise_alert(p_event, v_level, null, format('Cambio de emergencia · %s', v_label),
      v_title, 'emergency_change', v_id, v_me);
  end if;
  perform public._log(p_event, 'emergency_change',
    format('%s reportó un cambio de emergencia (%s): %s', public._actor_name(v_me), v_label, v_title),
    coalesce(v_level, 1), 'emergency_change', v_id,
    jsonb_build_object('kind', p_kind, 'window', v_window, 'hours_before', v_hours), false, v_me);
  return jsonb_build_object('id', v_id, 'window', v_window);
end $$;

-- ---------------------------------------------------------------------------
-- 6 · Lista de ingreso y responsable por defecto
-- ---------------------------------------------------------------------------

-- La lista que pide el local: quién viene, con qué documento y qué cargo. Lleva datos personales:
-- solo niveles 1 y 2 con visibilidad completa.
create or replace function public.access_list(p_event uuid)
returns table (full_name text, doc_type text, doc_number text, role text, doc_state text)
language plpgsql stable security definer set search_path = public as $$
declare v_day date := public._event_day(p_event);
begin
  if not exists (select 1 from event_members m where m.event_id = p_event and m.profile_id = auth.uid()
                 and m.role <> 'viewer' and coalesce(m.level, 4) <= 2 and (m.role = 'backend' or m.visibility = 'completa')) then
    raise exception 'La lista de ingreso la exporta el productor general o el productor de campo.' using errcode = '42501';
  end if;
  return query
    select p.full_name, p.doc_type, p.doc_number, ep.role, public._person_doc_state(p, v_day)
    from event_people ep join people p on p.id = ep.person_id
    where ep.event_id = p_event
    order by ep.role, p.full_name;
end $$;

-- El responsable de un documento es quien lo sube, salvo que ya se haya asignado a otra persona.
create or replace function public._requirements_default_owner() returns trigger
language plpgsql as $$
begin
  if new.status = 'done' and new.owner_id is null and new.done_by is not null then
    new.owner_id := new.done_by;
  end if;
  return new;
end $$;
drop trigger if exists event_requirements_default_owner on event_requirements;
create trigger event_requirements_default_owner before update on event_requirements
  for each row execute function public._requirements_default_owner();

-- ---------------------------------------------------------------------------
-- 7 · Permisos
-- ---------------------------------------------------------------------------

grant select on event_brands, emergency_changes to authenticated;
grant all on event_brands, emergency_changes to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public._route_items_scope_guard()', 'public._change_requests_scope_guard()', 'public._area_by_name(uuid, text)',
    'public._can_command(uuid, int)', 'public._check_reports_to(uuid, uuid, int, uuid)', 'public._visibility_label(text)',
    'public._forbid_emergency_mutation()', 'public._requirements_default_owner()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.sees_all(uuid)', 'public.can_see_item(uuid, uuid, uuid, boolean, boolean)', 'public.can_see_item_id(uuid)',
    'public.can_see_scoped(uuid, boolean, uuid, uuid)',
    'public.set_member_command(uuid, uuid, text, uuid, text)',
    'public.invite_to_event(uuid, text, text, text, event_role, smallint, text, uuid, text)',
    'public.revoke_invitation(uuid)', 'public.claim_invitations()', 'public.command_chain(uuid)',
    'public.add_event_brand(uuid, text, text, text)', 'public.remove_event_brand(uuid)',
    'public.set_event_modality(uuid, text, text)', 'public.can_upload_brand_file(text)', 'public.can_read_brand_file(text)',
    'public.report_emergency_change(uuid, text, text, text)', 'public.access_list(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists marcas_files_insert on storage.objects;
    create policy marcas_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'evidences' and public.can_upload_brand_file(name));
    drop policy if exists marcas_files_read on storage.objects;
    create policy marcas_files_read on storage.objects for select to authenticated
      using (bucket_id = 'evidences' and public.can_read_brand_file(name));
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table event_brands; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table emergency_changes; exception when duplicate_object then null; end;
  end if;
end $$;
