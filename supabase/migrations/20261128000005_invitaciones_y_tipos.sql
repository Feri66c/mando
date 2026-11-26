-- MANDO · Migración 5 · Eventos por invitación y tipo de evento (decisiones 17 a 20).
--
--   1. Tipo de evento: el evento guarda su plantilla (config/tipos-de-evento.json) y su tamaño.
--      La hoja de ruta inicial nace de las piezas de la plantilla, contadas desde la hora clave.
--   2. Jerarquía: cada miembro tiene un cargo (title) y un nivel: 1 productor general, 2 productor de campo,
--      3 coordinación, 4 técnicos y proveedores. El cliente no tiene nivel.
--   3. Invitaciones: solo el productor general (backend del evento) invita. Si la persona ya tiene cuenta,
--      entra al equipo de inmediato; si no, la invitación queda pendiente y se une al validar su código.
--      Solo un correo con invitación pendiente puede crear su cuenta.
--   4. Bienvenida: cada miembro ve una vez la pantalla de bienvenida antes de tomar el mando (welcomed_at).
-- Toda tabla nueva tiene seguridad por fila y su prueba en tests/db. La bitácora sigue sin poder editarse.

-- ---------------------------------------------------------------------------
-- 1 · Esquema
-- ---------------------------------------------------------------------------

alter type log_kind add value if not exists 'member_invited';
alter type log_kind add value if not exists 'member_joined';

alter table events add column if not exists kind text;                                   -- clave de la plantilla
alter table events add column if not exists tier text check (tier in ('ligero', 'medio', 'mayor'));
alter table events add column if not exists template jsonb not null default '{}'::jsonb;  -- copia de la plantilla

alter table event_members add column if not exists level smallint check (level between 1 and 4);
alter table event_members add column if not exists welcomed_at timestamptz;

-- Quienes ya eran miembros antes de esta migración no pasan por la bienvenida, y reciben su nivel según su rol.
update event_members set welcomed_at = created_at where welcomed_at is null;
update event_members set level = case role when 'backend' then 1 when 'producer' then 2 end where level is null and role <> 'viewer';

