-- MANDO · Mando de marca y pedidos especiales (decisión 95).
--
-- 1. Cada organización que usa MANDO firma su propio mando: «MANDO Momentum», «MANDO Circus».
--    Guarda el nombre que acompaña a MANDO, de qué grupo viene (McCann Erickson) y su logo.
-- 2. Cada mando tiene sus pedidos especiales: lo que esa agencia quiere distinto (por ejemplo, priorizar
--    ciertas palabras). Se registran, se cotizan y se activan; los que se cobran quedan marcados.
--
-- El logo va al cubo privado en org/<organización>/logo/<archivo>. Solo lo sube quien administra la
-- organización, y lo ve quien ve la organización.

alter table organizations add column if not exists brand_name  text;
alter table organizations add column if not exists parent_name text;
alter table organizations add column if not exists logo_path   text;

do $$
begin
  alter table organizations add constraint organizations_brand_name_len check (brand_name is null or length(brand_name) between 1 and 40);
exception when duplicate_object then null;
end $$;
do $$
begin
  alter table organizations add constraint organizations_parent_name_len check (parent_name is null or length(parent_name) between 1 and 80);
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 1 · La marca del mando
-- ---------------------------------------------------------------------------

create or replace function public.org_logo_path_ok(p_org uuid, p_name text) returns boolean
language sql immutable as $$
  select split_part(p_name, '/', 1) = 'org'
     and split_part(p_name, '/', 2) = p_org::text
     and split_part(p_name, '/', 3) = 'logo'
     and p_name ~* '\.(png|jpe?g|webp)$'
$$;

create or replace function public.set_org_brand(p_org uuid, p_brand_name text, p_parent_name text default null,
                                                p_logo_path text default null, p_clear_logo boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_brand text := nullif(regexp_replace(trim(coalesce(p_brand_name, '')), '\s+', ' ', 'g'), '');
  v_parent text := nullif(regexp_replace(trim(coalesce(p_parent_name, '')), '\s+', ' ', 'g'), '');
begin
  if not public.is_org_admin(p_org) then
    raise exception 'La marca del mando la cambia quien administra la organización.' using errcode = '42501';
  end if;
  if v_brand is not null and length(v_brand) > 40 then
    raise exception 'El nombre que acompaña a MANDO es muy largo (máximo 40 letras).' using errcode = '22023';
  end if;
  if v_parent is not null and length(v_parent) > 80 then
    raise exception 'El nombre del grupo es muy largo.' using errcode = '22023';
  end if;
  if p_logo_path is not null and not public.org_logo_path_ok(p_org, p_logo_path) then
    raise exception 'El logo tiene que ser PNG, JPG o WebP.' using errcode = '22023';
  end if;
  update organizations
     set brand_name = v_brand,
         parent_name = v_parent,
         logo_path = case when p_clear_logo then null else coalesce(p_logo_path, logo_path) end
   where id = p_org;
end $$;

create or replace function public.can_upload_org_logo(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_org text := split_part(p_name, '/', 2);
begin
  if split_part(p_name, '/', 1) <> 'org'
     or v_org !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.org_logo_path_ok(v_org::uuid, p_name) and public.is_org_admin(v_org::uuid);
end $$;

create or replace function public.can_read_org_logo(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_org text := split_part(p_name, '/', 2);
begin
  if split_part(p_name, '/', 1) <> 'org' or split_part(p_name, '/', 3) <> 'logo'
     or v_org !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.can_see_org(v_org::uuid);
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Pedidos especiales de cada mando
-- ---------------------------------------------------------------------------

create table if not exists organization_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title           text not null check (length(title) between 3 and 160),
  detail          text check (detail is null or length(detail) <= 2000),
  status          text not null default 'pedido'
                  check (status in ('pedido', 'cotizado', 'aprobado', 'activo', 'descartado')),
  billable        boolean not null default true,      -- una actualización a pedido se cobra
  quote_note      text check (quote_note is null or length(quote_note) <= 300),
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_by      uuid references profiles(id),
  updated_at      timestamptz not null default now()
);
create index if not exists organization_requests_org on organization_requests (organization_id, created_at desc);

alter table organization_requests enable row level security;
drop policy if exists organization_requests_read on organization_requests;
create policy organization_requests_read on organization_requests for select to authenticated
  using (public.is_org_admin(organization_id));
-- Sin políticas de insert, update ni delete: todo pasa por las funciones de abajo. Nada se borra.

create or replace function public.request_customization(p_org uuid, p_title text, p_detail text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_title text := nullif(regexp_replace(trim(coalesce(p_title, '')), '\s+', ' ', 'g'), '');
  v_detail text := nullif(trim(coalesce(p_detail, '')), '');
  v_id uuid;
begin
  if not public.is_org_admin(p_org) then
    raise exception 'Los pedidos especiales los hace quien administra la organización.' using errcode = '42501';
  end if;
  if v_title is null or length(v_title) < 3 or length(v_title) > 160 then
    raise exception 'Cuenta en una línea qué quieres distinto.' using errcode = '22023';
  end if;
  if length(coalesce(v_detail, '')) > 2000 then
    raise exception 'El detalle es muy largo.' using errcode = '22023';
  end if;
  insert into organization_requests (organization_id, title, detail, created_by, updated_by)
  values (p_org, v_title, v_detail, auth.uid(), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.set_customization_status(p_request uuid, p_status text, p_billable boolean default null,
                                                           p_quote_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r organization_requests;
begin
  select * into r from organization_requests where id = p_request for update;
  if not found then raise exception 'El pedido no existe.'; end if;
  if not public.is_org_admin(r.organization_id) then
    raise exception 'Solo quien administra la organización cambia el estado de un pedido.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('pedido', 'cotizado', 'aprobado', 'activo', 'descartado') then
    raise exception 'Elige un estado válido.' using errcode = '22023';
  end if;
  if length(coalesce(p_quote_note, '')) > 300 then
    raise exception 'La nota de cotización es muy larga.' using errcode = '22023';
  end if;
  update organization_requests
     set status = p_status,
         billable = coalesce(p_billable, billable),
         quote_note = coalesce(nullif(trim(coalesce(p_quote_note, '')), ''), quote_note),
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_request;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Permisos
-- ---------------------------------------------------------------------------

grant select on organization_requests to authenticated;
grant all on organization_requests to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public.set_org_brand(uuid, text, text, text, boolean)', 'public.can_upload_org_logo(text)', 'public.can_read_org_logo(text)',
    'public.request_customization(uuid, text, text)', 'public.set_customization_status(uuid, text, boolean, text)',
    'public.org_logo_path_ok(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists org_logo_insert on storage.objects;
    create policy org_logo_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'evidences' and public.can_upload_org_logo(name));
    drop policy if exists org_logo_read on storage.objects;
    create policy org_logo_read on storage.objects for select to authenticated
      using (bucket_id = 'evidences' and public.can_read_org_logo(name));
  end if;
end $$;
