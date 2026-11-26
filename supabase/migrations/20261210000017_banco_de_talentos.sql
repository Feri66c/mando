-- MANDO · Migración 17 · Banco de talentos (decisiones 55 a 58).
--
--   1. La base de personas de la organización pasa a ser un banco de talentos: cada persona guarda sus
--      categorías (anfitriona, modelo, host...), su mini ficha y la constancia de que autorizó guardar sus datos.
--      Se reconoce por tipo y número de documento, en todos los eventos.
--   2. Del banco al casting con un toque: la persona entra con su foto y su ficha al casting del evento.
--   3. Importar una lista (CSV de la castinera) y exportar el banco.
-- No hay tablas nuevas: se amplían people y event_approvals, que ya tienen seguridad por fila. Los datos
-- personales siguen visibles solo para quienes manejan la base (niveles 1 y 2). Pruebas en tests/db/talentos.test.ts.

alter table people add column if not exists categories text[] not null default '{}';
alter table people add column if not exists profile jsonb not null default '{}'::jsonb;
alter table people add column if not exists consent_at timestamptz;
alter table people add column if not exists consent_by uuid references profiles(id);
alter table people add column if not exists source text not null default 'manual';
alter table people drop constraint if exists people_source_check;
alter table people add constraint people_source_check check (source in ('manual', 'csv'));
create index if not exists people_categories_idx on people using gin (categories);

alter table event_approvals add column if not exists person_id uuid references people(id) on delete set null;
create index if not exists event_approvals_person_idx on event_approvals (person_id) where person_id is not null;

-- Categorías limpias: en minúsculas, sin repetidos, hasta 12.
create or replace function public._clean_categories(p_categories text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(c order by c), '{}')
  from (select distinct left(lower(regexp_replace(trim(x), '\s+', ' ', 'g')), 40) as c
        from unnest(coalesce(p_categories, '{}')) x where trim(x) <> '' limit 12) t
$$;

-- ---------------------------------------------------------------------------
-- 1 · Guardar un talento
-- ---------------------------------------------------------------------------