create table if not exists invitations (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  email       text not null check (email = lower(email) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  full_name   text not null check (length(trim(full_name)) > 0),
  role        event_role not null,
  title       text not null check (length(trim(title)) > 0),
  level       smallint check (level between 1 and 4),
  invited_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references profiles(id),
  revoked_at  timestamptz,
  check (
    (role = 'viewer' and level is null) or
    (role = 'backend' and level = 1) or
    (role = 'producer' and level between 2 and 4)
  )
);
create unique index if not exists invitations_active_idx on invitations (event_id, email) where revoked_at is null;
create index if not exists invitations_email_idx on invitations (email) where accepted_at is null and revoked_at is null;

alter table invitations enable row level security;
-- Solo el productor general del evento ve sus invitaciones. Se escriben únicamente con las funciones de abajo.
drop policy if exists invitations_read on invitations;
create policy invitations_read on invitations for select to authenticated
  using (public.is_event_backend(event_id));

-- ---------------------------------------------------------------------------
-- 2 · Ayudas
-- ---------------------------------------------------------------------------

create or replace function public._email_of(p_profile uuid) returns text
language sql stable security definer set search_path = public, auth as $$
  select lower(email) from auth.users where id = p_profile
$$;

create or replace function public._check_role_level(p_role event_role, p_level smallint) returns void
language plpgsql immutable as $$
begin
  if (p_role = 'viewer' and p_level is not null)
     or (p_role = 'backend' and p_level is distinct from 1)
     or (p_role = 'producer' and (p_level is null or p_level not between 2 and 4)) then
    raise exception 'El cargo no coincide con su nivel.' using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Crear un evento desde su plantilla
-- ---------------------------------------------------------------------------

create or replace function public.create_event_from_template(
  p_org uuid, p_name text, p_client text, p_venue text, p_timezone text,
  p_key_time timestamptz, p_template jsonb, p_criticality jsonb, p_brief text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_event uuid;
  v_piece jsonb;
  v_i int := 0;
  v_start timestamptz;
  v_end timestamptz;
  v_last timestamptz := p_key_time;
begin
  if v_me is null or not public.is_org_admin(p_org) then
    raise exception 'Solo un productor general de la organización puede crear eventos.' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Escribe el nombre del evento.' using errcode = '22023';
  end if;
  if p_key_time is null then
    raise exception 'Falta la fecha y hora clave del evento.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_template -> 'piezas') is distinct from 'array' or jsonb_array_length(p_template -> 'piezas') = 0 then
    raise exception 'La plantilla del tipo de evento no tiene piezas.' using errcode = '22023';
  end if;
  if coalesce(p_template ->> 'tamano', '') not in ('ligero', 'medio', 'mayor') then
    raise exception 'La plantilla del tipo de evento no tiene un tamaño válido.' using errcode = '22023';
  end if;
  if p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Zona horaria desconocida.' using errcode = '22023';
  end if;

  insert into events (organization_id, name, event_type, kind, tier, template, client_name, venue_name, timezone,
                      starts_at, ends_at, status, criticality_config, created_by)
  values (p_org, trim(p_name), p_template ->> 'nombre', p_template ->> 'clave', p_template ->> 'tamano', p_template,
          nullif(trim(p_client), ''), nullif(trim(p_venue), ''), p_timezone,
          p_key_time, p_key_time, 'planned', coalesce(p_criticality, '{}'::jsonb), v_me)
  returning id into v_event;

  insert into event_members (event_id, profile_id, role, title, level, welcomed_at)
  values (v_event, v_me, 'backend', 'Productor general', 1, now());

  for v_piece in select value from jsonb_array_elements(p_template -> 'piezas') loop
    v_i := v_i + 1;
    if coalesce(trim(v_piece ->> 'titulo'), '') = '' then
      raise exception 'La pieza % de la plantilla no tiene título.', v_i using errcode = '22023';
    end if;
    v_start := p_key_time + make_interval(mins => (v_piece ->> 'inicio_min')::int);
    v_end := v_start + make_interval(mins => greatest((v_piece ->> 'duracion_min')::int, 0));
    v_last := greatest(v_last, v_end);
    insert into route_items (event_id, title, planned_start, planned_end, current_start, current_end,
                             is_milestone, visible_to_viewer, sort_order)
    values (v_event, trim(v_piece ->> 'titulo'), v_start, v_end, v_start, v_end,
            coalesce((v_piece ->> 'clave')::boolean, false), coalesce((v_piece ->> 'visible_cliente')::boolean, true), v_i);
  end loop;

  update events set ends_at = v_last where id = v_event;

  if coalesce(trim(p_brief), '') <> '' then
    insert into briefs (event_id, body, channel, created_by) values (v_event, trim(p_brief), 'text', v_me);
  end if;

  perform public._log(v_event, 'event_created',
    format('%s creó el evento «%s» (%s) con %s piezas.', public._actor_name(v_me), trim(p_name), p_template ->> 'nombre', v_i),
    1, 'event', v_event, jsonb_build_object('kind', p_template ->> 'clave', 'tier', p_template ->> 'tamano'), true, v_me);

  return v_event;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Invitar, revocar, aceptar
-- ---------------------------------------------------------------------------

create or replace function public.invite_to_event(
  p_event uuid, p_email text, p_full_name text, p_title text, p_role event_role, p_level smallint default null
) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_me uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user uuid;
  v_inv uuid;
  v_event_name text;
begin
  if p_event is null or not public.is_event_backend(p_event) then
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

  if exists (select 1 from invitations where event_id = p_event and email = v_email and revoked_at is null) then
    raise exception 'Esa persona ya tiene una invitación a este evento.' using errcode = '23505';
  end if;

  select id into v_user from auth.users where lower(email) = v_email limit 1;
  if v_user is not null and exists (select 1 from event_members where event_id = p_event and profile_id = v_user) then
    raise exception 'Esa persona ya es parte del equipo.' using errcode = '23505';
  end if;

  insert into invitations (event_id, email, full_name, role, title, level, invited_by, accepted_at, accepted_by)
  values (p_event, v_email, trim(p_full_name), p_role, trim(p_title), p_level, v_me,
          case when v_user is not null then now() end, v_user)
  returning id into v_inv;

  if v_user is not null then
    insert into event_members (event_id, profile_id, role, title, level, invited_by)
    values (p_event, v_user, p_role, trim(p_title), p_level, v_me);
  end if;

  select name into v_event_name from events where id = p_event;
  perform public._log(p_event, 'member_invited',
    format('%s invitó a %s como %s.', public._actor_name(v_me), trim(p_full_name), trim(p_title)),
    1, 'invitation', v_inv, jsonb_build_object('role', p_role, 'level', p_level), false, v_me);

  return jsonb_build_object('invitation_id', v_inv, 'joined', v_user is not null, 'event_name', v_event_name);
end $$;

create or replace function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_event uuid;
begin
  select event_id into v_event from invitations where id = p_invitation;
  if v_event is null or not public.is_event_backend(v_event) then
    raise exception 'Solo el productor general del evento puede retirar invitaciones.' using errcode = '42501';
  end if;
  update invitations set revoked_at = now()
   where id = p_invitation and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'Esa invitación ya fue aceptada o retirada.' using errcode = '22023';
  end if;
end $$;

-- ¿Puede este correo pedir un código? Solo si tiene una invitación pendiente. No dice a qué evento.
create or replace function public.invitation_pending(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from invitations
                  where email = lower(trim(coalesce(p_email, ''))) and accepted_at is null and revoked_at is null)
$$;

-- Al entrar con su código, la persona se une a todos los eventos a los que la invitaron.
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
    -- El perfil nace con la parte del correo antes de la @; si es así, toma el nombre de la invitación.
    insert into profiles (id, full_name) values (v_me, v_inv.full_name)
    on conflict (id) do update set full_name = excluded.full_name
      where profiles.full_name = split_part(v_email, '@', 1);

    insert into event_members (event_id, profile_id, role, title, level, invited_by)
    values (v_inv.event_id, v_me, v_inv.role, v_inv.title, v_inv.level, v_inv.invited_by)
    on conflict (event_id, profile_id) do nothing;

    update invitations set accepted_at = now(), accepted_by = v_me where id = v_inv.id;
    perform public._log(v_inv.event_id, 'member_joined',
      format('%s activó su mando como %s.', public._actor_name(v_me), v_inv.title),
      1, 'invitation', v_inv.id, '{}'::jsonb, false, v_me);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- La persona vio la bienvenida y tomó el mando. Solo marca su propia fila.
create or replace function public.mark_welcomed(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update event_members set welcomed_at = coalesce(welcomed_at, now())
   where event_id = p_event and profile_id = auth.uid();
  if not found then
    raise exception 'No eres parte de este evento.' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Permisos de ejecución
-- ---------------------------------------------------------------------------

revoke execute on function public._email_of(uuid) from public, anon, authenticated;
revoke execute on function public._check_role_level(event_role, smallint) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_event_from_template(uuid, text, text, text, text, timestamptz, jsonb, jsonb, text)',
    'public.invite_to_event(uuid, text, text, text, event_role, smallint)',
    'public.revoke_invitation(uuid)',
    'public.claim_invitations()',
    'public.mark_welcomed(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

revoke execute on function public.invitation_pending(text) from public;
grant execute on function public.invitation_pending(text) to anon, authenticated;
