-- MANDO · Migración 16 · Semáforo de casting, mini ficha, tipo de documento y catálogo de cargos (decisiones 50 a 53).
--
--   1. Casting con semáforo: cada persona queda Aprobada (verde), Backup (ámbar) o No admitida (rojo).
--      Nadie se retira del casting: la persona queda guardada con su veredicto.
--   2. Mini ficha: edad, talla, estatura, habilidad y demás datos de selección viajan con cada elemento.
--   3. Tipo de documento: DNI (8 dígitos exactos), carnet de extranjería o pasaporte.
--   4. Catálogo de cargos: la productora propone un cargo nuevo y el backend lo aprueba para toda la organización.
-- Toda tabla nueva tiene seguridad por fila y su prueba en tests/db. La bitácora sigue sin poder editarse.

-- ---------------------------------------------------------------------------
-- 1 · Casting: veredicto y mini ficha
-- ---------------------------------------------------------------------------

alter table event_approvals drop constraint if exists event_approvals_status_check;
alter table event_approvals add constraint event_approvals_status_check
  check (status in ('pending', 'approved', 'changes_requested', 'backup', 'rejected'));
alter table event_approvals add column if not exists profile jsonb not null default '{}'::jsonb;

-- La ficha es un objeto chico de textos: nada de listas ni objetos anidados.
create or replace function public._clean_profile(p_profile jsonb) returns jsonb
language plpgsql immutable as $$
declare v_out jsonb;
begin
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    return '{}'::jsonb;
  end if;
  select coalesce(jsonb_object_agg(left(trim(e.key), 40), left(trim(e.value #>> '{}'), 120)), '{}'::jsonb) into v_out
  from jsonb_each(p_profile) e
  where jsonb_typeof(e.value) in ('string', 'number', 'boolean') and trim(e.key) <> '' and trim(e.value #>> '{}') <> '';
  if (select count(*) from jsonb_object_keys(v_out)) > 30 then
    raise exception 'La ficha tiene demasiados datos.' using errcode = '22023';
  end if;
  return v_out;
end $$;

drop function if exists public.add_approval_item(uuid, text, text, text, text, text);
create or replace function public.add_approval_item(
  p_event uuid, p_group text, p_name text, p_detail text default null, p_file_path text default null,
  p_sha256 text default null, p_profile jsonb default null
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

  insert into event_approvals (event_id, group_key, code, name, detail, file_path, sha256, profile, created_by)
  values (p_event, p_group, v_code, trim(p_name), nullif(trim(coalesce(p_detail, '')), ''), v_path, p_sha256,
          public._clean_profile(p_profile), v_me)
  returning id into v_id;
  perform public._log(p_event, 'approval_updated',
    format('%s subió %s «%s» para aprobación.', public._actor_name(v_me), v_code, trim(p_name)),
    1, 'approval', v_id, jsonb_build_object('group', p_group, 'status', 'pending'), true, v_me);
  return v_id;
end $$;

-- Corregir la mini ficha no cambia el veredicto.
create or replace function public.set_approval_profile(p_item uuid, p_profile jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_approvals;
begin
  select * into v from event_approvals where id = p_item and removed_at is null for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._require_coordinator(v.event_id);
  update event_approvals set profile = public._clean_profile(p_profile) where id = v.id;
  perform public._log(v.event_id, 'approval_updated',
    format('%s actualizó la ficha de %s «%s».', public._actor_name(v_me), v.code, v.name),
    1, 'approval', v.id, jsonb_build_object('group', v.group_key, 'profile', true), false, v_me);
end $$;

-- Reemplazar vuelve el elemento a «por aprobar». En casting nadie se retira: se marca No admitido.
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
    if v.group_key = 'casting' then
      raise exception 'En casting nadie se retira: la persona queda guardada. Márcala como No admitido.' using errcode = '22023';
    end if;
    update event_approvals set removed_at = now() where id = v.id;
    perform public._log(v.event_id, 'approval_updated',
      format('%s retiró %s «%s».', public._actor_name(v_me), v.code, v.name),
      1, 'approval', v.id, jsonb_build_object('group', v.group_key, 'removed', true), true, v_me);
  else
    raise exception 'Acción desconocida.' using errcode = '22023';
  end if;
end $$;

-- El semáforo. Decide el cliente, o el backend en su nombre. p_verdict: 'approved' | 'backup' | 'rejected'.
create or replace function public.decide_casting(p_item uuid, p_verdict text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_approvals;
  v_role event_role;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_word text;
begin
  select * into v from event_approvals where id = p_item and removed_at is null for update;
  if not found or v_me is null then
    raise exception 'No tienes permiso para decidir esto.' using errcode = '42501';
  end if;
  v_role := public.my_event_role(v.event_id);
  if v_role is null then
    raise exception 'No tienes permiso para decidir esto.' using errcode = '42501';
  end if;
  if v_role = 'producer' then
    raise exception 'El veredicto lo da el cliente.' using errcode = '42501';
  end if;
  if (select status from events where id = v.event_id) = 'closed' then
    raise exception 'El evento está cerrado: ya no acepta cambios.' using errcode = '42501';
  end if;
  if v.group_key <> 'casting' then
    raise exception 'El semáforo es solo para el casting.' using errcode = '22023';
  end if;
  v_word := case p_verdict when 'approved' then 'Aprobado' when 'backup' then 'Backup' when 'rejected' then 'No admitido' end;
  if v_word is null then
    raise exception 'Elige Aprobado, Backup o No admitido.' using errcode = '22023';
  end if;
  if v.status = p_verdict then
    return;
  end if;

  update event_approvals set status = p_verdict, decision_note = v_note, decided_by = v_me, decided_at = now() where id = v.id;
  perform public._log(v.event_id, 'approval_updated',
    format('%s marcó %s «%s» como %s%s', public._actor_name(v_me), v.code, v.name, v_word,
           case when v_note is null then '.' else ': ' || v_note end),
    case when p_verdict = 'rejected' then 2 else 1 end, 'approval', v.id,
    jsonb_build_object('group', v.group_key, 'status', p_verdict, 'version', v.version, 'on_behalf', v_role = 'backend'), true, v_me);
end $$;

-- Lo que falta. Casting: nadie por revisar y al menos una persona aprobada. El resto: todo aprobado.
create or replace function public._approvals_missing(p_event uuid) returns text
language sql stable security definer set search_path = public as $$
  select string_agg(
           case when t.total = 0 then g.name || ': falta subirlo'
                when t.open > 0 then g.name || ': ' || t.open || ' por aprobar'
                else g.name || ': falta al menos una persona aprobada' end,
           '; ' order by g.ord)
  from events e
  cross join lateral unnest(e.approval_groups) with ordinality as u(key, ord0)
  join (values ('casting', 'Casting', 1), ('uniforme', 'Uniforme', 2), ('utileria', 'Utilería', 3), ('referencias', 'Referencias visuales', 4))
       as g(key, name, ord) on g.key = u.key
  cross join lateral (
    select count(*) as total,
           count(*) filter (where case when u.key = 'casting' then a.status in ('pending', 'changes_requested') else a.status <> 'approved' end) as open,
           count(*) filter (where a.status = 'approved') as approved
    from event_approvals a where a.event_id = e.id and a.group_key = u.key and a.removed_at is null
  ) t
  where e.id = p_event and (t.total = 0 or t.open > 0 or t.approved = 0)
$$;

-- El aviso de «todo aprobado» sale con la última decisión, sea cual sea su color.
create or replace function public._approvals_notice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('approved', 'backup', 'rejected') and old.status is distinct from new.status
     and public._approvals_missing(new.event_id) is null then
    perform public._system_notice(new.event_id, 'Aprobaste todo. El evento puede arrancar.');
    if not exists (select 1 from jsonb_array_elements(public._planning_status(new.event_id)) e where not (e ->> 'ready')::boolean) then
      perform public._system_notice(new.event_id, 'Planificación completa. El evento quedó desbloqueado.');
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Tipo de documento de identidad
-- ---------------------------------------------------------------------------

alter table people add column if not exists doc_type text not null default 'dni';
alter table people drop constraint if exists people_doc_type_check;
alter table people add constraint people_doc_type_check check (doc_type in ('dni', 'ce', 'pasaporte'));
alter table people drop constraint if exists people_organization_id_doc_number_key;
alter table people drop constraint if exists people_org_doc_key;
alter table people add constraint people_org_doc_key unique (organization_id, doc_type, doc_number);

-- Devuelve el número limpio, o falla con el motivo. DNI: 8 dígitos exactos.
create or replace function public._check_doc(p_type text, p_number text) returns text
language plpgsql immutable as $$
declare v text := upper(nullif(regexp_replace(coalesce(p_number, ''), '[\s.\-]', '', 'g'), ''));
begin
  if p_type not in ('dni', 'ce', 'pasaporte') then
    raise exception 'Elige el tipo de documento: DNI, carnet de extranjería o pasaporte.' using errcode = '22023';
  end if;
  if v is null then
    return null;
  end if;
  if p_type = 'dni' and v !~ '^[0-9]{8}$' then
    raise exception 'El DNI tiene exactamente 8 números.' using errcode = '22023';
  elsif p_type = 'ce' and v !~ '^[A-Z0-9]{9,12}$' then
    raise exception 'El carnet de extranjería tiene de 9 a 12 letras o números.' using errcode = '22023';
  elsif p_type = 'pasaporte' and v !~ '^[A-Z0-9]{6,12}$' then
    raise exception 'El pasaporte tiene de 6 a 12 letras o números.' using errcode = '22023';
  end if;
  return v;
end $$;

drop function if exists public.save_person(uuid, uuid, text, text, date, text, text, text, text);
-- Registrar o corregir a una persona. Si el documento ya está en la base, se actualiza esa ficha: nadie se registra dos veces.
create or replace function public.save_person(
  p_event uuid, p_person uuid, p_full_name text, p_doc_number text default null, p_doc_expires_on date default null,
  p_phone text default null, p_default_role text default null, p_photo_path text default null, p_doc_path text default null,
  p_doc_type text default 'dni'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_org uuid;
  v_id uuid := p_person;
  v_type text := coalesce(nullif(trim(coalesce(p_doc_type, '')), ''), 'dni');
  v_doc text;
  v_photo text := nullif(trim(coalesce(p_photo_path, '')), '');
  v_copy text := nullif(trim(coalesce(p_doc_path, '')), '');
begin
  perform public._require_planner(p_event);
  select organization_id into v_org from events where id = p_event;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Escribe el nombre completo.' using errcode = '22023';
  end if;
  v_doc := public._check_doc(v_type, p_doc_number);
  perform public._check_person_file(v_org, v_photo);
  perform public._check_person_file(v_org, v_copy);
  if v_id is null and v_doc is not null then
    select id into v_id from people where organization_id = v_org and doc_type = v_type and doc_number = v_doc;
  end if;
  if v_id is null then
    insert into people (organization_id, full_name, doc_type, doc_number, doc_expires_on, phone, default_role, photo_path, doc_path, created_by)
    values (v_org, trim(p_full_name), v_type, v_doc, p_doc_expires_on, nullif(trim(coalesce(p_phone, '')), ''),
            nullif(trim(coalesce(p_default_role, '')), ''), v_photo, v_copy, v_me)
    returning id into v_id;
  else
    update people set
      full_name = trim(p_full_name),
      doc_type = case when v_doc is null then doc_type else v_type end,
      doc_number = coalesce(v_doc, doc_number),
      doc_expires_on = coalesce(p_doc_expires_on, doc_expires_on),
      phone = coalesce(nullif(trim(coalesce(p_phone, '')), ''), phone),
      default_role = coalesce(nullif(trim(coalesce(p_default_role, '')), ''), default_role),
      photo_path = coalesce(v_photo, photo_path),
      doc_path = coalesce(v_copy, doc_path),
      updated_at = now()
    where id = v_id and organization_id = v_org;
    if not found then
      raise exception 'Esa persona no está en la base de esta organización.' using errcode = '42501';
    end if;
  end if;
  return v_id;
end $$;

drop function if exists public.event_people_board(uuid);
-- La lista que ve la pantalla. Niveles 1 y 2: toda la base, con documento. Niveles 3 y 4: solo el personal del evento, sin datos personales.
create or replace function public.event_people_board(p_event uuid)
returns table (person_id uuid, full_name text, default_role text, role text, assigned boolean, photo_path text,
               doc_state text, doc_number text, doc_expires_on date, doc_path text, phone text, doc_type text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_full boolean := public._my_level(p_event) <= 2;   -- también exige ser del equipo
  v_day date := public._event_day(p_event);
begin
  return query
    select p.id, p.full_name, p.default_role, ep.role, ep.person_id is not null, p.photo_path,
           public._person_doc_state(p, v_day),
           case when v_full then p.doc_number end, case when v_full then p.doc_expires_on end,
           case when v_full then p.doc_path end, case when v_full then p.phone end,
           case when v_full then p.doc_type end
    from people p
    join events e on e.id = p_event and e.organization_id = p.organization_id
    left join event_people ep on ep.event_id = p_event and ep.person_id = p.id
    where v_full or ep.person_id is not null
    order by (ep.person_id is null), p.full_name;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Catálogo de cargos: la productora propone, el backend aprueba
-- ---------------------------------------------------------------------------

create table if not exists role_catalog (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null check (length(trim(name)) between 2 and 60),
  name_key        text not null,                       -- en minúsculas y sin espacios de más: evita repetidos
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  proposed_by     uuid references profiles(id),
  proposed_event  uuid references events(id) on delete set null,
  reviewed_by     uuid references profiles(id),
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (organization_id, name_key)
);

-- Quién aprueba cargos: el administrador de la organización o el backend de alguno de sus eventos.
create or replace function public.can_review_roles(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_org_admin(p_org)
      or exists (select 1 from event_members m join events e on e.id = m.event_id
                 where e.organization_id = p_org and m.profile_id = auth.uid() and m.role = 'backend')
$$;

alter table role_catalog enable row level security;
-- Lo lee quien maneja la base de personas de la organización o aprueba sus cargos. Se escribe con las funciones de abajo.
drop policy if exists role_catalog_read on role_catalog;
create policy role_catalog_read on role_catalog for select to authenticated
  using (public.can_manage_people(organization_id) or public.can_review_roles(organization_id));

-- Proponer un cargo nuevo. Si ya existe, devuelve el que hay.
create or replace function public.propose_role(p_event uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_org uuid;
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_key text;
  v_id uuid;
begin
  perform public._require_planner(p_event);
  if length(v_name) < 2 or length(v_name) > 60 then
    raise exception 'Escribe el cargo (de 2 a 60 letras).' using errcode = '22023';
  end if;
  v_key := lower(v_name);
  select organization_id into v_org from events where id = p_event;
  select id into v_id from role_catalog where organization_id = v_org and name_key = v_key;
  if v_id is not null then
    return v_id;
  end if;
  insert into role_catalog (organization_id, name, name_key, proposed_by, proposed_event)
  values (v_org, v_name, v_key, v_me, p_event) returning id into v_id;
  perform public._log(p_event, 'planning_updated',
    format('%s propuso el cargo «%s». Espera la aprobación del backend.', public._actor_name(v_me), v_name),
    1, 'role', v_id, jsonb_build_object('status', 'pending'), false, v_me);
  return v_id;
end $$;

create or replace function public.review_role(p_role uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v role_catalog;
begin
  select * into v from role_catalog where id = p_role for update;
  if not found or v_me is null or not public.can_review_roles(v.organization_id) then
    raise exception 'Los cargos nuevos los aprueba el backend.' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'Indica si apruebas el cargo.' using errcode = '22023';
  end if;
  update role_catalog set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = v_me, reviewed_at = now()
    where id = v.id;
  if v.proposed_event is not null then
    perform public._log(v.proposed_event, 'planning_updated',
      format('%s %s el cargo «%s»%s', public._actor_name(v_me), case when p_approve then 'aprobó' else 'no aprobó' end, v.name,
             case when p_approve then ': ya está en el catálogo de todos.' else '.' end),
      1, 'role', v.id, jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end), false, v_me);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Permisos
-- ---------------------------------------------------------------------------

grant select on role_catalog to authenticated;
grant all on role_catalog to service_role;

revoke execute on function public._clean_profile(jsonb) from public, anon, authenticated;
revoke execute on function public._check_doc(text, text) from public, anon, authenticated;
revoke execute on function public._approvals_missing(uuid) from public, anon, authenticated;
revoke execute on function public._approvals_notice() from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.add_approval_item(uuid, text, text, text, text, text, jsonb)',
    'public.set_approval_profile(uuid, jsonb)',
    'public.update_approval_item(uuid, text, text, text, text, text)',
    'public.decide_casting(uuid, text, text)',
    'public.save_person(uuid, uuid, text, text, date, text, text, text, text, text)',
    'public.event_people_board(uuid)',
    'public.can_review_roles(uuid)',
    'public.propose_role(uuid, text)',
    'public.review_role(uuid, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- El usuario de ejemplo se llama como el rol que ve Fer en pantalla: Backend.
update profiles set full_name = 'Backend de ejemplo' where full_name = 'Torre de control de ejemplo';