-- Registrar o actualizar. Si el documento ya está en el banco, se actualiza esa ficha: vuelve con sus datos.
-- La mini ficha se suma a la que había (lo nuevo pisa lo viejo, lo que no se manda se conserva).
create or replace function public.save_talent(
  p_event uuid, p_person uuid, p_full_name text, p_doc_type text default 'dni', p_doc_number text default null,
  p_categories text[] default null, p_profile jsonb default null, p_phone text default null,
  p_photo_path text default null, p_consent boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_org uuid;
  v_id uuid := p_person;
  v_new boolean := false;
  v_type text := coalesce(nullif(trim(coalesce(p_doc_type, '')), ''), 'dni');
  v_doc text;
  v_photo text := nullif(trim(coalesce(p_photo_path, '')), '');
  v_name text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_cats text[] := public._clean_categories(p_categories);
  v_profile jsonb := public._clean_profile(p_profile);
begin
  perform public._require_planner(p_event);
  select organization_id into v_org from events where id = p_event;
  if v_name = '' then
    raise exception 'Escribe el nombre completo.' using errcode = '22023';
  end if;
  v_doc := public._check_doc(v_type, p_doc_number);
  perform public._check_person_file(v_org, v_photo);
  if v_id is null and v_doc is not null then
    select id into v_id from people where organization_id = v_org and doc_type = v_type and doc_number = v_doc;
  end if;
  if v_id is null then
    if not coalesce(p_consent, false) then
      raise exception 'Confirma que la persona autorizó guardar sus datos y su foto.' using errcode = '22023';
    end if;
    insert into people (organization_id, full_name, doc_type, doc_number, phone, photo_path, categories, profile, consent_at, consent_by, created_by)
    values (v_org, v_name, v_type, v_doc, nullif(trim(coalesce(p_phone, '')), ''), v_photo, v_cats, v_profile, now(), v_me, v_me)
    returning id into v_id;
    v_new := true;
  else
    update people set
      full_name = v_name,
      doc_type = case when v_doc is null then doc_type else v_type end,
      doc_number = coalesce(v_doc, doc_number),
      phone = coalesce(nullif(trim(coalesce(p_phone, '')), ''), phone),
      photo_path = coalesce(v_photo, photo_path),
      categories = case when p_categories is null then categories else v_cats end,
      profile = profile || v_profile,
      consent_at = case when coalesce(p_consent, false) and consent_at is null then now() else consent_at end,
      consent_by = case when coalesce(p_consent, false) and consent_at is null then v_me else consent_by end,
      updated_at = now()
    where id = v_id and organization_id = v_org;
    if not found then
      raise exception 'Esa persona no está en el banco de esta organización.' using errcode = '42501';
    end if;
  end if;
  perform public._log(p_event, 'planning_updated',
    format('%s %s a %s en el banco de talentos.', public._actor_name(v_me), case when v_new then 'registró' else 'actualizó' end, v_name),
    1, 'person', v_id, jsonb_build_object('talent', true, 'new', v_new), false, v_me);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Leer el banco. Solo quienes manejan la base (niveles 1 y 2).
-- ---------------------------------------------------------------------------

create or replace function public.talent_bank(p_event uuid)
returns table (person_id uuid, full_name text, doc_type text, doc_number text, phone text, photo_path text, categories text[],
               profile jsonb, default_role text, consent boolean, events int, in_casting boolean, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_planner(p_event);
  return query
    select p.id, p.full_name, p.doc_type, p.doc_number, p.phone, p.photo_path, p.categories, p.profile, p.default_role,
           p.consent_at is not null,
           (select count(distinct x.event_id)::int from (
              select ep.event_id from event_people ep where ep.person_id = p.id
              union all
              select a.event_id from event_approvals a where a.person_id = p.id and a.removed_at is null) x),
           exists (select 1 from event_approvals a where a.event_id = p_event and a.person_id = p.id and a.removed_at is null),
           p.updated_at
    from people p join events e on e.id = p_event and e.organization_id = p.organization_id
    order by p.full_name;
end $$;

-- Buscar por documento: «si vuelvo a escribir el DNI de Mayra, vuelve con sus datos».
create or replace function public.find_talent(p_event uuid, p_doc_type text, p_doc_number text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_doc text; v_id uuid;
begin
  perform public._require_planner(p_event);
  v_doc := public._check_doc(coalesce(p_doc_type, 'dni'), p_doc_number);
  if v_doc is null then
    return null;
  end if;
  select p.id into v_id from people p join events e on e.id = p_event and e.organization_id = p.organization_id
   where p.doc_type = coalesce(p_doc_type, 'dni') and p.doc_number = v_doc;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Del banco al casting
-- ---------------------------------------------------------------------------

create or replace function public.add_casting_from_talent(p_event uuid, p_person uuid, p_detail text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v people;
  v_id uuid;
  v_n int;
  v_code text;
begin
  perform public._require_planner(p_event);
  if (select status from events where id = p_event) = 'closed' then
    raise exception 'El evento está cerrado: ya no acepta cambios.' using errcode = '42501';
  end if;
  select p.* into v from people p join events e on e.organization_id = p.organization_id where p.id = p_person and e.id = p_event;
  if not found then
    raise exception 'Esa persona no está en el banco de esta organización.' using errcode = '42501';
  end if;
  if exists (select 1 from event_approvals where event_id = p_event and person_id = p_person and removed_at is null) then
    raise exception '% ya está en el casting de este evento.', v.full_name using errcode = '22023';
  end if;
  perform 1 from events where id = p_event for update;   -- un código a la vez
  select count(*) + 1 into v_n from event_approvals where event_id = p_event and group_key = 'casting';
  v_code := 'C-' || lpad(v_n::text, 2, '0');
  insert into event_approvals (event_id, group_key, code, name, detail, file_path, profile, person_id, created_by)
  values (p_event, 'casting', v_code, v.full_name,
          coalesce(nullif(trim(coalesce(p_detail, '')), ''), initcap(v.categories[1]), v.default_role),
          v.photo_path, v.profile, v.id, v_me)
  returning id into v_id;
  perform public._log(p_event, 'approval_updated',
    format('%s sumó a %s al casting desde el banco de talentos (%s).', public._actor_name(v_me), v.full_name, v_code),
    1, 'approval', v_id, jsonb_build_object('group', 'casting', 'status', 'pending', 'talent', true), true, v_me);
  return v_id;
end $$;

-- La foto de una persona del banco la ve también el cliente del evento donde esa persona está en casting.
create or replace function public.can_read_person_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  if split_part(p_name, '/', 1) <> 'personas' or split_part(p_name, '/', 3) not in ('foto', 'dni')
     or split_part(p_name, '/', 2) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_org := split_part(p_name, '/', 2)::uuid;
  if public.can_manage_people(v_org) then return true; end if;
  if split_part(p_name, '/', 3) <> 'foto' then return false; end if;
  return exists (select 1 from event_members m join events e on e.id = m.event_id
                 where e.organization_id = v_org and m.profile_id = auth.uid() and m.role <> 'viewer')
      or exists (select 1 from event_approvals a
                 where a.file_path = p_name and a.removed_at is null and public.is_event_member(a.event_id));
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Importar una lista
-- ---------------------------------------------------------------------------

-- p_rows: [{ "nombre": "...", "tipo": "dni", "documento": "...", "telefono": "...", "categorias": ["modelo"], "ficha": {...} }]
-- Devuelve cuántas se crearon, cuántas se actualizaron y qué filas se saltó, con el motivo.
create or replace function public.import_talents(p_event uuid, p_rows jsonb, p_consent boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_org uuid;
  r jsonb;
  v_n int := 0;
  v_created int := 0;
  v_updated int := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_name text; v_type text; v_doc text; v_id uuid; v_cats text[]; v_profile jsonb; v_phone text;
begin
  perform public._require_planner(p_event);
  select organization_id into v_org from events where id = p_event;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'La lista está vacía.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'La lista tiene más de 500 personas. Divídela en partes.' using errcode = '22023';
  end if;
  if not coalesce(p_consent, false) then
    raise exception 'Confirma que estas personas autorizaron guardar sus datos.' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_n := v_n + 1;
    v_name := regexp_replace(trim(coalesce(r ->> 'nombre', '')), '\s+', ' ', 'g');
    if v_name = '' then
      v_skipped := v_skipped || jsonb_build_object('fila', v_n, 'motivo', 'Falta el nombre');
      continue;
    end if;
    v_type := coalesce(nullif(trim(coalesce(r ->> 'tipo', '')), ''), 'dni');
    begin
      v_doc := public._check_doc(v_type, r ->> 'documento');
    exception when sqlstate '22023' then
      v_skipped := v_skipped || jsonb_build_object('fila', v_n, 'motivo', v_name || ': ' || sqlerrm);
      continue;
    end;
    v_cats := public._clean_categories(array(select jsonb_array_elements_text(
                case when jsonb_typeof(r -> 'categorias') = 'array' then r -> 'categorias' else '[]'::jsonb end)));
    v_profile := public._clean_profile(r -> 'ficha');
    v_phone := nullif(trim(coalesce(r ->> 'telefono', '')), '');

    v_id := null;
    if v_doc is not null then
      select id into v_id from people where organization_id = v_org and doc_type = v_type and doc_number = v_doc;
    else
      -- Sin documento: la misma persona es la que tiene el mismo nombre y tampoco tiene documento.
      select id into v_id from people where organization_id = v_org and doc_number is null and lower(full_name) = lower(v_name) limit 1;
    end if;
    if v_id is null then
      insert into people (organization_id, full_name, doc_type, doc_number, phone, categories, profile, consent_at, consent_by, source, created_by)
      values (v_org, v_name, v_type, v_doc, v_phone, v_cats, v_profile, now(), v_me, 'csv', v_me);
      v_created := v_created + 1;
    else
      update people set full_name = v_name, phone = coalesce(v_phone, phone),
        categories = public._clean_categories(categories || v_cats), profile = profile || v_profile,
        consent_at = coalesce(consent_at, now()), consent_by = coalesce(consent_by, v_me), updated_at = now()
      where id = v_id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  perform public._log(p_event, 'planning_updated',
    format('%s importó una lista al banco de talentos: %s nuevas, %s actualizadas, %s sin entrar.',
           public._actor_name(v_me), v_created, v_updated, jsonb_array_length(v_skipped)),
    1, 'event', p_event, jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', jsonb_array_length(v_skipped)), false, v_me);
  return jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped);
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Permisos
-- ---------------------------------------------------------------------------

revoke execute on function public._clean_categories(text[]) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.save_talent(uuid, uuid, text, text, text, text[], jsonb, text, text, boolean)',
    'public.talent_bank(uuid)',
    'public.find_talent(uuid, text, text)',
    'public.add_casting_from_talent(uuid, uuid, text)',
    'public.can_read_person_file(text)',
    'public.import_talents(uuid, jsonb, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
