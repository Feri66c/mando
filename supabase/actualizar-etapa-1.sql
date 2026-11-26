-- MANDO · actualización de la Fase 0 a la Etapa 1, para un Supabase que YA tiene instalar-todo.sql de la Fase 0.
-- Archivo generado con `npm run db:bundle`. Pégalo entero en Supabase → SQL Editor → New query → Run.

-- MANDO · Migración 3 · Operar un evento (Etapa 1 del prompt maestro).
--
-- Agrega las funciones del servidor con las que la app opera el evento. Cada una:
--   * valida que quien llama sea del equipo del evento (productor o torre de control) y que el evento no esté cerrado,
--   * trabaja dentro de una sola transacción,
--   * escribe en la bitácora (log_entries) y evalúa las reglas de criticidad (events.criticality_config).
-- La app sigue sin poder hacer update directo en route_items ni escribir en la bitácora.
--
-- Contenido:
--   1. Ajustes de esquema: compromisos con tres estados, nuevo tipo de bitácora.
--   2. Ayudas internas (no se pueden llamar desde la app): reglas, niveles, bitácora, alertas.
--   3. Hoja de ruta viva: request_change / confirm_change con recálculo en cascada, mark_item.
--   4. Momentos críticos y compromisos.
--   5. Evidencias.
--   6. Alertas: manuales, reconocer, resolver, reglas por reloj.
--   7. Archivos de evidencia (Supabase Storage) y tiempo real (Supabase Realtime).

-- ---------------------------------------------------------------------------
-- 1 · Ajustes de esquema
-- ---------------------------------------------------------------------------

-- Prometido contra entregado: cumplido, parcial o incumplido (decisión 11). matches queda como resumen.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'commitment_outcome') then
    create type commitment_outcome as enum ('met', 'partial', 'unmet');
  end if;
end $$;
alter table commitments add column if not exists outcome commitment_outcome;

-- Reconocer una alerta y resolver un momento crítico también quedan en la bitácora con su propio tipo.
alter type log_kind add value if not exists 'alert_acknowledged';
alter type log_kind add value if not exists 'moment_resolved';

create index if not exists alerts_dedup_idx on alerts (event_id, rule_key, entity_id) where status <> 'resolved';
create index if not exists evidences_event_idx on evidences (event_id, received_at);

-- ---------------------------------------------------------------------------
-- 2 · Ayudas internas
-- ---------------------------------------------------------------------------

