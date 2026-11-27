-- MANDO · Migración 21 · Tipos de evento personalizados guardados (decisión 84).
--
-- El productor general arma un evento personalizado (nombre + componentes de config/personalizado.json)
-- y lo guarda para reusarlo. Se guarda en su organización: lo ven y lo usan solo los administradores
-- de esa organización (quienes crean eventos). Se escribe solo con las funciones de abajo.

create table if not exists custom_event_types (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null check (length(trim(name)) between 3 and 60),
  modules         text[] not null check (cardinality(modules) between 1 and 60),
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists custom_event_types_name_idx on custom_event_types (organization_id, lower(name));

alter table custom_event_types enable row level security;
drop policy if exists custom_event_types_read on custom_event_types;
create policy custom_event_types_read on custom_event_types for select to authenticated
  using (public.is_org_admin(organization_id));

-- Guarda (o actualiza, si ya hay uno con el mismo nombre) un tipo personalizado.
create or replace function public.save_custom_event_type(p_org uuid, p_name text, p_modules text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_name text := nullif(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  v_modules text[];
  v_id uuid;
begin
  if v_me is null or not public.is_org_admin(p_org) then
    raise exception 'Solo el productor general guarda tipos de evento.' using errcode = '42501';
  end if;
  if v_name is null or length(v_name) < 3 or length(v_name) > 60 then
    raise exception 'Ponle un nombre de 3 a 60 letras a tu tipo de evento.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct m order by m), '{}') into v_modules
  from unnest(coalesce(p_modules, '{}')) m
  where m ~ '^[a-z0-9-]{1,40}$';
  if cardinality(v_modules) = 0 or cardinality(v_modules) > 60 then
    raise exception 'Marca al menos un componente.' using errcode = '22023';
  end if;

  select id into v_id from custom_event_types where organization_id = p_org and lower(name) = lower(v_name);
  if v_id is null then
    insert into custom_event_types (organization_id, name, modules, created_by)
    values (p_org, v_name, v_modules, v_me) returning id into v_id;
  else
    update custom_event_types set name = v_name, modules = v_modules, updated_at = now() where id = v_id;
  end if;
  return v_id;
end $$;

-- Borra un tipo guardado. Los eventos ya creados con él no cambian: llevan su propia copia.
create or replace function public.delete_custom_event_type(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from custom_event_types where id = p_id;
  if v_org is null or not public.is_org_admin(v_org) then
    raise exception 'Solo el productor general borra tipos de evento.' using errcode = '42501';
  end if;
  delete from custom_event_types where id = p_id;
end $$;

grant select on custom_event_types to authenticated;
grant all on custom_event_types to service_role;
revoke execute on function public.save_custom_event_type(uuid, text, text[]) from public, anon;
revoke execute on function public.delete_custom_event_type(uuid) from public, anon;
grant execute on function public.save_custom_event_type(uuid, text, text[]) to authenticated, service_role;
grant execute on function public.delete_custom_event_type(uuid) to authenticated, service_role;
