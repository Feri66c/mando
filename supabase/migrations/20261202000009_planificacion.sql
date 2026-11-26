-- MANDO · Migración 9 · Planificación: los 5 elementos y el candado del timeline (decisiones 30 a 33).
--
--   1. Base de personas de la organización: se registran una vez (nombre, DNI, vigencia, foto) y en cada evento
--      se eligen con un check.
--   2. Lista técnica del evento, con obligatorios y «por completar» hasta 24 o 2 horas antes.
--   3. Presupuesto: monto global que el cliente aprueba; el desglose lo ve la productora solo si el productor
--      general lo habilita.
--   4. Los 5 elementos (legal, personal, técnico, presupuesto, aprobaciones): mientras falte uno, las piezas clave
--      no se pueden marcar como empezadas.
-- Toda tabla nueva tiene seguridad por fila y su prueba en tests/db. La bitácora sigue sin poder editarse.

alter type log_kind add value if not exists 'planning_updated';

alter table events add column if not exists planning_gate boolean not null default false;

-- ---------------------------------------------------------------------------
-- 1 · Personas
-- ---------------------------------------------------------------------------

create table if not exists people (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  full_name       text not null check (length(trim(full_name)) > 0),
  doc_number      text,                       -- DNI o carné de extranjería
  doc_expires_on  date,
  doc_path        text,                       -- copia del DNI, en el cubo privado
  photo_path      text,
  phone           text,
  default_role    text,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, doc_number)
);

create table if not exists event_people (
  event_id   uuid not null references events(id) on delete cascade,
  person_id  uuid not null references people(id) on delete cascade,
  role       text not null check (length(trim(role)) > 0),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  primary key (event_id, person_id)
);