-- Corta la operación si quien llama no es del equipo o si el evento ya cerró.
create or replace function public._require_team(p_event uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_event is null or not public.is_event_team(p_event) then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  if (select status from events where id = p_event) = 'closed' then
    raise exception 'El evento está cerrado: ya no acepta cambios.' using errcode = '42501';
  end if;
end $$;

-- Una regla de criticidad del evento, o null si el evento no la tiene (regla apagada).
create or replace function public._rule(p_event uuid, p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select r from events e, jsonb_array_elements(coalesce(e.criticality_config -> 'reglas', '[]'::jsonb)) r
  where e.id = p_event and r ->> 'clave' = p_key
  limit 1
$$;

create or replace function public._rule_param(p_rule jsonb, p_param text, p_default numeric) returns numeric
language sql immutable as $$
  select coalesce((p_rule -> 'parametros' ->> p_param)::numeric, p_default)
$$;

create or replace function public._level_config(p_event uuid, p_level int) returns jsonb
language sql stable security definer set search_path = public as $$
  select n from events e, jsonb_array_elements(coalesce(e.criticality_config -> 'niveles', '[]'::jsonb)) n
  where e.id = p_event and (n ->> 'nivel')::int = p_level
  limit 1
$$;

create or replace function public._level_name(p_event uuid, p_level int) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(public._level_config(p_event, p_level) ->> 'nombre', 'Nivel ' || p_level)
$$;

-- ¿El cliente ve las alertas de este nivel? Sin configuración, solo el nivel 4.
create or replace function public._level_visible(p_event uuid, p_level int) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((public._level_config(p_event, p_level) ->> 'visible_para_cliente')::boolean, p_level = 4)
$$;

-- "19:30" en la zona horaria del evento.
create or replace function public._hhmi(p_event uuid, p_at timestamptz) returns text
language sql stable security definer set search_path = public as $$
  select to_char(p_at at time zone coalesce((select timezone from events where id = p_event), 'America/Lima'), 'HH24:MI')
$$;

create or replace function public._actor_name(p_actor uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select full_name from profiles where id = p_actor), 'Sistema')
$$;

-- Única puerta de escritura a la bitácora.
create or replace function public._log(
  p_event uuid, p_kind log_kind, p_summary text, p_level int, p_entity_type text, p_entity_id uuid,
  p_payload jsonb, p_visible boolean, p_actor uuid
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into log_entries (event_id, actor_id, kind, level, summary, entity_type, entity_id, payload, visible_to_viewer)
  values (p_event, p_actor, p_kind, p_level, p_summary, p_entity_type, p_entity_id,
          coalesce(p_payload, '{}'::jsonb), coalesce(p_visible, false))
  returning id into v_id;
  return v_id;
end $$;

-- Levanta una alerta. Una misma situación (regla + entidad) no se repite: si ya hay una abierta o reconocida,
-- solo sube su nivel cuando corresponde. Devuelve el id de la alerta.
create or replace function public._raise_alert(
  p_event uuid, p_level int, p_rule text, p_title text, p_detail text,
  p_entity_type text, p_entity_id uuid, p_actor uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_existing alerts;
  v_id uuid;
  v_visible boolean := public._level_visible(p_event, p_level);
begin
  if p_rule is not null and p_entity_id is not null then
    select * into v_existing from alerts
    where event_id = p_event and rule_key = p_rule and entity_id = p_entity_id and status <> 'resolved'
    order by raised_at desc limit 1
    for update;
    if found then
      if p_level > v_existing.level then
        update alerts
          set level = p_level, title = p_title, detail = p_detail,
              visible_to_viewer = v_existing.visible_to_viewer or v_visible
          where id = v_existing.id;
        perform public._log(p_event, 'alert_raised',
          format('Alerta sube a %s: %s', public._level_name(p_event, p_level), p_title),
          p_level, 'alert', v_existing.id,
          jsonb_build_object('rule', p_rule, 'from_level', v_existing.level, 'to_level', p_level),
          v_existing.visible_to_viewer or v_visible, p_actor);
      end if;
      return v_existing.id;
    end if;
  end if;

  insert into alerts (event_id, level, rule_key, title, detail, entity_type, entity_id, visible_to_viewer, raised_by)
  values (p_event, p_level, p_rule, p_title, p_detail, p_entity_type, p_entity_id, v_visible, p_actor)
  returning id into v_id;

  perform public._log(p_event, 'alert_raised',
    format('%s: %s', public._level_name(p_event, p_level), p_title),
    p_level, 'alert', v_id, jsonb_build_object('rule', p_rule), v_visible, p_actor);
  return v_id;
end $$;

-- Resuelve sola una alerta de regla cuando la situación desaparece (p. ej., la actividad retrasada empezó).
create or replace function public._auto_resolve(p_event uuid, p_rule text, p_entity_id uuid, p_reason text, p_actor uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v alerts;
begin
  for v in
    select * from alerts
    where event_id = p_event and rule_key = p_rule and entity_id = p_entity_id and status <> 'resolved'
    for update
  loop
    update alerts set status = 'resolved', resolved_at = now(), resolved_by = p_actor where id = v.id;
    perform public._log(p_event, 'alert_resolved', format('Resuelta: %s. %s', v.title, p_reason),
      v.level, 'alert', v.id, jsonb_build_object('rule', p_rule, 'automatic', true), v.visible_to_viewer, p_actor);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Hoja de ruta viva
-- ---------------------------------------------------------------------------

-- Nuevo horario de la actividad según el tipo de cambio.
--   extend: suma (o resta) minutos al final.   move: desplaza inicio y fin (por minutos o a una hora nueva).
create or replace function public._change_target(
  p_item uuid, p_kind change_kind, p_delta int, p_new_start timestamptz,
  out o_start timestamptz, out o_end timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare r route_items;
begin
  select * into r from route_items where id = p_item;
  if not found then raise exception 'La actividad no existe.'; end if;
  if r.status in ('done', 'cancelled') then
    raise exception 'La actividad «%» ya terminó o fue cancelada: no se puede mover.', r.title;
  end if;
  if p_kind = 'extend' then
    if coalesce(p_delta, 0) = 0 then raise exception 'Indica cuántos minutos agregar o quitar.'; end if;
    o_start := r.current_start;
    o_end := r.current_end + make_interval(mins => p_delta);
    if o_end < o_start then raise exception 'La actividad no puede terminar antes de empezar.'; end if;
  elsif p_kind = 'move' then
    if p_new_start is not null then
      o_start := p_new_start;
    elsif coalesce(p_delta, 0) <> 0 then
      o_start := r.current_start + make_interval(mins => p_delta);
    else
      raise exception 'Indica la hora nueva o cuántos minutos mover.';
    end if;
    if r.actual_start is not null and o_start <> r.current_start then
      raise exception 'La actividad «%» ya empezó: solo se puede alargar o acortar.', r.title;
    end if;
    o_end := o_start + (r.current_end - r.current_start);
  else
    raise exception 'Ese tipo de cambio todavía no está disponible.';
  end if;
end $$;

-- Simula el cambio y el arrastre en cascada (docs/07). No escribe nada.
-- Devuelve la lista de actividades que cambian: la primera es la actividad pedida.
create or replace function public._simulate_change(p_item uuid, p_new_start timestamptz, p_new_end timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_event uuid;
  v_map jsonb;
  v_touched uuid[] := array[p_item];
  v_changed boolean;
  v_rounds int := 0;
  d record;
  v_start timestamptz;
  v_end timestamptz;
  v_required timestamptz;
begin
  select event_id into v_event from route_items where id = p_item;
  select jsonb_object_agg(id::text, jsonb_build_array(current_start, current_end)) into v_map
  from route_items where event_id = v_event;
  v_map := jsonb_set(v_map, array[p_item::text], jsonb_build_array(p_new_start, p_new_end));

  loop
    v_changed := false;
    v_rounds := v_rounds + 1;
    for d in
      select rd.item_id, rd.depends_on_id, rd.lag_minutes
      from route_dependencies rd
      join route_items b on b.id = rd.item_id
      where b.event_id = v_event
        and b.status not in ('done', 'cancelled')
        and rd.item_id <> p_item
        and rd.depends_on_id = any (v_touched)
    loop
      v_start := (v_map -> d.item_id::text ->> 0)::timestamptz;
      v_end := (v_map -> d.item_id::text ->> 1)::timestamptz;
      v_required := (v_map -> d.depends_on_id::text ->> 1)::timestamptz + make_interval(mins => d.lag_minutes);
      if v_start < v_required then
        v_map := jsonb_set(v_map, array[d.item_id::text], jsonb_build_array(v_required, v_required + (v_end - v_start)));
        if not d.item_id = any (v_touched) then v_touched := v_touched || d.item_id; end if;
        v_changed := true;
      end if;
    end loop;
    exit when not v_changed or v_rounds > 500;
  end loop;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'item_id', ri.id,
        'title', ri.title,
        'is_target', ri.id = p_item,
        'is_milestone', ri.is_milestone,
        'visible_to_viewer', ri.visible_to_viewer,
        'planned_start', ri.planned_start,
        'old_start', ri.current_start,
        'old_end', ri.current_end,
        'new_start', (v_map -> ri.id::text ->> 0)::timestamptz,
        'new_end', (v_map -> ri.id::text ->> 1)::timestamptz
      ) order by (ri.id <> p_item), ri.current_start, ri.sort_order)
    from route_items ri
    where ri.event_id = v_event
      and (ri.id = p_item
           or (v_map -> ri.id::text ->> 0)::timestamptz <> ri.current_start
           or (v_map -> ri.id::text ->> 1)::timestamptz <> ri.current_end)
  ), '[]'::jsonb);
end $$;

-- Pide un cambio y devuelve la vista previa. No mueve nada todavía: eso lo hace confirm_change.
create or replace function public.request_change(
  p_item uuid,
  p_kind change_kind,
  p_delta_minutes int default null,
  p_new_start timestamptz default null,
  p_reason text default null,
  p_raw_input text default null,
  p_channel input_channel default 'tap'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_event uuid;
  v_target record;
  v_affected jsonb;
  v_id uuid;
begin
  select event_id into v_event from route_items where id = p_item;
  perform public._require_team(v_event);
  select * into v_target from public._change_target(p_item, p_kind, p_delta_minutes, p_new_start);
  v_affected := public._simulate_change(p_item, v_target.o_start, v_target.o_end);

  insert into change_requests (event_id, item_id, kind, channel, raw_input, delta_minutes, payload, reason, affected, requested_by)
  values (v_event, p_item, p_kind, coalesce(p_channel, 'tap'), nullif(trim(p_raw_input), ''), p_delta_minutes,
          jsonb_build_object('new_start', p_new_start), nullif(trim(p_reason), ''), v_affected, auth.uid())
  returning id into v_id;

  return jsonb_build_object('request_id', v_id, 'affected', v_affected);
end $$;

-- Aplica un cambio pedido: recalcula con los datos de este momento, mueve todo de una vez,
-- deja la entrada de bitácora y evalúa las reglas retraso_con_arrastre e hito_comprometido.
create or replace function public.confirm_change(p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req change_requests;
  v_item route_items;
  v_target record;
  v_affected jsonb;
  a jsonb;
  v_dragged int;
  v_shift_min int;
  v_rule jsonb;
  v_actor uuid := auth.uid();
  v_summary text;
  v_from text;
begin
  select * into v_req from change_requests where id = p_request for update;
  if not found then raise exception 'Ese cambio no existe.'; end if;
  perform public._require_team(v_req.event_id);
  if v_req.applied_at is not null then raise exception 'Ese cambio ya se aplicó.'; end if;
  if v_req.requested_by <> v_actor and not public.is_event_backend(v_req.event_id) then
    raise exception 'Solo quien pidió el cambio (o la torre de control) puede confirmarlo.' using errcode = '42501';
  end if;

  -- Bloquea la hoja de ruta del evento mientras se aplica: dos cambios a la vez no se pisan.
  perform 1 from route_items where event_id = v_req.event_id for update;
  select * into v_item from route_items where id = v_req.item_id;

  select * into v_target from public._change_target(
    v_req.item_id, v_req.kind, v_req.delta_minutes, (v_req.payload ->> 'new_start')::timestamptz);
  v_affected := public._simulate_change(v_req.item_id, v_target.o_start, v_target.o_end);

  for a in select * from jsonb_array_elements(v_affected) loop
    update route_items
      set current_start = (a ->> 'new_start')::timestamptz,
          current_end = (a ->> 'new_end')::timestamptz,
          status = case when status = 'pending' and (a ->> 'new_start') is distinct from (a ->> 'old_start')
                        then 'moved'::item_status else status end
      where id = (a ->> 'item_id')::uuid;
  end loop;

  update change_requests set applied_at = now(), affected = v_affected where id = p_request;

  v_dragged := jsonb_array_length(v_affected) - 1;
  v_shift_min := round(extract(epoch from (v_target.o_end - v_item.current_end)) / 60);
  v_from := public._hhmi(v_req.event_id, v_item.current_start) || ' – ' || public._hhmi(v_req.event_id, v_item.current_end);
  v_summary := format('%s %s «%s»: %s → %s – %s',
    public._actor_name(v_actor),
    case when v_req.kind = 'extend' then 'ajustó' else 'movió' end,
    v_item.title, v_from,
    public._hhmi(v_req.event_id, v_target.o_start), public._hhmi(v_req.event_id, v_target.o_end));
  if v_dragged > 0 then
    v_summary := v_summary || format('. Arrastra %s %s', v_dragged, case when v_dragged = 1 then 'actividad' else 'actividades' end);
  end if;
  if v_req.reason is not null then v_summary := v_summary || '. Motivo: ' || v_req.reason; end if;

  perform public._log(v_req.event_id, 'change_applied', v_summary, null, 'route_item', v_req.item_id,
    jsonb_build_object('change_request_id', p_request, 'kind', v_req.kind, 'delta_minutes', v_shift_min, 'dragged', v_dragged),
    v_item.visible_to_viewer, v_actor);

  -- Regla: retraso_con_arrastre.
  v_rule := public._rule(v_req.event_id, 'retraso_con_arrastre');
  if v_rule is not null and (v_dragged >= public._rule_param(v_rule, 'min_dependientes', 2)
                             or v_shift_min >= public._rule_param(v_rule, 'min_minutos', 30)) then
    perform public._raise_alert(v_req.event_id, (v_rule ->> 'nivel')::int, 'retraso_con_arrastre',
      format('«%s» se retrasa %s min', v_item.title, v_shift_min),
      case when v_dragged > 0 then format('El cambio arrastra %s %s.', v_dragged,
        case when v_dragged = 1 then 'actividad' else 'actividades' end) else null end,
      'route_item', v_req.item_id, null);
  end if;

  -- Regla: hito_comprometido (cada hito que se aleja del plan publicado).
  v_rule := public._rule(v_req.event_id, 'hito_comprometido');
  if v_rule is not null then
    for a in select * from jsonb_array_elements(v_affected) where (value ->> 'is_milestone')::boolean loop
      if abs(extract(epoch from ((a ->> 'new_start')::timestamptz - (a ->> 'planned_start')::timestamptz)) / 60)
         >= public._rule_param(v_rule, 'min_minutos', 30) then
        perform public._raise_alert(v_req.event_id, (v_rule ->> 'nivel')::int, 'hito_comprometido',
          format('El hito «%s» se aleja del plan', a ->> 'title'),
          format('Plan publicado: %s. Ahora: %s.',
            public._hhmi(v_req.event_id, (a ->> 'planned_start')::timestamptz),
            public._hhmi(v_req.event_id, (a ->> 'new_start')::timestamptz)),
          'route_item', (a ->> 'item_id')::uuid, null);
      end if;
    end loop;
  end if;

  return v_affected;
end $$;

-- Marcas de un toque del Modo En Vivo: 'start' (empezó), 'finish' (terminó), 'at_risk' (en riesgo).
-- La hora la pone el servidor.
create or replace function public.mark_item(p_item uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r route_items;
  v_actor uuid := auth.uid();
  v_now timestamptz := now();
  v_late int;
  v_rule jsonb;
  v_tolerance numeric;
  v_summary text;
  v_level int;
  m record;
begin
  select * into r from route_items where id = p_item for update;
  if not found then raise exception 'La actividad no existe.'; end if;
  perform public._require_team(r.event_id);

  if p_action = 'start' then
    if r.actual_start is not null then raise exception 'La actividad «%» ya empezó.', r.title; end if;
    if r.status in ('done', 'cancelled') then raise exception 'La actividad «%» ya terminó.', r.title; end if;
    update route_items set actual_start = v_now, status = 'in_progress' where id = p_item;
    v_late := round(extract(epoch from (v_now - r.current_start)) / 60);
    v_rule := public._rule(r.event_id, 'actividad_retrasada');
    v_tolerance := public._rule_param(v_rule, 'tolerancia_min', 10);
    v_summary := format('Empezó «%s» a las %s', r.title, public._hhmi(r.event_id, v_now));
    if v_late > v_tolerance then
      v_summary := v_summary || format(' (%s min tarde)', v_late);
    elsif r.is_milestone then
      v_level := 1;  -- Informativo: hito cumplido a tiempo.
      v_summary := v_summary || ', a tiempo';
    end if;
    perform public._log(r.event_id, 'status_changed', v_summary, v_level, 'route_item', p_item,
      jsonb_build_object('action', 'start', 'late_minutes', v_late), r.visible_to_viewer, v_actor);
    perform public._auto_resolve(r.event_id, 'actividad_retrasada', p_item, 'La actividad empezó.', v_actor);
    -- Los momentos críticos programados de esta actividad se abren al empezar (docs/05).
    for m in select id from critical_moments where route_item_id = p_item and status = 'scheduled' loop
      perform public.open_moment(m.id);
    end loop;

  elsif p_action = 'finish' then
    if r.status in ('done', 'cancelled') then raise exception 'La actividad «%» ya terminó.', r.title; end if;
    update route_items set actual_start = coalesce(actual_start, v_now), actual_end = v_now, status = 'done'
      where id = p_item;
    v_late := round(extract(epoch from (v_now - r.current_end)) / 60);
    v_summary := format('Terminó «%s» a las %s', r.title, public._hhmi(r.event_id, v_now));
    if v_late > 0 then v_summary := v_summary || format(' (%s min después de lo previsto)', v_late); end if;
    perform public._log(r.event_id, 'status_changed', v_summary, null, 'route_item', p_item,
      jsonb_build_object('action', 'finish', 'late_minutes', v_late), r.visible_to_viewer, v_actor);
    perform public._auto_resolve(r.event_id, 'actividad_retrasada', p_item, 'La actividad terminó.', v_actor);

  elsif p_action = 'at_risk' then
    if r.status in ('done', 'cancelled') then raise exception 'La actividad «%» ya terminó.', r.title; end if;
    update route_items set status = 'at_risk' where id = p_item;
    perform public._log(r.event_id, 'status_changed', format('«%s» quedó en riesgo', r.title), null,
      'route_item', p_item, jsonb_build_object('action', 'at_risk'), r.visible_to_viewer, v_actor);

  else
    raise exception 'Acción desconocida: %', p_action;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Momentos críticos y compromisos (internos del equipo: la bitácora no los muestra al cliente)
-- ---------------------------------------------------------------------------

create or replace function public.open_moment(p_moment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m critical_moments;
begin
  select * into m from critical_moments where id = p_moment for update;
  if not found then raise exception 'El momento crítico no existe.'; end if;
  perform public._require_team(m.event_id);
  if m.status = 'open' then return; end if;
  if m.status = 'resolved' then raise exception 'El momento «%» ya se resolvió.', m.title; end if;
  update critical_moments set status = 'open', opened_at = now(), opened_by = auth.uid() where id = p_moment;
  perform public._log(m.event_id, 'moment_opened', format('Se abrió el momento crítico «%s»', m.title),
    m.level, 'critical_moment', p_moment, '{}'::jsonb, false, auth.uid());
end $$;

-- Crea y abre un momento crítico desde una plantilla (config/plantillas-momentos.json, la lee la app).
create or replace function public.create_moment(
  p_event uuid, p_route_item uuid, p_template_key text, p_title text, p_questions text[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; i int;
begin
  perform public._require_team(p_event);
  if p_route_item is not null and not exists (select 1 from route_items where id = p_route_item and event_id = p_event) then
    raise exception 'La actividad no es de este evento.';
  end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Ponle un nombre al momento crítico.'; end if;
  insert into critical_moments (event_id, route_item_id, template_key, title, status, opened_by, opened_at)
  values (p_event, p_route_item, nullif(p_template_key, ''), trim(p_title), 'open', auth.uid(), now())
  returning id into v_id;
  for i in 1 .. coalesce(array_length(p_questions, 1), 0) loop
    insert into moment_checks (moment_id, question, sort_order) values (v_id, p_questions[i], i);
  end loop;
  perform public._log(p_event, 'moment_opened', format('Se abrió el momento crítico «%s»', trim(p_title)),
    1, 'critical_moment', v_id, jsonb_build_object('template', p_template_key), false, auth.uid());
  return v_id;
end $$;

create or replace function public.answer_check(p_check uuid, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
declare c moment_checks; m critical_moments;
begin
  select * into c from moment_checks where id = p_check for update;
  if not found then raise exception 'La pregunta no existe.'; end if;
  select * into m from critical_moments where id = c.moment_id;
  perform public._require_team(m.event_id);
  if coalesce(trim(p_answer), '') = '' then raise exception 'Escribe una respuesta.'; end if;
  update moment_checks set answer_text = trim(p_answer), answered_by = auth.uid(), answered_at = now() where id = p_check;
  perform public._log(m.event_id, 'check_answered', format('%s — %s', c.question, trim(p_answer)), null,
    'critical_moment', m.id, jsonb_build_object('check_id', p_check), false, auth.uid());
end $$;

create or replace function public.add_commitment(p_moment uuid, p_label text, p_promised text) returns uuid
language plpgsql security definer set search_path = public as $$
declare m critical_moments; v_id uuid; v_provider uuid;
begin
  select * into m from critical_moments where id = p_moment;
  if not found then raise exception 'El momento crítico no existe.'; end if;
  perform public._require_team(m.event_id);
  if coalesce(trim(p_label), '') = '' or coalesce(trim(p_promised), '') = '' then
    raise exception 'Escribe qué es y qué se prometió.';
  end if;
  select provider_id into v_provider from route_items where id = m.route_item_id;
  insert into commitments (event_id, moment_id, provider_id, item_label, promised)
  values (m.event_id, p_moment, v_provider, trim(p_label), trim(p_promised))
  returning id into v_id;
  return v_id;
end $$;

-- Prometido contra entregado. Parcial o incumplido levanta compromiso_no_coincide; cumplido la resuelve.
create or replace function public.check_commitment(p_commitment uuid, p_found text, p_outcome commitment_outcome)
returns void
language plpgsql security definer set search_path = public as $$
declare
  c commitments;
  v_rule jsonb;
  v_level int;
  v_actor uuid := auth.uid();
  v_word text := case p_outcome when 'met' then 'cumplido' when 'partial' then 'parcial' else 'incumplido' end;
begin
  select * into c from commitments where id = p_commitment for update;
  if not found then raise exception 'El compromiso no existe.'; end if;
  perform public._require_team(c.event_id);
  if p_outcome is null then raise exception 'Marca si se cumplió, fue parcial o no se cumplió.'; end if;
  update commitments
    set found = nullif(trim(p_found), ''), outcome = p_outcome, matches = (p_outcome = 'met'),
        checked_by = v_actor, checked_at = now()
    where id = p_commitment;
  perform public._log(c.event_id, 'commitment_checked',
    format('%s: prometido %s, encontrado %s (%s)', c.item_label, c.promised, coalesce(nullif(trim(p_found), ''), '—'), v_word),
    null, 'commitment', p_commitment, jsonb_build_object('outcome', p_outcome), false, v_actor);

  if p_outcome = 'met' then
    perform public._auto_resolve(c.event_id, 'compromiso_no_coincide', p_commitment, 'Se cumplió lo prometido.', v_actor);
    return;
  end if;
  v_rule := public._rule(c.event_id, 'compromiso_no_coincide');
  if v_rule is null then return; end if;
  v_level := case when p_outcome = 'partial'
                  then public._rule_param(v_rule, 'nivel_parcial', (v_rule ->> 'nivel')::numeric)::int
                  else (v_rule ->> 'nivel')::int end;
  perform public._raise_alert(c.event_id, v_level, 'compromiso_no_coincide',
    format('%s no coincide con lo prometido', c.item_label),
    format('Prometido: %s. Encontrado: %s.', c.promised, coalesce(nullif(trim(p_found), ''), '—')),
    'commitment', p_commitment, null);
  if c.moment_id is not null then
    update critical_moments set level = greatest(level, v_level) where id = c.moment_id;
  end if;
end $$;

create or replace function public.resolve_moment(p_moment uuid, p_resolution text) returns void
language plpgsql security definer set search_path = public as $$
declare m critical_moments;
begin
  select * into m from critical_moments where id = p_moment for update;
  if not found then raise exception 'El momento crítico no existe.'; end if;
  perform public._require_team(m.event_id);
  if m.status = 'resolved' then raise exception 'El momento «%» ya se resolvió.', m.title; end if;
  if coalesce(trim(p_resolution), '') = '' then raise exception 'Cuenta cómo terminó.'; end if;
  update critical_moments set status = 'resolved', resolved_at = now(), resolution = trim(p_resolution) where id = p_moment;
  perform public._log(m.event_id, 'moment_resolved', format('Se resolvió «%s»: %s', m.title, trim(p_resolution)),
    m.level, 'critical_moment', p_moment, jsonb_build_object('resolved', true), false, auth.uid());
  perform public._auto_resolve(m.event_id, 'momento_critico_sin_resolver', p_moment, 'El momento se resolvió.', auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Evidencias: se agregan, nunca se editan ni se borran
-- ---------------------------------------------------------------------------
create or replace function public.add_evidence(
  p_event uuid,
  p_kind evidence_kind,
  p_file_path text default null,
  p_note text default null,
  p_sha256 text default null,
  p_captured_at timestamptz default null,
  p_route_item uuid default null,
  p_moment uuid default null,
  p_alert uuid default null,
  p_visible boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_where text;
  v_word text := case p_kind when 'photo' then 'foto' when 'audio' then 'audio' when 'video' then 'video'
                             when 'document' then 'documento' else 'nota' end;
begin
  perform public._require_team(p_event);
  if p_kind = 'note' then
    if coalesce(trim(p_note), '') = '' then raise exception 'Escribe la nota.'; end if;
  else
    if p_file_path is null or split_part(p_file_path, '/', 1) <> p_event::text then
      raise exception 'El archivo no corresponde a este evento.';
    end if;
    if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
      raise exception 'Falta la huella del archivo (SHA-256).';
    end if;
  end if;
  if p_route_item is not null and not exists (select 1 from route_items where id = p_route_item and event_id = p_event) then
    raise exception 'La actividad no es de este evento.';
  end if;
  if p_moment is not null and not exists (select 1 from critical_moments where id = p_moment and event_id = p_event) then
    raise exception 'El momento crítico no es de este evento.';
  end if;
  if p_alert is not null and not exists (select 1 from alerts where id = p_alert and event_id = p_event) then
    raise exception 'La alerta no es de este evento.';
  end if;

  -- captured_at = hora del teléfono (puede venir de la cola sin señal); received_at la pone el servidor.
  insert into evidences (event_id, kind, file_path, note, sha256, moment_id, route_item_id, alert_id,
                         captured_at, captured_by, visible_to_viewer)
  values (p_event, p_kind, case when p_kind = 'note' then null else p_file_path end, nullif(trim(p_note), ''),
          p_sha256, p_moment, p_route_item, p_alert, coalesce(p_captured_at, now()), auth.uid(), coalesce(p_visible, true))
  returning id into v_id;

  v_where := coalesce(
    (select format(' en «%s»', title) from route_items where id = p_route_item),
    (select format(' en «%s»', title) from critical_moments where id = p_moment),
    '');
  perform public._log(p_event, 'evidence_added',
    format('Evidencia (%s)%s%s', v_word, v_where, coalesce(': ' || nullif(trim(p_note), ''), '')),
    null, 'evidence', v_id, jsonb_build_object('kind', p_kind), coalesce(p_visible, true), auth.uid());
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 6 · Alertas
-- ---------------------------------------------------------------------------

-- «Reportar problema»: alerta manual con nivel elegido por el equipo.
create or replace function public.raise_alert(
  p_event uuid, p_level int, p_title text, p_detail text default null,
  p_entity_type text default null, p_entity_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_team(p_event);
  if p_level not between 1 and 4 then raise exception 'El nivel va de 1 a 4.'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Describe el problema.'; end if;
  return public._raise_alert(p_event, p_level, null, trim(p_title), nullif(trim(p_detail), ''),
    p_entity_type, p_entity_id, auth.uid());
end $$;

create or replace function public.ack_alert(p_alert uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a alerts;
begin
  select * into a from alerts where id = p_alert for update;
  if not found then raise exception 'La alerta no existe.'; end if;
  perform public._require_team(a.event_id);
  if a.status <> 'open' then return; end if;
  update alerts set status = 'acknowledged' where id = p_alert;
  perform public._log(a.event_id, 'alert_acknowledged',
    format('%s reconoció la alerta: %s', public._actor_name(auth.uid()), a.title),
    a.level, 'alert', p_alert, '{}'::jsonb, a.visible_to_viewer, auth.uid());
end $$;

create or replace function public.resolve_alert(p_alert uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a alerts;
begin
  select * into a from alerts where id = p_alert for update;
  if not found then raise exception 'La alerta no existe.'; end if;
  perform public._require_team(a.event_id);
  if a.status = 'resolved' then raise exception 'La alerta ya está resuelta.'; end if;
  update alerts set status = 'resolved', resolved_by = auth.uid(), resolved_at = now() where id = p_alert;
  perform public._log(a.event_id, 'alert_resolved',
    format('Resuelta: %s%s', a.title, coalesce('. ' || nullif(trim(p_note), ''), '')),
    a.level, 'alert', p_alert, '{}'::jsonb, a.visible_to_viewer, auth.uid());
end $$;

-- Reglas que dependen del reloj. La pantalla del equipo la llama cada minuto mientras está abierta.
-- Devuelve cuántas alertas nuevas o con nivel subido dejó.
create or replace function public.evaluate_clock_rules(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  e events;
  v_rule jsonb;
  v_now timestamptz := now();
  v_before int;
  v_after int;
  r record;
begin
  perform public._require_team(p_event);
  select * into e from events where id = p_event;
  select count(*) into v_before from log_entries where event_id = p_event and kind = 'alert_raised';

  v_rule := public._rule(p_event, 'actividad_retrasada');
  if v_rule is not null then
    for r in
      select * from route_items
      where event_id = p_event and actual_start is null and status in ('pending', 'moved', 'at_risk')
        and current_start + make_interval(mins => public._rule_param(v_rule, 'tolerancia_min', 10)::int) < v_now
    loop
      perform public._raise_alert(p_event, (v_rule ->> 'nivel')::int, 'actividad_retrasada',
        format('«%s» no ha empezado', r.title),
        format('Debía empezar a las %s.', public._hhmi(p_event, r.current_start)), 'route_item', r.id, null);
    end loop;
  end if;

  v_rule := public._rule(p_event, 'actividad_sin_responsable');
  if v_rule is not null then
    for r in
      select * from route_items
      where event_id = p_event and owner_id is null and status not in ('done', 'cancelled')
        and current_start > v_now
        and current_start - v_now <= make_interval(mins => public._rule_param(v_rule, 'minutos_antes', 120)::int)
    loop
      perform public._raise_alert(p_event, (v_rule ->> 'nivel')::int, 'actividad_sin_responsable',
        format('«%s» no tiene responsable', r.title),
        format('Empieza a las %s.', public._hhmi(p_event, r.current_start)), 'route_item', r.id, null);
    end loop;
  end if;

  v_rule := public._rule(p_event, 'momento_critico_sin_resolver');
  if v_rule is not null then
    for r in
      select * from critical_moments
      where event_id = p_event and status = 'open'
        and opened_at + make_interval(mins => public._rule_param(v_rule, 'minutos', 30)::int) < v_now
    loop
      perform public._raise_alert(p_event, (v_rule ->> 'nivel')::int, 'momento_critico_sin_resolver',
        format('«%s» sigue sin resolver', r.title),
        format('Abierto desde las %s.', public._hhmi(p_event, r.opened_at)), 'critical_moment', r.id, null);
    end loop;
  end if;

  if e.starts_at is not null then
    v_rule := public._rule(p_event, 'permiso_sin_aprobar_dia_del_evento');
    if v_rule is not null and (v_now at time zone e.timezone)::date >= (e.starts_at at time zone e.timezone)::date then
      for r in select * from permits where event_id = p_event and is_required and status <> 'approved' loop
        perform public._raise_alert(p_event, (v_rule ->> 'nivel')::int, 'permiso_sin_aprobar_dia_del_evento',
          format('«%s» sin aprobar el día del evento', r.title), null, 'permit', r.id, null);
      end loop;
    else
      v_rule := public._rule(p_event, 'permiso_sin_aprobar');
      if v_rule is not null and e.starts_at - v_now <= make_interval(days => public._rule_param(v_rule, 'dias_antes', 3)::int) then
        for r in select * from permits where event_id = p_event and is_required and status <> 'approved' loop
          perform public._raise_alert(p_event, (v_rule ->> 'nivel')::int, 'permiso_sin_aprobar',
            format('«%s» todavía no está aprobado', r.title), null, 'permit', r.id, null);
        end loop;
      end if;
    end if;
  end if;

  select count(*) into v_after from log_entries where event_id = p_event and kind = 'alert_raised';
  return v_after - v_before;
end $$;

-- ---------------------------------------------------------------------------
-- Quién puede llamar qué
-- ---------------------------------------------------------------------------
-- Las ayudas internas no se llaman desde la app.
revoke execute on function public._require_team(uuid) from public, anon, authenticated;
revoke execute on function public._rule(uuid, text) from public, anon, authenticated;
revoke execute on function public._rule_param(jsonb, text, numeric) from public, anon, authenticated;
revoke execute on function public._level_config(uuid, int) from public, anon, authenticated;
revoke execute on function public._level_name(uuid, int) from public, anon, authenticated;
revoke execute on function public._level_visible(uuid, int) from public, anon, authenticated;
revoke execute on function public._hhmi(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public._actor_name(uuid) from public, anon, authenticated;
revoke execute on function public._log(uuid, log_kind, text, int, text, uuid, jsonb, boolean, uuid) from public, anon, authenticated;
revoke execute on function public._raise_alert(uuid, int, text, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public._auto_resolve(uuid, text, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public._change_target(uuid, change_kind, int, timestamptz) from public, anon, authenticated;
revoke execute on function public._simulate_change(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Las acciones: solo con sesión. Además, cada una valida el rol en el evento.
do $$
declare f text;
begin
  foreach f in array array[
    'public.request_change(uuid, change_kind, int, timestamptz, text, text, input_channel)',
    'public.confirm_change(uuid)',
    'public.mark_item(uuid, text)',
    'public.open_moment(uuid)',
    'public.create_moment(uuid, uuid, text, text, text[])',
    'public.answer_check(uuid, text)',
    'public.add_commitment(uuid, text, text)',
    'public.check_commitment(uuid, text, commitment_outcome)',
    'public.resolve_moment(uuid, text)',
    'public.add_evidence(uuid, evidence_kind, text, text, text, timestamptz, uuid, uuid, uuid, boolean)',
    'public.raise_alert(uuid, int, text, text, text, uuid)',
    'public.ack_alert(uuid)',
    'public.resolve_alert(uuid, text)',
    'public.evaluate_clock_rules(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7 · Archivos de evidencia y tiempo real (solo si existen, como en Supabase)
-- ---------------------------------------------------------------------------

-- ¿Puede subir un archivo a esta ruta? Ruta: <id del evento>/<archivo>. Solo el equipo, evento abierto.
create or replace function public.can_upload_evidence_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_event uuid;
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 2) = '' then
    return false;
  end if;
  v_event := split_part(p_name, '/', 1)::uuid;
  return public.is_event_team(v_event)
     and coalesce((select status from events where id = v_event) <> 'closed', false);
end $$;

-- ¿Puede ver este archivo? El equipo ve los de su evento; el cliente, solo los de evidencias visibles.
create or replace function public.can_read_evidence_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_event uuid;
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_event := split_part(p_name, '/', 1)::uuid;
  return public.is_event_team(v_event)
      or exists (select 1 from evidences ev
                 where ev.file_path = p_name and ev.event_id = v_event
                   and public.can_view(ev.event_id, ev.visible_to_viewer));
end $$;

revoke execute on function public.can_upload_evidence_file(text) from public, anon;
revoke execute on function public.can_read_evidence_file(text) from public, anon;
grant execute on function public.can_upload_evidence_file(text) to authenticated;
grant execute on function public.can_read_evidence_file(text) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is not null then
    -- Cubo privado. 50 MB por archivo. Sin políticas de update ni delete: un archivo subido no se cambia.
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('evidences', 'evidences', false, 52428800)
    on conflict (id) do nothing;

    drop policy if exists evidences_files_insert on storage.objects;
    create policy evidences_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'evidences' and public.can_upload_evidence_file(name));
    drop policy if exists evidences_files_read on storage.objects;
    create policy evidences_files_read on storage.objects for select to authenticated
      using (bucket_id = 'evidences' and public.can_read_evidence_file(name));
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- Qué filas recibe cada persona lo decide la seguridad por fila.
    begin alter publication supabase_realtime add table route_items; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table log_entries; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table alerts; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table evidences; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table critical_moments; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table moment_checks; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table commitments; exception when duplicate_object then null; end;
  end if;
end $$;


-- Escala de criticidad del evento de ejemplo, con el parámetro nuevo de compromisos.
update events set criticality_config = $crit${
  "_nota": "Valores por defecto PROPUESTOS. Los niveles y umbrales deben alinearse con la escala de criticidad que ya usa el desarrollo de medios de HUB51. Se copian a cada evento al crearlo.",
  "niveles": [
    {
      "nivel": 1,
      "clave": "informativo",
      "nombre": "Informativo",
      "descripcion": "Hito cumplido a tiempo. Solo se registra.",
      "color": "#a9cce8",
      "notifica": [],
      "visible_para_cliente": false
    },
    {
      "nivel": 2,
      "clave": "atencion",
      "nombre": "Atención",
      "descripcion": "Retraso o pendiente sin responsable.",
      "color": "#c9a227",
      "notifica": [
        "producer"
      ],
      "visible_para_cliente": false
    },
    {
      "nivel": 3,
      "clave": "critico",
      "nombre": "Crítico",
      "descripcion": "Lo entregado no coincide con lo prometido, o un retraso arrastra otras actividades.",
      "color": "#b3402e",
      "notifica": [
        "producer",
        "backend"
      ],
      "visible_para_cliente": false
    },
    {
      "nivel": 4,
      "clave": "red_flag",
      "nombre": "Red Flag",
      "descripcion": "Compromete el evento. Escala al cliente.",
      "color": "#061428",
      "notifica": [
        "producer",
        "backend",
        "viewer"
      ],
      "visible_para_cliente": true
    }
  ],
  "reglas": [
    {
      "clave": "actividad_sin_responsable",
      "nivel": 2,
      "cuando": "Una actividad está a menos de `minutos_antes` de empezar y no tiene responsable.",
      "parametros": {
        "minutos_antes": 120
      }
    },
    {
      "clave": "actividad_retrasada",
      "nivel": 2,
      "cuando": "Pasó la hora de inicio vigente más `tolerancia_min` y la actividad no ha empezado.",
      "parametros": {
        "tolerancia_min": 10
      }
    },
    {
      "clave": "retraso_con_arrastre",
      "nivel": 3,
      "cuando": "Un retraso o un cambio mueve `min_dependientes` o más actividades, o suma `min_minutos` o más.",
      "parametros": {
        "min_dependientes": 2,
        "min_minutos": 30
      }
    },
    {
      "clave": "compromiso_no_coincide",
      "nivel": 3,
      "cuando": "En un momento crítico, lo encontrado no coincide con lo prometido. Si es parcial, usa `nivel_parcial`.",
      "parametros": {
        "nivel_parcial": 2
      }
    },
    {
      "clave": "hito_comprometido",
      "nivel": 4,
      "cuando": "El plan vigente de un hito (apertura de puertas, inicio de show) se aleja `min_minutos` o más del plan publicado.",
      "parametros": {
        "min_minutos": 30
      }
    },
    {
      "clave": "permiso_sin_aprobar",
      "nivel": 3,
      "cuando": "Un permiso obligatorio no está aprobado y faltan `dias_antes` días o menos para el evento.",
      "parametros": {
        "dias_antes": 3
      }
    },
    {
      "clave": "permiso_sin_aprobar_dia_del_evento",
      "nivel": 4,
      "cuando": "Un permiso obligatorio no está aprobado el día del evento.",
      "parametros": {}
    },
    {
      "clave": "momento_critico_sin_resolver",
      "nivel": 3,
      "cuando": "Un momento crítico lleva abierto más de `minutos` sin resolución.",
      "parametros": {
        "minutos": 30
      }
    }
  ]
}$crit$::jsonb
where id = '00000000-0000-0000-0000-0000000000e1';
