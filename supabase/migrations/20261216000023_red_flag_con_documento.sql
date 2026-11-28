-- MANDO · Red flag de documento: se reconoce con un plazo y se resuelve adjuntando (decisión 93).
--
-- 1. «Reconocer» pide cuánto tiempo necesita la persona: queda en la bitácora a qué hora se comprometió.
-- 2. Una alerta de documento no se «marca resuelta» con una palabra: se resuelve solo cuando el documento
--    entra al expediente bajo declaración jurada (complete_requirement ya la cierra sola).
-- 3. La IA de MANDO revisa el documento adjuntado y da el pase. Si está vencido, no corresponde o no se lee, la bitácora lo dice
--    y el documento vuelve a pendiente: la red flag se vuelve a encender.
--
-- Nada se borra: la bitácora guarda el compromiso, el documento y la revisión.

-- ---------------------------------------------------------------------------
-- 1 · Reconocer con plazo
-- ---------------------------------------------------------------------------

create or replace function public.ack_alert_with_time(p_alert uuid, p_minutes int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  a alerts;
  e events;
  v_eta timestamptz;
  v_again boolean;
begin
  select * into a from alerts where id = p_alert for update;
  if not found then raise exception 'La alerta no existe.'; end if;
  perform public._require_team(a.event_id);
  if a.status = 'resolved' then raise exception 'La alerta ya está resuelta.'; end if;
  if p_minutes is null or p_minutes < 15 or p_minutes > 1440 then
    raise exception 'Elige entre 15 minutos y 24 horas.' using errcode = '22023';
  end if;
  select * into e from events where id = a.event_id;
  v_eta := now() + make_interval(mins => p_minutes);
  v_again := a.status = 'acknowledged';
  update alerts set status = 'acknowledged' where id = p_alert;
  perform public._log(a.event_id, 'alert_acknowledged',
    format('%s %s: %s. Se compromete a resolverlo antes de las %s (%s).',
      public._actor_name(auth.uid()),
      case when v_again then 'pide más tiempo' else 'reconoce el pendiente' end,
      a.title,
      to_char(v_eta at time zone e.timezone, 'HH24:MI'),
      case when p_minutes < 60 then format('%s min', p_minutes)
           when p_minutes % 60 = 0 then format('%s h', p_minutes / 60)
           else format('%s h %s min', p_minutes / 60, p_minutes % 60) end),
    a.level, 'alert', p_alert, jsonb_build_object('eta', v_eta, 'minutes', p_minutes, 'extension', v_again),
    a.visible_to_viewer, auth.uid());
  return v_eta;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Las alertas de documento se resuelven con el documento
-- ---------------------------------------------------------------------------

create or replace function public.resolve_alert(p_alert uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a alerts;
begin
  select * into a from alerts where id = p_alert for update;
  if not found then raise exception 'La alerta no existe.'; end if;
  perform public._require_team(a.event_id);
  if a.status = 'resolved' then raise exception 'La alerta ya está resuelta.'; end if;
  if a.entity_type = 'requirement' then
    raise exception 'Esta alerta se resuelve adjuntando el documento al expediente.' using errcode = '22023';
  end if;
  update alerts set status = 'resolved', resolved_by = auth.uid(), resolved_at = now() where id = p_alert;
  perform public._log(a.event_id, 'alert_resolved',
    format('Resuelta: %s%s', a.title, coalesce('. ' || nullif(trim(p_note), ''), '')),
    a.level, 'alert', p_alert, '{}'::jsonb, a.visible_to_viewer, auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Revisión de la IA sobre el documento adjuntado
-- ---------------------------------------------------------------------------

create or replace function public.record_document_review(
  p_requirement uuid, p_verdict text, p_summary text, p_expires_on date default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v event_requirements;
  v_summary text := left(nullif(trim(coalesce(p_summary, '')), ''), 400);
  v_reject boolean;
  v_label text;
begin
  select * into v from event_requirements where id = p_requirement for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._require_team(v.event_id);
  if p_verdict not in ('vigente', 'sin_fecha', 'vencido', 'no_corresponde', 'ilegible') then
    raise exception 'Resultado de revisión desconocido.' using errcode = '22023';
  end if;
  if v.status <> 'done' or v.file_path is null then
    raise exception 'Primero adjunta el documento.' using errcode = '22023';
  end if;
  -- Solo se revisa lo que se acaba de subir: no sirve para reabrir documentos viejos de otros.
  if v.done_at < now() - interval '30 minutes' then
    raise exception 'La revisión se hace al adjuntar el documento.' using errcode = '22023';
  end if;

  v_reject := p_verdict in ('vencido', 'no_corresponde', 'ilegible');
  v_label := case p_verdict
    when 'vigente' then 'pase concedido, vigente' || coalesce(format(' hasta el %s', to_char(p_expires_on, 'DD/MM/YYYY')), '')
    when 'sin_fecha' then 'pase concedido, no muestra fecha de vencimiento'
    when 'vencido' then 'VENCIDO' || coalesce(format(' desde el %s', to_char(p_expires_on, 'DD/MM/YYYY')), '')
    when 'no_corresponde' then 'NO CORRESPONDE a lo que se pide'
    else 'NO SE LEE BIEN, hay que volver a tomar la foto' end;

  perform public._log(v.event_id, 'requirement_updated',
    format('Revisión de la IA de MANDO sobre «%s»: %s.%s%s', v.title, v_label,
      coalesce(' ' || v_summary, ''),
      case when v_reject then ' El documento vuelve a pendiente.' else '' end),
    case when v_reject then 3 else 1 end, 'requirement', v.id,
    jsonb_build_object('ai_review', p_verdict, 'expires_on', p_expires_on, 'file', v.file_name), false, auth.uid());

  if v_reject then
    update event_requirements
      set status = 'pending', done_by = null, done_at = null, sworn_at = null,
          note = left(format('Rechazado por la IA: %s', v_label), 500)
      where id = v.id;
    perform public._evaluate_requirement_rules(v.event_id);
  end if;
  return p_verdict;
end $$;

revoke execute on function public.ack_alert_with_time(uuid, int) from public, anon;
revoke execute on function public.record_document_review(uuid, text, text, date) from public, anon;
grant execute on function public.ack_alert_with_time(uuid, int) to authenticated;
grant execute on function public.record_document_review(uuid, text, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4 · Modo diseño: el backend pausa candados y alertas automáticas para recorrer el evento
-- ---------------------------------------------------------------------------
-- Mientras se diseña y se prueba, el productor general necesita avanzar con casillas en blanco: ver el timeline,
-- marcar inicios y seguir opinando. Con el modo diseño encendido no se encienden alertas automáticas (red flags,
-- vencidos, retrasos) y la planificación no bloquea. Se apaga con «Listo, activa» y todo vuelve a vigilar.
-- Encender y apagar queda en la bitácora.

alter table events add column if not exists design_mode boolean not null default false;

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
  -- Modo diseño: las reglas automáticas no encienden alertas. Las que reporta una persona, sí.
  if p_rule is not null and coalesce((select design_mode from events where id = p_event), false) then
    return null;
  end if;
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
revoke execute on function public._raise_alert(uuid, int, text, text, text, text, uuid, uuid) from public, anon, authenticated;

-- La planificación no bloquea el inicio de las piezas clave mientras el evento está en modo diseño.
create or replace function public._planning_missing(p_event uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when coalesce((select design_mode from events where id = p_event), false) then null
    when (select planning_gate from events where id = p_event) then (
      select string_agg((case e ->> 'key' when 'legal' then 'Legal' when 'personal' then 'Personal' when 'tecnico' then 'Técnico' when 'presupuesto' then 'Presupuesto' else 'Aprobaciones' end) || ': ' || (select string_agg(m, ', ') from jsonb_array_elements_text(e -> 'missing') m), '; ')
      from jsonb_array_elements(public._planning_status(p_event)) e where not (e ->> 'ready')::boolean)
    else public._approvals_missing(p_event) end
$$;

create or replace function public.planning_status(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e events;
begin
  if not public.is_event_member(p_event) then
    raise exception 'No tienes permiso para ver este evento.' using errcode = '42501';
  end if;
  select * into e from events where id = p_event;
  return jsonb_build_object('gate', e.planning_gate and not e.design_mode, 'design_mode', e.design_mode,
    'elements', public._planning_status(p_event));
end $$;

create or replace function public.set_design_mode(p_event uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare e events;
begin
  if not public.is_event_backend(p_event) then
    raise exception 'El modo diseño lo enciende y lo apaga el backend.' using errcode = '42501';
  end if;
  select * into e from events where id = p_event for update;
  if e.design_mode = coalesce(p_on, false) then
    return;
  end if;
  update events set design_mode = coalesce(p_on, false) where id = p_event;
  perform public._log(p_event, 'note',
    case when p_on
      then format('%s encendió el modo diseño: alertas automáticas en pausa y planificación sin candado.', public._actor_name(auth.uid()))
      else format('%s apagó el modo diseño: «Listo, activa». MANDO vuelve a vigilar plazos y documentos.', public._actor_name(auth.uid())) end,
    1, 'event', p_event, jsonb_build_object('design_mode', coalesce(p_on, false)), false, auth.uid());
  -- Al activar, se revisa de inmediato lo que esté vencido.
  if not p_on then
    perform public._evaluate_clock_rules(p_event);
    perform public._evaluate_requirement_rules(p_event);
  end if;
end $$;
revoke execute on function public.set_design_mode(uuid, boolean) from public, anon;
grant execute on function public.set_design_mode(uuid, boolean) to authenticated;
