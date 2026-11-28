-- MANDO · «Crear nuevo backend» (decisión 98).
--
-- Un administrador de la organización (el productor general que crea eventos) puede sumar a otra persona
-- con su mismo poder: crear eventos, armar equipos e invitar. Igual que en los eventos, nadie entra sin
-- invitación: se guarda una invitación a la organización; al pedir su primer código se le crea la cuenta
-- y, al entrar, queda como administradora. Si la persona ya tiene cuenta, queda como administradora al instante.

create table if not exists org_invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email           text not null check (email = lower(trim(email)) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  full_name       text not null check (length(trim(full_name)) between 1 and 120),
  invited_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  accepted_at     timestamptz,
  accepted_by     uuid references profiles(id),
  revoked_at      timestamptz
);
create unique index if not exists org_invitations_one_pending
  on org_invitations (organization_id, email) where accepted_at is null and revoked_at is null;

alter table org_invitations enable row level security;
drop policy if exists org_invitations_read on org_invitations;
create policy org_invitations_read on org_invitations for select to authenticated
  using (public.is_org_admin(organization_id));
-- Sin políticas de escritura: todo pasa por las funciones de abajo.
grant select on org_invitations to authenticated;
grant all on org_invitations to service_role;

-- Invita a una persona como nuevo backend de la organización.
create or replace function public.invite_org_admin(p_org uuid, p_email text, p_full_name text) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_me    uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name  text := trim(coalesce(p_full_name, ''));
  v_user  uuid;
  v_inv   uuid;
begin
  if v_me is null or p_org is null or not public.is_org_admin(p_org) then
    raise exception 'Solo un administrador de la organización puede crear un nuevo backend.' using errcode = '42501';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Escribe un correo válido.' using errcode = '22023';
  end if;
  if v_name = '' then
    raise exception 'Escribe el nombre de la persona.' using errcode = '22023';
  end if;

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null and exists (select 1 from auth.users where id = v_user and banned_until > now()) then
    raise exception 'Esa cuenta está bloqueada.' using errcode = '42501';
  end if;
  if v_user is not null and exists (select 1 from organization_members
                                     where organization_id = p_org and profile_id = v_user and is_admin) then
    raise exception 'Esa persona ya es backend de tu organización.' using errcode = '23505';
  end if;
  if exists (select 1 from org_invitations where organization_id = p_org and email = v_email
               and accepted_at is null and revoked_at is null) then
    raise exception 'Esa persona ya tiene una invitación pendiente.' using errcode = '23505';
  end if;

  insert into org_invitations (organization_id, email, full_name, invited_by)
  values (p_org, v_email, v_name, v_me) returning id into v_inv;

  if v_user is not null then
    insert into profiles (id, full_name) values (v_user, v_name) on conflict (id) do nothing;
    insert into organization_members (organization_id, profile_id, is_admin) values (p_org, v_user, true)
    on conflict (organization_id, profile_id) do update set is_admin = true;
    update org_invitations set accepted_at = now(), accepted_by = v_user where id = v_inv;
  end if;

  return jsonb_build_object('invitation_id', v_inv, 'joined', v_user is not null);
end $$;

create or replace function public.revoke_org_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select organization_id into v_org from org_invitations where id = p_invitation;
  if v_org is null or not public.is_org_admin(v_org) then
    raise exception 'Solo un administrador de la organización puede retirar esa invitación.' using errcode = '42501';
  end if;
  update org_invitations set revoked_at = now()
   where id = p_invitation and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'Esa invitación ya fue aceptada o retirada.' using errcode = '22023';
  end if;
end $$;

-- Al entrar con su código, la persona queda como administradora de las organizaciones que la invitaron.
create or replace function public.claim_org_invitations() returns int
language plpgsql security definer set search_path = public, auth as $$
declare
  v_me    uuid := auth.uid();
  v_email text;
  v_inv   record;
  v_count int := 0;
begin
  if v_me is null then
    raise exception 'Inicia sesión primero.' using errcode = '42501';
  end if;
  v_email := public._email_of(v_me);
  if v_email is null then return 0; end if;
  for v_inv in
    select * from org_invitations where email = v_email and accepted_at is null and revoked_at is null order by created_at
  loop
    insert into profiles (id, full_name) values (v_me, v_inv.full_name)
    on conflict (id) do update set full_name = excluded.full_name
      where profiles.full_name = split_part(v_email, '@', 1);
    insert into organization_members (organization_id, profile_id, is_admin) values (v_inv.organization_id, v_me, true)
    on conflict (organization_id, profile_id) do update set is_admin = true;
    update org_invitations set accepted_at = now(), accepted_by = v_me where id = v_inv.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Los backends de la organización, con su correo, para el panel. Solo para sus administradores.
create or replace function public.org_admins(p_org uuid)
returns table (profile_id uuid, full_name text, email text, is_me boolean)
language sql stable security definer set search_path = public, auth as $$
  select om.profile_id, p.full_name, lower(u.email), om.profile_id = auth.uid()
    from organization_members om
    join profiles p on p.id = om.profile_id
    join auth.users u on u.id = om.profile_id
   where om.organization_id = p_org and om.is_admin
     and (u.banned_until is null or u.banned_until <= now())
     and public.is_org_admin(p_org)
   order by p.full_name
$$;

-- ¿Puede este correo pedir un código? Ahora también con una invitación a la organización.
create or replace function public.invitation_pending(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from invitations
                  where email = lower(trim(coalesce(p_email, ''))) and accepted_at is null and revoked_at is null)
      or exists (select 1 from org_invitations
                  where email = lower(trim(coalesce(p_email, ''))) and accepted_at is null and revoked_at is null)
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.invite_org_admin(uuid, text, text)',
    'public.revoke_org_invitation(uuid)',
    'public.claim_org_invitations()',
    'public.org_admins(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke execute on function public.invitation_pending(text) from public;
grant execute on function public.invitation_pending(text) to anon, authenticated;
