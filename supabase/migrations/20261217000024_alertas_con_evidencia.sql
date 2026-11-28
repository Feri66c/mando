-- MANDO · Alertas por audio y levantadas solo con evidencia (decisión 94).
--
-- 1. Una alerta se levanta (resuelve) solo si tiene una evidencia adjunta: por ejemplo, la captura del WhatsApp
--    del cliente que dice «avanza nomás, regularizo después». Sin evidencia, no pasa.
-- 2. Quien la levanta responde por lo que informa: la bitácora lo dice con su nombre (palabra de honor).
-- 3. Las alertas de documento siguen resolviéndose adjuntando el documento al expediente (decisión 93).
--
-- Nada se borra: la evidencia queda en el cubo privado con su huella y la bitácora guarda quién la subió.

create or replace function public.resolve_alert(p_alert uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  a alerts;
  v_evidence uuid;
begin
  select * into a from alerts where id = p_alert for update;
  if not found then raise exception 'La alerta no existe.'; end if;
  perform public._require_team(a.event_id);
  if a.status = 'resolved' then raise exception 'La alerta ya está resuelta.'; end if;
  if a.entity_type = 'requirement' then
    raise exception 'Esta alerta se resuelve adjuntando el documento al expediente.' using errcode = '22023';
  end if;
  select id into v_evidence from evidences
    where alert_id = p_alert and file_path is not null
    order by received_at desc limit 1;
  if v_evidence is null then
    raise exception 'Para levantar la alerta adjunta una evidencia, por ejemplo la captura del mensaje del cliente.' using errcode = '22023';
  end if;
  update alerts set status = 'resolved', resolved_by = auth.uid(), resolved_at = now() where id = p_alert;
  perform public._log(a.event_id, 'alert_resolved',
    format('Levantada con evidencia: %s%s. %s responde por lo que informa.',
      a.title, coalesce('. ' || nullif(trim(p_note), ''), ''), public._actor_name(auth.uid())),
    a.level, 'alert', p_alert, jsonb_build_object('evidence', v_evidence, 'honor', true), a.visible_to_viewer, auth.uid());
end $$;