-- Quién maneja la base de personas: el administrador de la organización y los niveles 1 y 2 de sus eventos.
create or replace function public.can_manage_people(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_org_admin(p_org)
      or exists (select 1 from event_members m join events e on e.id = m.event_id
                 where e.organization_id = p_org and m.profile_id = auth.uid()
                   and m.role <> 'viewer' and coalesce(m.level, 4) <= 2)
$$;

alter table people enable row level security;
alter table event_people enable row level security;
-- Los datos personales (DNI, teléfono) solo los leen quienes manejan la base. El resto del equipo ve nombre,
-- rol y foto a través de event_people_board().
drop policy if exists people_read on people;
create policy people_read on people for select to authenticated using (public.can_manage_people(organization_id));
drop policy if exists event_people_read on event_people;
create policy event_people_read on event_people for select to authenticated using (public.is_event_team(event_id));

create or replace function public._person_doc_state(p people, p_date date) returns text
language sql immutable as $$
  select case
    when p.doc_number is null or p.doc_path is null then 'sin_dni'
    when p.doc_expires_on is null then 'sin_vigencia'
    when p.doc_expires_on < p_date then 'vencido'
    else 'vigente' end
$$;

-- Fecha contra la que se revisa la vigencia: el día del evento.
create or replace function public._event_day(p_event uuid) returns date
language sql stable security definer set search_path = public as $$
  select coalesce((starts_at at time zone timezone)::date, current_date) from events where id = p_event
$$;

create or replace function public._check_person_file(p_org uuid, p_path text) returns void
language plpgsql immutable as $$
begin
  if p_path is not null and p_path not like 'personas/' || p_org::text || '/%' then
    raise exception 'El archivo no pertenece a la base de personas de esta organización.' using errcode = '22023';
  end if;
end $$;

create or replace function public._require_planner(p_event uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if public._my_level(p_event) > 2 then
    raise exception 'Esto lo decide el productor general o el productor de campo.' using errcode = '42501';
  end if;
  perform public._require_team(p_event);
end $$;

-- Registrar o corregir a una persona. Si el DNI ya está en la base, se actualiza esa ficha: nadie se registra dos veces.
create or replace function public.save_person(
  p_event uuid, p_person uuid, p_full_name text, p_doc_number text default null, p_doc_expires_on date default null,
  p_phone text default null, p_default_role text default null, p_photo_path text default null, p_doc_path text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_org uuid;
  v_id uuid := p_person;
  v_doc text := nullif(regexp_replace(coalesce(p_doc_number, ''), '\s', '', 'g'), '');
  v_photo text := nullif(trim(coalesce(p_photo_path, '')), '');
  v_copy text := nullif(trim(coalesce(p_doc_path, '')), '');
begin
  perform public._require_planner(p_event);
  select organization_id into v_org from events where id = p_event;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Escribe el nombre completo.' using errcode = '22023';
  end if;
  perform public._check_person_file(v_org, v_photo);
  perform public._check_person_file(v_org, v_copy);
  if v_id is null and v_doc is not null then
    select id into v_id from people where organization_id = v_org and doc_number = v_doc;
  end if;
  if v_id is null then
    insert into people (organization_id, full_name, doc_number, doc_expires_on, phone, default_role, photo_path, doc_path, created_by)
    values (v_org, trim(p_full_name), v_doc, p_doc_expires_on, nullif(trim(coalesce(p_phone, '')), ''),
            nullif(trim(coalesce(p_default_role, '')), ''), v_photo, v_copy, v_me)
    returning id into v_id;
  else
    update people set
      full_name = trim(p_full_name),
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

-- Elegir (o quitar) a una persona para este evento.
create or replace function public.assign_person(p_event uuid, p_person uuid, p_role text, p_assigned boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_person people;
  v_role text;
begin
  perform public._require_planner(p_event);
  select p.* into v_person from people p join events e on e.organization_id = p.organization_id where p.id = p_person and e.id = p_event;
  if not found then
    raise exception 'Esa persona no está en la base de esta organización.' using errcode = '42501';
  end if;
  if not coalesce(p_assigned, true) then
    delete from event_people where event_id = p_event and person_id = p_person;
    if found then
      perform public._log(p_event, 'planning_updated', format('%s quitó a %s del personal.', public._actor_name(v_me), v_person.full_name),
        1, 'person', p_person, '{}'::jsonb, false, v_me);
    end if;
    return;
  end if;
  v_role := coalesce(nullif(trim(coalesce(p_role, '')), ''), v_person.default_role);
  if v_role is null then
    raise exception 'Indica qué hace esta persona en el evento.' using errcode = '22023';
  end if;
  insert into event_people (event_id, person_id, role, created_by) values (p_event, p_person, v_role, v_me)
  on conflict (event_id, person_id) do update set role = excluded.role;
  perform public._log(p_event, 'planning_updated', format('%s sumó a %s como %s.', public._actor_name(v_me), v_person.full_name, v_role),
    1, 'person', p_person, jsonb_build_object('role', v_role), false, v_me);
end $$;

-- La lista que ve la pantalla. Niveles 1 y 2: toda la base, con DNI. Niveles 3 y 4: solo el personal del evento, sin datos personales.
create or replace function public.event_people_board(p_event uuid)
returns table (person_id uuid, full_name text, default_role text, role text, assigned boolean, photo_path text,
               doc_state text, doc_number text, doc_expires_on date, doc_path text, phone text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_full boolean := public._my_level(p_event) <= 2;   -- también exige ser del equipo
  v_day date := public._event_day(p_event);
begin
  return query
    select p.id, p.full_name, p.default_role, ep.role, ep.person_id is not null, p.photo_path,
           public._person_doc_state(p, v_day),
           case when v_full then p.doc_number end, case when v_full then p.doc_expires_on end,
           case when v_full then p.doc_path end, case when v_full then p.phone end
    from people p
    join events e on e.id = p_event and e.organization_id = p.organization_id
    left join event_people ep on ep.event_id = p_event and ep.person_id = p.id
    where v_full or ep.person_id is not null
    order by (ep.person_id is null), p.full_name;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Lista técnica
-- ---------------------------------------------------------------------------

create table if not exists event_tech_items (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events(id) on delete cascade,
  category     text not null default 'otros',
  title        text not null check (length(trim(title)) > 0),
  detail       text,                         -- modelo, medidas, cantidad de canales...
  quantity     int not null default 1 check (quantity > 0),
  mandatory    boolean not null default false,
  due_hours    int check (due_hours in (24, 2)),   -- lo no obligatorio se completa hasta tantas horas antes
  status       text not null default 'pending' check (status in ('pending', 'confirmed', 'not_applicable')),
  confirmed_by uuid references profiles(id),
  confirmed_at timestamptz,
  sort_order   int not null default 0,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists event_tech_items_event_idx on event_tech_items (event_id, sort_order);

alter table event_tech_items enable row level security;
drop policy if exists event_tech_items_read on event_tech_items;
create policy event_tech_items_read on event_tech_items for select to authenticated using (public.is_event_team(event_id));

create or replace function public.add_tech_item(
  p_event uuid, p_category text, p_title text, p_detail text default null, p_quantity int default 1,
  p_mandatory boolean default false, p_due_hours int default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_me uuid := auth.uid();
begin
  perform public._require_coordinator(p_event);
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Escribe qué equipo es.' using errcode = '22023';
  end if;
  if p_due_hours is not null and p_due_hours not in (24, 2) then
    raise exception 'El plazo es de 24 o de 2 horas antes.' using errcode = '22023';
  end if;
  insert into event_tech_items (event_id, category, title, detail, quantity, mandatory, due_hours, sort_order, created_by)
  values (p_event, coalesce(nullif(trim(p_category), ''), 'otros'), trim(p_title), nullif(trim(coalesce(p_detail, '')), ''),
          greatest(coalesce(p_quantity, 1), 1), coalesce(p_mandatory, false),
          case when coalesce(p_mandatory, false) then null else p_due_hours end,
          (select coalesce(max(sort_order), 0) + 1 from event_tech_items where event_id = p_event), v_me)
  returning id into v_id;
  perform public._log(p_event, 'planning_updated', format('%s agregó a la lista técnica: %s.', public._actor_name(v_me), trim(p_title)),
    1, 'tech_item', v_id, '{}'::jsonb, false, v_me);
  return v_id;
end $$;

-- Confirmar, volver a pendiente o marcar «no aplica». Sacar un obligatorio lo deciden los niveles 1 y 2.
create or replace function public.set_tech_item(p_item uuid, p_status text, p_detail text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v event_tech_items; v_me uuid := auth.uid();
begin
  select * into v from event_tech_items where id = p_item for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._require_coordinator(v.event_id);
  if p_status not in ('pending', 'confirmed', 'not_applicable') then
    raise exception 'Estado desconocido.' using errcode = '22023';
  end if;
  if p_status = 'not_applicable' and v.mandatory and public._my_level(v.event_id) > 2 then
    raise exception 'Sacar un obligatorio lo decide el productor general o el productor de campo.' using errcode = '42501';
  end if;
  update event_tech_items
    set status = p_status, detail = coalesce(nullif(trim(coalesce(p_detail, '')), ''), detail),
        confirmed_by = case when p_status = 'confirmed' then v_me end,
        confirmed_at = case when p_status = 'confirmed' then now() end
    where id = v.id;
  if p_status <> v.status then
    perform public._log(v.event_id, 'planning_updated',
      format('%s %s en la lista técnica: %s.', public._actor_name(v_me),
             case p_status when 'confirmed' then 'confirmó' when 'not_applicable' then 'marcó «no aplica»' else 'volvió a pendiente' end, v.title),
      1, 'tech_item', v.id, jsonb_build_object('status', p_status), false, v_me);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Presupuesto
-- ---------------------------------------------------------------------------

create table if not exists event_budgets (
  event_id          uuid primary key references events(id) on delete cascade,
  currency          text not null default 'PEN',
  total             numeric(12, 2) not null check (total > 0),
  breakdown_visible boolean not null default false,   -- ¿la productora ve el desglose?
  status            text not null default 'sent' check (status in ('sent', 'approved', 'changes_requested')),
  decision_note     text,
  decided_by        uuid references profiles(id),
  decided_at        timestamptz,
  updated_by        uuid references profiles(id),
  updated_at        timestamptz not null default now()
);

create table if not exists event_budget_lines (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  concept_key text,                            -- clave de config/costos-referencia.json, si aplica
  title       text not null check (length(trim(title)) > 0),
  quantity    numeric(10, 2) not null default 1 check (quantity > 0),
  unit_cost   numeric(12, 2) not null check (unit_cost >= 0),
  created_at  timestamptz not null default now()
);
create index if not exists event_budget_lines_event_idx on event_budget_lines (event_id, created_at);

-- El monto global lo ven el cliente (lo aprueba) y los niveles 1 y 2. El desglose, el productor general siempre
-- y el productor de campo solo si se le habilitó. Coordinación y técnicos no ven montos.
create or replace function public.can_see_budget(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_members m where m.event_id = p_event and m.profile_id = auth.uid()
                 and (m.role = 'viewer' or coalesce(m.level, 4) <= 2))
$$;
create or replace function public.can_see_budget_lines(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_members m where m.event_id = p_event and m.profile_id = auth.uid()
                 and (m.role = 'backend'
                      or (m.role = 'producer' and coalesce(m.level, 4) <= 2
                          and coalesce((select breakdown_visible from event_budgets b where b.event_id = p_event), false))))
$$;

alter table event_budgets enable row level security;
alter table event_budget_lines enable row level security;
drop policy if exists event_budgets_read on event_budgets;
create policy event_budgets_read on event_budgets for select to authenticated using (public.can_see_budget(event_id));
drop policy if exists event_budget_lines_read on event_budget_lines;
create policy event_budget_lines_read on event_budget_lines for select to authenticated using (public.can_see_budget_lines(event_id));

create or replace function public._require_backend(p_event uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_team(p_event);
  if not public.is_event_backend(p_event) then
    raise exception 'El presupuesto lo maneja el productor general.' using errcode = '42501';
  end if;
end $$;

-- Cargar o cambiar el monto. Si el monto cambia, el cliente tiene que aprobarlo de nuevo.
create or replace function public.set_budget(p_event uuid, p_total numeric, p_breakdown_visible boolean default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_old event_budgets;
begin
  perform public._require_backend(p_event);
  if p_total is null or p_total <= 0 then
    raise exception 'Escribe el monto del presupuesto.' using errcode = '22023';
  end if;
  select * into v_old from event_budgets where event_id = p_event for update;
  if not found then
    insert into event_budgets (event_id, total, breakdown_visible, updated_by)
    values (p_event, p_total, coalesce(p_breakdown_visible, false), v_me);
    perform public._log(p_event, 'planning_updated', format('%s cargó el presupuesto para aprobación del cliente.', public._actor_name(v_me)),
      1, 'budget', p_event, '{}'::jsonb, true, v_me);
    return;
  end if;
  update event_budgets set
    total = p_total, breakdown_visible = coalesce(p_breakdown_visible, breakdown_visible),
    status = case when p_total <> v_old.total then 'sent' else status end,
    decision_note = case when p_total <> v_old.total then null else decision_note end,
    decided_by = case when p_total <> v_old.total then null else decided_by end,
    decided_at = case when p_total <> v_old.total then null else decided_at end,
    updated_by = v_me, updated_at = now()
  where event_id = p_event;
  if p_total <> v_old.total then
    perform public._log(p_event, 'planning_updated', format('%s cambió el presupuesto: vuelve a estar por aprobar.', public._actor_name(v_me)),
      1, 'budget', p_event, '{}'::jsonb, true, v_me);
  elsif coalesce(p_breakdown_visible, v_old.breakdown_visible) <> v_old.breakdown_visible then
    perform public._log(p_event, 'planning_updated',
      format('%s %s el desglose del presupuesto a la productora.', public._actor_name(v_me),
             case when p_breakdown_visible then 'habilitó' else 'ocultó' end),
      1, 'budget', p_event, '{}'::jsonb, false, v_me);
  end if;
end $$;

create or replace function public.add_budget_line(p_event uuid, p_title text, p_quantity numeric, p_unit_cost numeric, p_concept_key text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public._require_backend(p_event);
  if coalesce(trim(p_title), '') = '' or p_quantity is null or p_quantity <= 0 or p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'Completa la partida: qué es, cuántos y cuánto cuesta cada uno.' using errcode = '22023';
  end if;
  insert into event_budget_lines (event_id, concept_key, title, quantity, unit_cost)
  values (p_event, nullif(trim(coalesce(p_concept_key, '')), ''), trim(p_title), p_quantity, p_unit_cost)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.remove_budget_line(p_line uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_event uuid;
begin
  select event_id into v_event from event_budget_lines where id = p_line;
  if v_event is null then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._require_backend(v_event);
  delete from event_budget_lines where id = p_line;
end $$;

-- Aprueba el cliente. El productor general puede registrar una aprobación recibida por otro medio, diciendo cómo.
create or replace function public.decide_budget(p_event uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_role event_role := public.my_event_role(p_event);
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if v_me is null or v_role is null or v_role = 'producer' then
    raise exception 'El presupuesto lo aprueba el cliente.' using errcode = '42501';
  end if;
  if (select status from events where id = p_event) = 'closed' then
    raise exception 'El evento está cerrado: ya no acepta cambios.' using errcode = '42501';
  end if;
  if p_approve is null or (not p_approve and v_note is null) then
    raise exception 'Cuenta qué hay que cambiar.' using errcode = '22023';
  end if;
  if v_role = 'backend' and v_note is null then
    raise exception 'Anota cómo te dio el cliente su aprobación (llamada, correo, WhatsApp).' using errcode = '22023';
  end if;
  update event_budgets set status = case when p_approve then 'approved' else 'changes_requested' end,
         decision_note = v_note, decided_by = v_me, decided_at = now()
  where event_id = p_event;
  if not found then
    raise exception 'Todavía no hay un presupuesto cargado.' using errcode = '22023';
  end if;
  perform public._log(p_event, 'planning_updated',
    case
      when v_role = 'backend' then format('%s registró que el cliente %s el presupuesto: %s', public._actor_name(v_me),
                                          case when p_approve then 'aprobó' else 'pidió un cambio en' end, v_note)
      when p_approve then format('%s aprobó el presupuesto.', public._actor_name(v_me))
      else format('%s pidió un cambio en el presupuesto: %s', public._actor_name(v_me), v_note)
    end,
    case when p_approve then 1 else 2 end, 'budget', p_event, jsonb_build_object('approved', p_approve), true, v_me);
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Los 5 elementos y el candado
-- ---------------------------------------------------------------------------

create or replace function public._planning_status(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_day date := public._event_day(p_event);
  v_docs_total int; v_docs_open int; v_people int; v_people_bad int;
  v_tech_total int; v_tech_must int; v_tech_open int;
  v_budget text; v_approvals text;
  v_missing text[];
  v_out jsonb := '[]'::jsonb;
begin
  -- Legal: documentos no negociables y la identidad del equipo.
  select count(*), count(*) filter (where status = 'pending') into v_docs_total, v_docs_open
    from event_requirements where event_id = p_event and mandatory and status <> 'not_applicable';
  select count(*), count(*) filter (where public._person_doc_state(p, v_day) <> 'vigente' or p.photo_path is null)
    into v_people, v_people_bad
    from event_people ep join people p on p.id = ep.person_id where ep.event_id = p_event;
  v_missing := '{}';
  if v_docs_open > 0 then v_missing := v_missing || case when v_docs_open = 1 then '1 documento no negociable por subir' else format('%s documentos no negociables por subir', v_docs_open) end; end if;
  if v_people_bad > 0 then v_missing := v_missing || case when v_people_bad = 1 then '1 persona sin foto o sin DNI vigente' else format('%s personas sin foto o sin DNI vigente', v_people_bad) end; end if;
  v_out := v_out || jsonb_build_object('key', 'legal', 'ready', cardinality(v_missing) = 0,
    'done', (v_docs_total - v_docs_open) + (v_people - v_people_bad), 'total', v_docs_total + v_people, 'missing', to_jsonb(v_missing));

  -- Personal: al menos una persona elegida.
  v_out := v_out || jsonb_build_object('key', 'personal', 'ready', v_people > 0, 'done', v_people, 'total', greatest(v_people, 1),
    'missing', case when v_people > 0 then '[]'::jsonb else '["Falta elegir al personal"]'::jsonb end);

  -- Técnico: los obligatorios confirmados.
  select count(*) filter (where status <> 'not_applicable'),
         count(*) filter (where mandatory and status <> 'not_applicable'),
         count(*) filter (where mandatory and status = 'pending')
    into v_tech_total, v_tech_must, v_tech_open from event_tech_items where event_id = p_event;
  v_missing := '{}';
  if v_tech_total = 0 then v_missing := v_missing || 'Falta la lista técnica'::text;
  elsif v_tech_open > 0 then v_missing := v_missing || case when v_tech_open = 1 then '1 obligatorio por confirmar' else format('%s obligatorios por confirmar', v_tech_open) end; end if;
  v_out := v_out || jsonb_build_object('key', 'tecnico', 'ready', cardinality(v_missing) = 0,
    'done', v_tech_must - v_tech_open, 'total', greatest(v_tech_must, 1), 'missing', to_jsonb(v_missing));

  -- Presupuesto: aprobado por el cliente.
  select status into v_budget from event_budgets where event_id = p_event;
  v_out := v_out || jsonb_build_object('key', 'presupuesto', 'ready', coalesce(v_budget = 'approved', false),
    'done', case when v_budget = 'approved' then 1 else 0 end, 'total', 1,
    'missing', case v_budget when 'approved' then '[]'::jsonb
                 when 'sent' then '["Falta la aprobación del cliente"]'::jsonb
                 when 'changes_requested' then '["El cliente pidió un cambio"]'::jsonb
                 else '["Falta cargar el presupuesto"]'::jsonb end);

  -- Aprobaciones del cliente: la misma cuenta de la migración 8.
  v_approvals := public._approvals_missing(p_event);
  v_out := v_out || jsonb_build_object('key', 'aprobaciones', 'ready', v_approvals is null,
    'done', (select count(*) from event_approvals a join events e on e.id = a.event_id
             where a.event_id = p_event and a.removed_at is null and a.status = 'approved' and a.group_key = any (e.approval_groups)),
    'total', greatest((select count(*) from event_approvals a join events e on e.id = a.event_id
             where a.event_id = p_event and a.removed_at is null and a.group_key = any (e.approval_groups)), 1),
    'missing', case when v_approvals is null then '[]'::jsonb else to_jsonb(string_to_array(v_approvals, '; ')) end);
  return v_out;
end $$;

-- Lo que lee la pantalla. La ve todo miembro del evento: el cliente también necesita saber qué falta.
create or replace function public.planning_status(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_event_member(p_event) then
    raise exception 'No tienes permiso para ver este evento.' using errcode = '42501';
  end if;
  return jsonb_build_object('gate', (select planning_gate from events where id = p_event), 'elements', public._planning_status(p_event));
end $$;

-- Texto con lo que falta para empezar, o null. Eventos con candado: los 5 elementos. El resto: solo aprobaciones.
create or replace function public._planning_missing(p_event uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when (select planning_gate from events where id = p_event) then (
    select string_agg((case e ->> 'key' when 'legal' then 'Legal' when 'personal' then 'Personal' when 'tecnico' then 'Técnico' when 'presupuesto' then 'Presupuesto' else 'Aprobaciones' end) || ': ' || (select string_agg(m, ', ') from jsonb_array_elements_text(e -> 'missing') m), '; ')
    from jsonb_array_elements(public._planning_status(p_event)) e where not (e ->> 'ready')::boolean
  ) else public._approvals_missing(p_event) end
$$;

create or replace function public._route_items_approval_gate() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_missing text;
begin
  if new.is_milestone and old.actual_start is null and new.actual_start is not null then
    v_missing := public._planning_missing(new.event_id);
    if v_missing is not null then
      raise exception 'No se puede empezar «%»: falta completar la planificación (%).', new.title, v_missing using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- Los eventos nuevos nacen con el candado y con su lista técnica.
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
  if jsonb_typeof(new.template -> 'tecnica') = 'array' then
    insert into event_tech_items (event_id, category, title, mandatory, due_hours, sort_order)
    select new.id, coalesce(t.value ->> 'categoria', 'otros'), trim(t.value ->> 'titulo'),
           coalesce((t.value ->> 'obligatorio')::boolean, false),
           case when (t.value ->> 'plazo_horas') in ('24', '2') and not coalesce((t.value ->> 'obligatorio')::boolean, false)
                then (t.value ->> 'plazo_horas')::int end,
           t.ordinality
    from jsonb_array_elements(new.template -> 'tecnica') with ordinality t
    where coalesce(trim(t.value ->> 'titulo'), '') <> '';
  end if;
  if (new.template ->> 'planificacion') = 'true' then
    update events set planning_gate = true where id = new.id;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Archivos, permisos y tiempo real
-- ---------------------------------------------------------------------------

-- Fotos y copias de DNI: personas/<organización>/foto|dni/<archivo>. Las suben quienes manejan la base.
-- La foto la ve el equipo de los eventos de esa organización; la copia del DNI, solo quienes manejan la base.
create or replace function public.can_upload_person_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if split_part(p_name, '/', 1) <> 'personas' or split_part(p_name, '/', 3) not in ('foto', 'dni') or split_part(p_name, '/', 4) = ''
     or split_part(p_name, '/', 2) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.can_manage_people(split_part(p_name, '/', 2)::uuid);
end $$;

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
  return split_part(p_name, '/', 3) = 'foto'
     and exists (select 1 from event_members m join events e on e.id = m.event_id
                 where e.organization_id = v_org and m.profile_id = auth.uid() and m.role <> 'viewer');
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public._person_doc_state(people, date)', 'public._event_day(uuid)', 'public._check_person_file(uuid, text)',
    'public._require_planner(uuid)', 'public._require_backend(uuid)', 'public._planning_status(uuid)', 'public._planning_missing(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.can_manage_people(uuid)', 'public.can_see_budget(uuid)', 'public.can_see_budget_lines(uuid)',
    'public.can_upload_person_file(text)', 'public.can_read_person_file(text)',
    'public.save_person(uuid, uuid, text, text, date, text, text, text, text)',
    'public.assign_person(uuid, uuid, text, boolean)', 'public.event_people_board(uuid)',
    'public.add_tech_item(uuid, text, text, text, int, boolean, int)', 'public.set_tech_item(uuid, text, text)',
    'public.set_budget(uuid, numeric, boolean)', 'public.add_budget_line(uuid, text, numeric, numeric, text)',
    'public.remove_budget_line(uuid)', 'public.decide_budget(uuid, boolean, text)', 'public.planning_status(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

do $$
declare t text;
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists personas_files_insert on storage.objects;
    create policy personas_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'evidences' and public.can_upload_person_file(name));
    drop policy if exists personas_files_read on storage.objects;
    create policy personas_files_read on storage.objects for select to authenticated
      using (bucket_id = 'evidences' and public.can_read_person_file(name));
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['event_people', 'event_tech_items', 'event_budgets'] loop
      begin execute format('alter publication supabase_realtime add table %I', t); exception when duplicate_object then null; end;
    end loop;
  end if;
end $$;
