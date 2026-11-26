-- MANDO · Ajustes de la planificación dictados por Fer (decisiones 42 a 45).
--
-- 1. Técnico: cada concepto lleva su documento adjunto (presupuesto del proveedor, en PDF, Excel o foto).
--    «No aplica» ya no lo decide quien está en campo: lo pide y el backend lo revisa.
-- 2. Presupuesto: llega asignado desde el backend. Si hace falta, el backend abre «adicionales»
--    y el productor los solicita con un check.
-- 3. Plazo: lo que no es obligatorio se completa hasta N horas antes (5 por defecto, lo fija el backend).
--    Si al vencer falta algo, se levanta una Red Flag.

-- ---------------------------------------------------------------------------
-- 1 · Técnico: documento por concepto y «No aplica» con revisión
-- ---------------------------------------------------------------------------

alter table event_tech_items add column if not exists doc_path text;
alter table event_tech_items add column if not exists doc_name text;
alter table event_tech_items add column if not exists na_requested_at timestamptz;
alter table event_tech_items add column if not exists na_requested_by uuid references profiles(id);
alter table event_tech_items add column if not exists na_rejected_at timestamptz;

-- Adjuntar el documento confirma el concepto.
create or replace function public.attach_tech_doc(p_item uuid, p_path text, p_name text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v event_tech_items; v_me uuid := auth.uid(); v_path text := nullif(trim(coalesce(p_path, '')), '');
begin
  select * into v from event_tech_items where id = p_item for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._require_coordinator(v.event_id);
  if v_path is null or v_path not like v.event_id::text || '/expediente/%' then
    raise exception 'El archivo no pertenece a este evento.' using errcode = '22023';
  end if;
  update event_tech_items
     set doc_path = v_path, doc_name = nullif(trim(coalesce(p_name, '')), ''), status = 'confirmed',
         confirmed_by = v_me, confirmed_at = now(), na_requested_at = null, na_requested_by = null, na_rejected_at = null
   where id = v.id;
  update alerts set status = 'resolved', resolved_at = now(), resolved_by = v_me
   where event_id = v.event_id and rule_key in ('tech_na', 'tech_na_rejected') and entity_id = v.id and status <> 'resolved';
  perform public._log(v.event_id, 'planning_updated',
    format('%s adjuntó el documento de %s.', public._actor_name(v_me), v.title),
    1, 'tech_item', v.id, jsonb_build_object('status', 'confirmed', 'document', true), false, v_me);
end $$;

-- Pedir «No aplica». El backend lo marca directo; el resto lo pide y espera la revisión.
create or replace function public.request_tech_na(p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v event_tech_items; v_me uuid := auth.uid();
begin
  select * into v from event_tech_items where id = p_item for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._require_coordinator(v.event_id);
  if v.status <> 'pending' then
    raise exception 'Solo se pide «No aplica» en un concepto pendiente.' using errcode = '22023';
  end if;
  if public.is_event_backend(v.event_id) then
    update event_tech_items set status = 'not_applicable', na_requested_at = null, na_requested_by = null, na_rejected_at = null where id = v.id;
    perform public._log(v.event_id, 'planning_updated',
      format('%s marcó «no aplica» en la lista técnica: %s.', public._actor_name(v_me), v.title),
      1, 'tech_item', v.id, jsonb_build_object('status', 'not_applicable'), false, v_me);
    return;
  end if;
  if v.na_requested_at is not null then
    return;
  end if;
  update event_tech_items set na_requested_at = now(), na_requested_by = v_me, na_rejected_at = null where id = v.id;
  perform public._log(v.event_id, 'planning_updated',
    format('%s marcó «No aplica» en %s. Falta la revisión del backend.', public._actor_name(v_me), v.title),
    2, 'tech_item', v.id, jsonb_build_object('na', 'requested'), false, v_me);
  perform public._raise_alert(v.event_id, 2, 'tech_na', format('«No aplica» por revisar: %s', v.title),
    format('%s dice que %s no va en este evento.', public._actor_name(v_me), v.title), 'tech_item', v.id, v_me);
end $$;

-- El backend revisa: si sí aplica, el concepto sigue pendiente (y bloquea si es obligatorio).
create or replace function public.review_tech_na(p_item uuid, p_applies boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v event_tech_items; v_me uuid := auth.uid();
begin
  select * into v from event_tech_items where id = p_item for update;
  if not found or v_me is null or not public.is_event_backend(v.event_id) then
    raise exception '«No aplica» lo revisa el backend.' using errcode = '42501';
  end if;
  perform public._require_team(v.event_id);
  if v.na_requested_at is null then
    raise exception 'Ese concepto no tiene un «No aplica» por revisar.' using errcode = '22023';
  end if;
  if p_applies is null then
    raise exception 'Indica si aplica o no.' using errcode = '22023';
  end if;
  update alerts set status = 'resolved', resolved_at = now(), resolved_by = v_me
   where event_id = v.event_id and rule_key = 'tech_na' and entity_id = v.id and status <> 'resolved';
  if p_applies then
    update event_tech_items set na_requested_at = null, na_requested_by = null, na_rejected_at = now() where id = v.id;
    perform public._log(v.event_id, 'planning_updated',
      format('%s revisó: %s sí aplica en este evento.', public._actor_name(v_me), v.title),
      case when v.mandatory then 3 else 2 end, 'tech_item', v.id, jsonb_build_object('na', 'rejected'), false, v_me);
    perform public._raise_alert(v.event_id, case when v.mandatory then 3 else 2 end, 'tech_na_rejected',
      format('%s sí aplica en este evento', v.title),
      case when v.mandatory then 'Es obligatorio: el acceso sigue bloqueado hasta adjuntar su documento.' else 'Adjunta su documento antes del plazo.' end,
      'tech_item', v.id, v_me);
  else
    update event_tech_items set status = 'not_applicable', na_requested_at = null, na_requested_by = null, na_rejected_at = null where id = v.id;
    perform public._log(v.event_id, 'planning_updated',
      format('%s aceptó que %s no aplica.', public._actor_name(v_me), v.title),
      1, 'tech_item', v.id, jsonb_build_object('status', 'not_applicable'), false, v_me);
  end if;
end $$;

-- Confirmar o volver a pendiente sigue igual. «No aplica» directo queda solo para el backend.
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
  if p_status = 'not_applicable' and not public.is_event_backend(v.event_id) then
    raise exception '«No aplica» lo revisa el backend: pídelo desde el concepto.' using errcode = '42501';
  end if;
  update event_tech_items
    set status = p_status, detail = coalesce(nullif(trim(coalesce(p_detail, '')), ''), detail),
        confirmed_by = case when p_status = 'confirmed' then v_me end,
        confirmed_at = case when p_status = 'confirmed' then now() end,
        na_requested_at = null, na_requested_by = null,
        na_rejected_at = case when p_status = 'pending' then na_rejected_at end
    where id = v.id;
  if p_status <> v.status then
    perform public._log(v.event_id, 'planning_updated',
      format('%s %s en la lista técnica: %s.', public._actor_name(v_me),
             case p_status when 'confirmed' then 'confirmó' when 'not_applicable' then 'marcó «no aplica»' else 'volvió a pendiente' end, v.title),
      1, 'tech_item', v.id, jsonb_build_object('status', p_status), false, v_me);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Presupuesto: adicionales que abre el backend
-- ---------------------------------------------------------------------------

alter table event_budgets add column if not exists extras_open boolean not null default false;

create table if not exists event_budget_extras (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events(id) on delete cascade,
  kind         text not null check (kind in ('personal', 'tecnico', 'locacion', 'otro')),
  note         text check (note is null or length(note) <= 500),
  status       text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  requested_by uuid references profiles(id),
  requested_at timestamptz not null default now(),
  decided_by   uuid references profiles(id),
  decided_at   timestamptz
);
create index if not exists event_budget_extras_event_idx on event_budget_extras (event_id, requested_at);

alter table event_budget_extras enable row level security;
-- Los ve quien ve el presupuesto y es del equipo. El cliente no: es un tema interno hasta que el backend decida.
drop policy if exists event_budget_extras_read on event_budget_extras;
create policy event_budget_extras_read on event_budget_extras for select to authenticated
  using (public.is_event_team(event_id) and public.can_see_budget(event_id));

create or replace function public.open_budget_extras(p_event uuid, p_open boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  perform public._require_backend(p_event);
  update event_budgets set extras_open = coalesce(p_open, true) where event_id = p_event;
  if not found then
    raise exception 'Primero carga el presupuesto.' using errcode = '22023';
  end if;
  perform public._log(p_event, 'planning_updated',
    format('%s %s la opción de adicionales del presupuesto.', public._actor_name(v_me), case when coalesce(p_open, true) then 'abrió' else 'cerró' end),
    1, 'budget', p_event, jsonb_build_object('extras_open', coalesce(p_open, true)), false, v_me);
end $$;

create or replace function public.request_budget_extra(p_event uuid, p_kind text, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid;
begin
  if public._my_level(p_event) > 2 then
    raise exception 'Los adicionales los pide el productor general o el productor de campo.' using errcode = '42501';
  end if;
  perform public._require_team(p_event);
  if not coalesce((select extras_open from event_budgets where event_id = p_event), false) then
    raise exception 'El backend todavía no abre la opción de adicionales.' using errcode = '42501';
  end if;
  if p_kind not in ('personal', 'tecnico', 'locacion', 'otro') then
    raise exception 'Tipo de adicional desconocido.' using errcode = '22023';
  end if;
  if exists (select 1 from event_budget_extras where event_id = p_event and kind = p_kind and status = 'requested') then
    raise exception 'Ese adicional ya está solicitado.' using errcode = '22023';
  end if;
  insert into event_budget_extras (event_id, kind, note, requested_by)
  values (p_event, p_kind, nullif(trim(coalesce(p_note, '')), ''), v_me) returning id into v_id;
  perform public._log(p_event, 'planning_updated',
    format('%s solicitó un adicional de presupuesto.', public._actor_name(v_me)),
    2, 'budget_extra', v_id, jsonb_build_object('kind', p_kind), false, v_me);
  perform public._raise_alert(p_event, 2, 'budget_extra', 'Adicional de presupuesto por revisar',
    format('%s solicitó un adicional.', public._actor_name(v_me)), 'budget_extra', v_id, v_me);
  return v_id;
end $$;

create or replace function public.decide_budget_extra(p_extra uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v event_budget_extras; v_me uuid := auth.uid();
begin
  select * into v from event_budget_extras where id = p_extra for update;
  if not found or v_me is null or not public.is_event_backend(v.event_id) then
    raise exception 'Los adicionales los decide el backend.' using errcode = '42501';
  end if;
  perform public._require_team(v.event_id);
  if v.status <> 'requested' or p_approve is null then
    raise exception 'Ese adicional ya fue decidido.' using errcode = '22023';
  end if;
  update event_budget_extras set status = case when p_approve then 'approved' else 'rejected' end, decided_by = v_me, decided_at = now() where id = v.id;
  update alerts set status = 'resolved', resolved_at = now(), resolved_by = v_me
   where event_id = v.event_id and rule_key = 'budget_extra' and entity_id = v.id and status <> 'resolved';
  perform public._log(v.event_id, 'planning_updated',
    format('%s %s un adicional de presupuesto.', public._actor_name(v_me), case when p_approve then 'aprobó' else 'rechazó' end),
    1, 'budget_extra', v.id, jsonb_build_object('kind', v.kind, 'approved', p_approve), false, v_me);
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Plazo de la planificación
-- ---------------------------------------------------------------------------

alter table events add column if not exists planning_deadline_hours int not null default 5
  check (planning_deadline_hours between 1 and 72);

create or replace function public.set_planning_deadline(p_event uuid, p_hours int) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  perform public._require_backend(p_event);
  if p_hours is null or p_hours not between 1 and 72 then
    raise exception 'El plazo va de 1 a 72 horas antes del evento.' using errcode = '22023';
  end if;
  update events set planning_deadline_hours = p_hours where id = p_event;
  perform public._log(p_event, 'planning_updated',
    format('%s fijó el plazo de la planificación en %s h antes del evento.', public._actor_name(v_me), p_hours),
    1, 'event', p_event, jsonb_build_object('hours', p_hours), false, v_me);
end $$;

-- El backend aplica el plazo. Si falta algo, Red Flag; devuelve true cuando la levantó.
create or replace function public.apply_planning_deadline(p_event uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_missing text; v_hours int;
begin
  perform public._require_backend(p_event);
  select planning_deadline_hours into v_hours from events where id = p_event;
  select string_agg((case e ->> 'key' when 'legal' then 'Legal' when 'personal' then 'Personal' when 'tecnico' then 'Técnico'
                       when 'presupuesto' then 'Presupuesto' else 'Aprobaciones' end), ', ')
    into v_missing
    from jsonb_array_elements(public._planning_status(p_event)) e where not (e ->> 'ready')::boolean;
  if v_missing is null then
    perform public._log(p_event, 'planning_updated', format('Venció el plazo de %s h con todo completo.', v_hours),
      1, 'event', p_event, '{}'::jsonb, false, v_me);
    return false;
  end if;
  perform public._raise_alert(p_event, 4, 'planning_deadline', 'La productora no cumplió con los 5 elementos mínimos',
    format('A %s h del evento falta: %s. Eso pone en riesgo el evento.', v_hours, v_missing), 'event', p_event, v_me);
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Permisos de ejecución
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'public.attach_tech_doc(uuid, text, text)', 'public.request_tech_na(uuid)', 'public.review_tech_na(uuid, boolean)',
    'public.set_tech_item(uuid, text, text)',
    'public.open_budget_extras(uuid, boolean)', 'public.request_budget_extra(uuid, text, text)', 'public.decide_budget_extra(uuid, boolean)',
    'public.set_planning_deadline(uuid, int)', 'public.apply_planning_deadline(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
