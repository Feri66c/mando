-- MANDO · actualización de la Etapa 1 a la Etapa 2, para un Supabase que YA tiene la Etapa 1.
-- Archivo generado con `npm run db:bundle`. Pégalo entero en Supabase → SQL Editor → New query → Run.

-- MANDO · Migración 4 · App móvil (Etapa 2 del prompt maestro).
--
--   1. Cola sin señal: cada operación que llega desde el teléfono trae una referencia propia (client_ref).
--      Si llega dos veces (reintento), la segunda no hace nada: nada se duplica en la bitácora.
--      Las marcas Empezó / Terminó guardan la hora del teléfono (acotada a las últimas 12 horas) y la del servidor.
--   2. Teléfonos registrados para avisos (push_tokens): cada persona ve y borra solo los suyos.
--   3. Avisos: cuando se levanta una alerta (o sube de nivel), se arma un aviso para los roles que indica
--      events.criticality_config (campo «notifica» del nivel) y se envía con el servicio de Expo vía pg_net.
--      Sin pg_net (pruebas locales) el aviso queda guardado como pendiente.
--   4. Reglas de reloj en el servidor: pg_cron las evalúa cada minuto para los eventos en curso,
--      aunque nadie tenga la pantalla abierta.
-- La bitácora sigue sin poder editarse ni borrarse. Toda tabla nueva tiene seguridad por fila y su prueba.

-- ---------------------------------------------------------------------------
-- 1 · Esquema
-- ---------------------------------------------------------------------------

alter table evidences add column if not exists client_ref uuid;
create unique index if not exists evidences_client_ref_idx on evidences (captured_by, client_ref) where client_ref is not null;

-- Operaciones ya recibidas desde la cola del teléfono. Solo la usan las funciones del servidor.
create table if not exists client_operations (
  client_ref  uuid primary key,
  profile_id  uuid not null references profiles(id) on delete cascade,
  op          text not null,
  created_at  timestamptz not null default now()
);
alter table client_operations enable row level security;
-- Sin políticas: nadie la lee ni la escribe desde la app.

-- Teléfonos que reciben avisos. Un token pertenece a una sola persona (la última que inició sesión en ese teléfono).
create table if not exists push_tokens (
  token        text primary key,
  profile_id   uuid not null references profiles(id) on delete cascade,
  platform     text not null check (platform in ('ios', 'android')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_tokens_profile_idx on push_tokens (profile_id);
alter table push_tokens enable row level security;
drop policy if exists push_tokens_read_own on push_tokens;
create policy push_tokens_read_own on push_tokens for select to authenticated using (profile_id = auth.uid());
drop policy if exists push_tokens_delete_own on push_tokens;
create policy push_tokens_delete_own on push_tokens for delete to authenticated using (profile_id = auth.uid());
-- Registrar o mover un token va por register_push_token (abajo): así un teléfono no puede quedarse con avisos ajenos.

-- Avisos armados por el servidor. La torre de control del evento puede revisarlos.
create table if not exists push_messages (
  id           bigint generated always as identity primary key,
  event_id     uuid not null references events(id) on delete cascade,
  alert_id     uuid references alerts(id) on delete set null,
  level        smallint not null check (level between 1 and 4),
  title        text not null,
  body         text not null,
  recipients   uuid[] not null default '{}',
  tokens       int not null default 0,
  status       text not null default 'pending' check (status in ('pending', 'sent', 'skipped')),
  request_id   bigint,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);
create index if not exists push_messages_event_idx on push_messages (event_id, created_at);
alter table push_messages enable row level security;
drop policy if exists push_messages_read_backend on push_messages;
create policy push_messages_read_backend on push_messages for select to authenticated
  using (public.is_event_backend(event_id));

-- ---------------------------------------------------------------------------
-- 2 · Cola sin señal
-- ---------------------------------------------------------------------------

-- true = esta operación ya se recibió antes (es un reintento): la función que llama no hace nada más.
-- Si la operación falla después, la transacción se deshace y la referencia queda libre para reintentar.
create or replace function public._client_op_seen(p_ref uuid, p_op text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_rows int;
begin
  if p_ref is null then return false; end if;
  insert into client_operations (client_ref, profile_id, op) values (p_ref, auth.uid(), p_op)
  on conflict (client_ref) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then return false; end if;
  select profile_id into v_owner from client_operations where client_ref = p_ref;
  if v_owner is distinct from auth.uid() then
    raise exception 'Referencia de operación inválida.' using errcode = '42501';
  end if;
  return true;
end $$;

drop function if exists public.mark_item(uuid, text);
drop function if exists public.answer_check(uuid, text);
drop function if exists public.add_evidence(uuid, evidence_kind, text, text, text, timestamptz, uuid, uuid, uuid, boolean);

create or replace function public.mark_item(
  p_item uuid, p_action text, p_occurred_at timestamptz default null, p_client_ref uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  r route_items;
  v_actor uuid := auth.uid();
  -- Hora de la marca: la del teléfono si vino de la cola sin señal, acotada a las últimas 12 horas y nunca en el futuro.
  v_now timestamptz := least(now(), greatest(coalesce(p_occurred_at, now()), now() - interval '12 hours'));
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
  if public._client_op_seen(p_client_ref, 'mark_item') then return; end if;

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
      jsonb_build_object('action', 'start', 'late_minutes', v_late, 'phone_time', p_occurred_at, 'server_time', now()), r.visible_to_viewer, v_actor);
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
      jsonb_build_object('action', 'finish', 'late_minutes', v_late, 'phone_time', p_occurred_at, 'server_time', now()), r.visible_to_viewer, v_actor);
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

create or replace function public.answer_check(p_check uuid, p_answer text, p_client_ref uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare c moment_checks; m critical_moments;
begin
  select * into c from moment_checks where id = p_check for update;
  if not found then raise exception 'La pregunta no existe.'; end if;
  select * into m from critical_moments where id = c.moment_id;
  perform public._require_team(m.event_id);
  if public._client_op_seen(p_client_ref, 'answer_check') then return; end if;
  if coalesce(trim(p_answer), '') = '' then raise exception 'Escribe una respuesta.'; end if;
  update moment_checks set answer_text = trim(p_answer), answered_by = auth.uid(), answered_at = now() where id = p_check;
  perform public._log(m.event_id, 'check_answered', format('%s — %s', c.question, trim(p_answer)), null,
    'critical_moment', m.id, jsonb_build_object('check_id', p_check), false, auth.uid());
end $$;

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
  p_visible boolean default true,
  p_client_ref uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_where text;
  v_word text := case p_kind when 'photo' then 'foto' when 'audio' then 'audio' when 'video' then 'video'
                             when 'document' then 'documento' else 'nota' end;
begin
  perform public._require_team(p_event);
  -- Reintento desde la cola sin señal: devuelve la evidencia ya guardada, sin duplicarla.
  if p_client_ref is not null then
    select id into v_id from evidences where client_ref = p_client_ref and captured_by = auth.uid();
    if found then return v_id; end if;
  end if;
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
                         captured_at, captured_by, visible_to_viewer, client_ref)
  values (p_event, p_kind, case when p_kind = 'note' then null else p_file_path end, nullif(trim(p_note), ''),
          p_sha256, p_moment, p_route_item, p_alert, coalesce(p_captured_at, now()), auth.uid(), coalesce(p_visible, true), p_client_ref)
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
-- 3 · Reglas de reloj en el servidor
-- ---------------------------------------------------------------------------

-- Mismas reglas de la Etapa 1, sin exigir sesión: la llaman evaluate_clock_rules (con sesión) y pg_cron.
create or replace function public._evaluate_clock_rules(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  e events;
  v_rule jsonb;
  v_now timestamptz := now();
  v_before int;
  v_after int;
  r record;
begin
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


create or replace function public.evaluate_clock_rules(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_team(p_event);
  return public._evaluate_clock_rules(p_event);
end $$;

-- Todos los eventos en curso (desde un día antes de empezar hasta un día después de terminar).
create or replace function public.run_clock_rules_all() returns int
language plpgsql security definer set search_path = public as $$
declare e record; v_total int := 0;
begin
  for e in
    select id from events
    where status in ('planned', 'live')
      and starts_at is not null and starts_at - interval '1 day' <= now()
      and coalesce(ends_at, starts_at) + interval '1 day' >= now()
  loop
    v_total := v_total + public._evaluate_clock_rules(e.id);
  end loop;
  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Avisos al teléfono
-- ---------------------------------------------------------------------------

create or replace function public.register_push_token(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero.' using errcode = '42501'; end if;
  if coalesce(p_token, '') !~ '^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$' then
    raise exception 'El identificador de avisos no es válido.';
  end if;
  if p_platform not in ('ios', 'android') then raise exception 'Plataforma desconocida.'; end if;
  insert into push_tokens (token, profile_id, platform) values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set profile_id = auth.uid(), platform = excluded.platform, last_seen_at = now();
end $$;

create or replace function public.unregister_push_token(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from push_tokens where token = p_token and profile_id = auth.uid();
$$;

-- Envía un aviso armado con el servicio de Expo (https://docs.expo.dev/push-notifications/sending-notifications/).
create or replace function public._deliver_push(p_message bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  m push_messages;
  v_body jsonb;
  v_request bigint;
begin
  select * into m from push_messages where id = p_message for update;
  if not found or m.status <> 'pending' then return; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'to', t.token, 'title', m.title, 'body', m.body, 'sound', 'default', 'priority', 'high',
           'channelId', 'alertas',
           'data', jsonb_build_object('event_id', m.event_id, 'alert_id', m.alert_id, 'level', m.level))), '[]'::jsonb)
    into v_body
    from push_tokens t where t.profile_id = any (m.recipients);
  if jsonb_array_length(v_body) = 0 then
    update push_messages set status = 'skipped', tokens = 0 where id = p_message;
    return;
  end if;
  update push_messages set tokens = jsonb_array_length(v_body) where id = p_message;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then
    return;  -- Sin pg_net (pruebas locales): queda pendiente.
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    into v_request
    using 'https://exp.host/--/api/v2/push/send', v_body,
          jsonb_build_object('Content-Type', 'application/json', 'Accept', 'application/json');
  update push_messages set status = 'sent', request_id = v_request, sent_at = now() where id = p_message;
end $$;

-- Al levantarse una alerta, o al subir de nivel, se avisa a los roles del nivel (campo «notifica»).
-- Quien la provocó no recibe aviso de su propia acción. El cliente solo recibe avisos de alertas visibles para él.
create or replace function public._alerts_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_roles text[];
  v_recipients uuid[];
  v_event_name text;
  v_id bigint;
begin
  if tg_op = 'UPDATE' and new.level <= old.level then return new; end if;
  if new.status = 'resolved' then return new; end if;
  select array(select jsonb_array_elements_text(coalesce(public._level_config(new.event_id, new.level) -> 'notifica', '[]'::jsonb)))
    into v_roles;
  if coalesce(array_length(v_roles, 1), 0) = 0 then return new; end if;
  select array_agg(em.profile_id) into v_recipients
    from event_members em
    where em.event_id = new.event_id and em.role::text = any (v_roles)
      and (em.role <> 'viewer' or new.visible_to_viewer)
      and em.profile_id is distinct from new.raised_by;
  if v_recipients is null then return new; end if;
  select name into v_event_name from events where id = new.event_id;
  insert into push_messages (event_id, alert_id, level, title, body, recipients)
  values (new.event_id, new.id, new.level,
          format('%s · %s', public._level_name(new.event_id, new.level), v_event_name),
          new.title || coalesce('. ' || new.detail, ''), v_recipients)
  returning id into v_id;
  perform public._deliver_push(v_id);
  return new;
end $$;

drop trigger if exists alerts_push on alerts;
create trigger alerts_push after insert or update of level on alerts
  for each row execute function public._alerts_push();

-- ---------------------------------------------------------------------------
-- Quién puede llamar qué
-- ---------------------------------------------------------------------------
revoke execute on function public._client_op_seen(uuid, text) from public, anon, authenticated;
revoke execute on function public._evaluate_clock_rules(uuid) from public, anon, authenticated;
revoke execute on function public.run_clock_rules_all() from public, anon, authenticated;
revoke execute on function public._deliver_push(bigint) from public, anon, authenticated;
revoke execute on function public._alerts_push() from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.mark_item(uuid, text, timestamptz, uuid)',
    'public.answer_check(uuid, text, uuid)',
    'public.add_evidence(uuid, evidence_kind, text, text, text, timestamptz, uuid, uuid, uuid, boolean, uuid)',
    'public.evaluate_clock_rules(uuid)',
    'public.register_push_token(text, text)',
    'public.unregister_push_token(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Extensiones de Supabase (solo si existen; las pruebas locales corren sin ellas)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    begin
      create extension if not exists pg_net;
    exception when others then
      raise notice 'No se pudo activar pg_net (%): los avisos quedarán pendientes.', sqlerrm;
    end;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('mando-reglas-de-reloj', '* * * * *', 'select public.run_clock_rules_all()');
    exception when others then
      raise notice 'No se pudo programar pg_cron (%): las reglas de reloj corren solo con la pantalla abierta.', sqlerrm;
    end;
  end if;
end $$;


-- Eventos por invitación y tipos de evento.
-- MANDO · Migración 5 · Eventos por invitación y tipo de evento (decisiones 17 a 20).
--
--   1. Tipo de evento: el evento guarda su plantilla (config/tipos-de-evento.json) y su tamaño.
--      La hoja de ruta inicial nace de las piezas de la plantilla, contadas desde la hora clave.
--   2. Jerarquía: cada miembro tiene un cargo (title) y un nivel: 1 productor general, 2 productor de campo,
--      3 coordinación, 4 técnicos y proveedores. El cliente no tiene nivel.
--   3. Invitaciones: solo el productor general (backend del evento) invita. Si la persona ya tiene cuenta,
--      entra al equipo de inmediato; si no, la invitación queda pendiente y se une al validar su código.
--      Solo un correo con invitación pendiente puede crear su cuenta.
--   4. Bienvenida: cada miembro ve una vez la pantalla de bienvenida antes de tomar el mando (welcomed_at).
-- Toda tabla nueva tiene seguridad por fila y su prueba en tests/db. La bitácora sigue sin poder editarse.

-- ---------------------------------------------------------------------------
-- 1 · Esquema
-- ---------------------------------------------------------------------------

alter type log_kind add value if not exists 'member_invited';
alter type log_kind add value if not exists 'member_joined';

alter table events add column if not exists kind text;                                   -- clave de la plantilla
alter table events add column if not exists tier text check (tier in ('ligero', 'medio', 'mayor'));
alter table events add column if not exists template jsonb not null default '{}'::jsonb;  -- copia de la plantilla

alter table event_members add column if not exists level smallint check (level between 1 and 4);
alter table event_members add column if not exists welcomed_at timestamptz;

-- Quienes ya eran miembros antes de esta migración no pasan por la bienvenida, y reciben su nivel según su rol.
update event_members set welcomed_at = created_at where welcomed_at is null;
update event_members set level = case role when 'backend' then 1 when 'producer' then 2 end where level is null and role <> 'viewer';

create table if not exists invitations (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  email       text not null check (email = lower(email) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  full_name   text not null check (length(trim(full_name)) > 0),
  role        event_role not null,
  title       text not null check (length(trim(title)) > 0),
  level       smallint check (level between 1 and 4),
  invited_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references profiles(id),
  revoked_at  timestamptz,
  check (
    (role = 'viewer' and level is null) or
    (role = 'backend' and level = 1) or
    (role = 'producer' and level between 2 and 4)
  )
);
create unique index if not exists invitations_active_idx on invitations (event_id, email) where revoked_at is null;
create index if not exists invitations_email_idx on invitations (email) where accepted_at is null and revoked_at is null;

alter table invitations enable row level security;
-- Solo el productor general del evento ve sus invitaciones. Se escriben únicamente con las funciones de abajo.
drop policy if exists invitations_read on invitations;
create policy invitations_read on invitations for select to authenticated
  using (public.is_event_backend(event_id));

-- ---------------------------------------------------------------------------
-- 2 · Ayudas
-- ---------------------------------------------------------------------------

create or replace function public._email_of(p_profile uuid) returns text
language sql stable security definer set search_path = public, auth as $$
  select lower(email) from auth.users where id = p_profile
$$;

create or replace function public._check_role_level(p_role event_role, p_level smallint) returns void
language plpgsql immutable as $$
begin
  if (p_role = 'viewer' and p_level is not null)
     or (p_role = 'backend' and p_level is distinct from 1)
     or (p_role = 'producer' and (p_level is null or p_level not between 2 and 4)) then
    raise exception 'El cargo no coincide con su nivel.' using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Crear un evento desde su plantilla
-- ---------------------------------------------------------------------------

create or replace function public.create_event_from_template(
  p_org uuid, p_name text, p_client text, p_venue text, p_timezone text,
  p_key_time timestamptz, p_template jsonb, p_criticality jsonb, p_brief text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_event uuid;
  v_piece jsonb;
  v_i int := 0;
  v_start timestamptz;
  v_end timestamptz;
  v_last timestamptz := p_key_time;
begin
  if v_me is null or not public.is_org_admin(p_org) then
    raise exception 'Solo un productor general de la organización puede crear eventos.' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Escribe el nombre del evento.' using errcode = '22023';
  end if;
  if p_key_time is null then
    raise exception 'Falta la fecha y hora clave del evento.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_template -> 'piezas') is distinct from 'array' or jsonb_array_length(p_template -> 'piezas') = 0 then
    raise exception 'La plantilla del tipo de evento no tiene piezas.' using errcode = '22023';
  end if;
  if coalesce(p_template ->> 'tamano', '') not in ('ligero', 'medio', 'mayor') then
    raise exception 'La plantilla del tipo de evento no tiene un tamaño válido.' using errcode = '22023';
  end if;
  if p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Zona horaria desconocida.' using errcode = '22023';
  end if;

  insert into events (organization_id, name, event_type, kind, tier, template, client_name, venue_name, timezone,
                      starts_at, ends_at, status, criticality_config, created_by)
  values (p_org, trim(p_name), p_template ->> 'nombre', p_template ->> 'clave', p_template ->> 'tamano', p_template,
          nullif(trim(p_client), ''), nullif(trim(p_venue), ''), p_timezone,
          p_key_time, p_key_time, 'planned', coalesce(p_criticality, '{}'::jsonb), v_me)
  returning id into v_event;

  insert into event_members (event_id, profile_id, role, title, level, welcomed_at)
  values (v_event, v_me, 'backend', 'Productor general', 1, now());

  for v_piece in select value from jsonb_array_elements(p_template -> 'piezas') loop
    v_i := v_i + 1;
    if coalesce(trim(v_piece ->> 'titulo'), '') = '' then
      raise exception 'La pieza % de la plantilla no tiene título.', v_i using errcode = '22023';
    end if;
    v_start := p_key_time + make_interval(mins => (v_piece ->> 'inicio_min')::int);
    v_end := v_start + make_interval(mins => greatest((v_piece ->> 'duracion_min')::int, 0));
    v_last := greatest(v_last, v_end);
    insert into route_items (event_id, title, planned_start, planned_end, current_start, current_end,
                             is_milestone, visible_to_viewer, sort_order)
    values (v_event, trim(v_piece ->> 'titulo'), v_start, v_end, v_start, v_end,
            coalesce((v_piece ->> 'clave')::boolean, false), coalesce((v_piece ->> 'visible_cliente')::boolean, true), v_i);
  end loop;

  update events set ends_at = v_last where id = v_event;

  if coalesce(trim(p_brief), '') <> '' then
    insert into briefs (event_id, body, channel, created_by) values (v_event, trim(p_brief), 'text', v_me);
  end if;

  perform public._log(v_event, 'event_created',
    format('%s creó el evento «%s» (%s) con %s piezas.', public._actor_name(v_me), trim(p_name), p_template ->> 'nombre', v_i),
    1, 'event', v_event, jsonb_build_object('kind', p_template ->> 'clave', 'tier', p_template ->> 'tamano'), true, v_me);

  return v_event;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Invitar, revocar, aceptar
-- ---------------------------------------------------------------------------

create or replace function public.invite_to_event(
  p_event uuid, p_email text, p_full_name text, p_title text, p_role event_role, p_level smallint default null
) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_me uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user uuid;
  v_inv uuid;
  v_event_name text;
begin
  if p_event is null or not public.is_event_backend(p_event) then
    raise exception 'Solo el productor general del evento puede invitar.' using errcode = '42501';
  end if;
  if (select status from events where id = p_event) = 'closed' then
    raise exception 'El evento está cerrado: ya no acepta cambios.' using errcode = '42501';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Escribe un correo válido.' using errcode = '22023';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Escribe el nombre de la persona.' using errcode = '22023';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Elige el cargo de la persona.' using errcode = '22023';
  end if;
  perform public._check_role_level(p_role, p_level);

  if exists (select 1 from invitations where event_id = p_event and email = v_email and revoked_at is null) then
    raise exception 'Esa persona ya tiene una invitación a este evento.' using errcode = '23505';
  end if;

  select id into v_user from auth.users where lower(email) = v_email limit 1;
  if v_user is not null and exists (select 1 from event_members where event_id = p_event and profile_id = v_user) then
    raise exception 'Esa persona ya es parte del equipo.' using errcode = '23505';
  end if;

  insert into invitations (event_id, email, full_name, role, title, level, invited_by, accepted_at, accepted_by)
  values (p_event, v_email, trim(p_full_name), p_role, trim(p_title), p_level, v_me,
          case when v_user is not null then now() end, v_user)
  returning id into v_inv;

  if v_user is not null then
    insert into event_members (event_id, profile_id, role, title, level, invited_by)
    values (p_event, v_user, p_role, trim(p_title), p_level, v_me);
  end if;

  select name into v_event_name from events where id = p_event;
  perform public._log(p_event, 'member_invited',
    format('%s invitó a %s como %s.', public._actor_name(v_me), trim(p_full_name), trim(p_title)),
    1, 'invitation', v_inv, jsonb_build_object('role', p_role, 'level', p_level), false, v_me);

  return jsonb_build_object('invitation_id', v_inv, 'joined', v_user is not null, 'event_name', v_event_name);
end $$;

create or replace function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_event uuid;
begin
  select event_id into v_event from invitations where id = p_invitation;
  if v_event is null or not public.is_event_backend(v_event) then
    raise exception 'Solo el productor general del evento puede retirar invitaciones.' using errcode = '42501';
  end if;
  update invitations set revoked_at = now()
   where id = p_invitation and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'Esa invitación ya fue aceptada o retirada.' using errcode = '22023';
  end if;
end $$;

-- ¿Puede este correo pedir un código? Solo si tiene una invitación pendiente. No dice a qué evento.
create or replace function public.invitation_pending(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from invitations
                  where email = lower(trim(coalesce(p_email, ''))) and accepted_at is null and revoked_at is null)
$$;

-- Al entrar con su código, la persona se une a todos los eventos a los que la invitaron.
create or replace function public.claim_invitations() returns int
language plpgsql security definer set search_path = public, auth as $$
declare
  v_me uuid := auth.uid();
  v_email text;
  v_inv record;
  v_count int := 0;
begin
  if v_me is null then
    raise exception 'Inicia sesión primero.' using errcode = '42501';
  end if;
  v_email := public._email_of(v_me);
  if v_email is null then return 0; end if;

  for v_inv in
    select * from invitations where email = v_email and accepted_at is null and revoked_at is null
    order by created_at
  loop
    -- El perfil nace con la parte del correo antes de la @; si es así, toma el nombre de la invitación.
    insert into profiles (id, full_name) values (v_me, v_inv.full_name)
    on conflict (id) do update set full_name = excluded.full_name
      where profiles.full_name = split_part(v_email, '@', 1);

    insert into event_members (event_id, profile_id, role, title, level, invited_by)
    values (v_inv.event_id, v_me, v_inv.role, v_inv.title, v_inv.level, v_inv.invited_by)
    on conflict (event_id, profile_id) do nothing;

    update invitations set accepted_at = now(), accepted_by = v_me where id = v_inv.id;
    perform public._log(v_inv.event_id, 'member_joined',
      format('%s activó su mando como %s.', public._actor_name(v_me), v_inv.title),
      1, 'invitation', v_inv.id, '{}'::jsonb, false, v_me);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- La persona vio la bienvenida y tomó el mando. Solo marca su propia fila.
create or replace function public.mark_welcomed(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update event_members set welcomed_at = coalesce(welcomed_at, now())
   where event_id = p_event and profile_id = auth.uid();
  if not found then
    raise exception 'No eres parte de este evento.' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Permisos de ejecución
-- ---------------------------------------------------------------------------

revoke execute on function public._email_of(uuid) from public, anon, authenticated;
revoke execute on function public._check_role_level(event_role, smallint) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_event_from_template(uuid, text, text, text, text, timestamptz, jsonb, jsonb, text)',
    'public.invite_to_event(uuid, text, text, text, event_role, smallint)',
    'public.revoke_invitation(uuid)',
    'public.claim_invitations()',
    'public.mark_welcomed(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

revoke execute on function public.invitation_pending(text) from public;
grant execute on function public.invitation_pending(text) to anon, authenticated;


-- Méritos y cierre del evento.
-- MANDO · Migración 6 · Méritos y cierre del evento (decisión 22).
--
--   1. Criterios del evento: los no negociables y los hitos estrella de la plantilla se copian al evento
--      al crearlo, y el equipo los marca: cumplido / falló (o logrado / no logrado).
--      Un no negociable fallado levanta una Red Flag y deja el evento sin estrellas.
--   2. Valoración: al cierre, cada persona del equipo de campo valora la producción de 1 a 5.
--   3. Cuenta de estrellas: la base entrega solo números (event_score_inputs) y la cuenta se hace con las
--      reglas de config/meritos.json. Así el cliente y el equipo ven las mismas estrellas sin que el cliente
--      lea nada interno.
--   4. Cierre: el productor general cierra el evento cuando todos los no negociables están marcados.
--   5. Citados (decisión 23, pensado para el podcast): hosts e invitados que no usan MANDO, con su hora de
--      citación, el recordatorio que se les mandó y su hora de llegada. Su puntualidad cuenta para las estrellas.
--   6. Enlace de publicación: dónde quedó publicado el resultado (por ejemplo, el episodio en YouTube).
-- Toda tabla nueva tiene seguridad por fila y su prueba en tests/db. La bitácora sigue sin poder editarse.

-- ---------------------------------------------------------------------------
-- 1 · Esquema
-- ---------------------------------------------------------------------------

alter type log_kind add value if not exists 'criterion_checked';
alter type log_kind add value if not exists 'production_rated';

alter table events add column if not exists closed_at timestamptz;
alter table events add column if not exists closed_by uuid references profiles(id);

create table if not exists event_criteria (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  kind        text not null check (kind in ('no_negociable', 'hito_estrella')),
  title       text not null check (length(trim(title)) > 0),
  status      text not null default 'pending' check (status in ('pending', 'ok', 'failed')),
  note        text,
  checked_by  uuid references profiles(id),
  checked_at  timestamptz,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  unique (event_id, kind, title)
);
create index if not exists event_criteria_event_idx on event_criteria (event_id, kind, sort_order);

alter table event_criteria enable row level security;
-- Todo miembro del evento ve los criterios y su estado: el cliente también sabe qué no se negocia.
-- Se escriben únicamente con mark_criterion.
drop policy if exists event_criteria_read on event_criteria;
create policy event_criteria_read on event_criteria for select to authenticated
  using (public.is_event_member(event_id));

create table if not exists event_ratings (
  event_id    uuid not null references events(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  stars       smallint not null check (stars between 1 and 5),
  comment     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (event_id, profile_id)
);

alter table event_ratings enable row level security;
-- Cada persona ve su propia valoración; el productor general ve todas. El cliente no ve ninguna.
drop policy if exists event_ratings_read on event_ratings;
create policy event_ratings_read on event_ratings for select to authenticated
  using (profile_id = auth.uid() or public.is_event_backend(event_id));

alter type log_kind add value if not exists 'guest_updated';
alter type log_kind add value if not exists 'published';

alter table events add column if not exists publish_url text;

create table if not exists event_guests (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  full_name   text not null check (length(trim(full_name)) > 0),
  guest_role  text not null default 'Invitado' check (length(trim(guest_role)) > 0),   -- Host, Invitado...
  phone       text,
  email       text,
  call_at     timestamptz not null,           -- hora de citación
  reminded_at timestamptz,                    -- último recordatorio enviado
  reminders   int not null default 0,
  arrived_at  timestamptz,
  removed_at  timestamptz,                    -- se retira, no se borra: la bitácora lo sigue nombrando
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists event_guests_event_idx on event_guests (event_id, call_at);

alter table event_guests enable row level security;
-- Tiene teléfonos y correos: solo el equipo lo ve. El cliente ve la puntualidad en las estrellas, no los datos.
drop policy if exists event_guests_read on event_guests;
create policy event_guests_read on event_guests for select to authenticated
  using (public.is_event_team(event_id));

-- ---------------------------------------------------------------------------
-- 2 · Los criterios nacen con el evento
-- ---------------------------------------------------------------------------

create or replace function public._seed_event_criteria(p_event uuid, p_template jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if jsonb_typeof(p_template -> 'no_negociables') = 'array' then
    insert into event_criteria (event_id, kind, title, sort_order)
    select p_event, 'no_negociable', trim(t.value), t.ordinality
    from jsonb_array_elements_text(p_template -> 'no_negociables') with ordinality t
    where trim(t.value) <> ''
    on conflict do nothing;
  end if;
  if jsonb_typeof(p_template -> 'hitos_estrella') = 'array' then
    insert into event_criteria (event_id, kind, title, sort_order)
    select p_event, 'hito_estrella', trim(t.value), t.ordinality
    from jsonb_array_elements_text(p_template -> 'hitos_estrella') with ordinality t
    where trim(t.value) <> ''
    on conflict do nothing;
  end if;
end $$;

create or replace function public._events_seed_criteria() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._seed_event_criteria(new.id, new.template);
  return new;
end $$;

drop trigger if exists events_seed_criteria on events;
create trigger events_seed_criteria after insert on events
  for each row execute function public._events_seed_criteria();

-- Eventos creados antes de esta migración.
do $$
declare e record;
begin
  for e in select id, template from events loop
    perform public._seed_event_criteria(e.id, e.template);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Marcar un criterio
-- ---------------------------------------------------------------------------

-- Lo marcan el productor general y el productor de campo (niveles 1 y 2).
create or replace function public.mark_criterion(p_criterion uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_criteria;
  v_level smallint;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_status text;
  v_summary text;
begin
  select * into v from event_criteria where id = p_criterion for update;
  if not found or v_me is null or not public.is_event_team(v.event_id) then
    raise exception 'No tienes permiso para marcar esto.' using errcode = '42501';
  end if;
  select level into v_level from event_members where event_id = v.event_id and profile_id = v_me;
  if v_level is null or v_level > 2 then
    raise exception 'Esto lo marca el productor general o el productor de campo.' using errcode = '42501';
  end if;
  if (select status from events where id = v.event_id) = 'closed' then
    raise exception 'El evento está cerrado: ya no acepta cambios.' using errcode = '42501';
  end if;
  if p_ok is null then
    raise exception 'Indica si se cumplió o no.' using errcode = '22023';
  end if;
  if v.kind = 'no_negociable' and not p_ok and v_note is null then
    raise exception 'Cuenta qué pasó: un no negociable fallado necesita una explicación.' using errcode = '22023';
  end if;

  v_status := case when p_ok then 'ok' else 'failed' end;
  if v.status = v_status and v.note is not distinct from v_note then
    return;
  end if;

  update event_criteria
    set status = v_status, note = v_note, checked_by = v_me, checked_at = now()
    where id = v.id;

  if v.kind = 'no_negociable' then
    v_summary := format('%s marcó el no negociable «%s» como %s.', public._actor_name(v_me), v.title,
                        case when p_ok then 'cumplido' else 'FALLADO' end);
  else
    v_summary := format('%s marcó el hito estrella «%s» como %s.', public._actor_name(v_me), v.title,
                        case when p_ok then 'logrado' else 'no logrado' end);
  end if;
  -- Los no negociables son públicos para el cliente; los hitos estrella solo cuando se logran.
  perform public._log(v.event_id, 'criterion_checked', v_summary,
    case when v.kind = 'no_negociable' and not p_ok then 4 else 1 end,
    'criterion', v.id, jsonb_build_object('kind', v.kind, 'status', v_status, 'note', v_note),
    v.kind = 'no_negociable' or p_ok, v_me);

  if v.kind = 'no_negociable' then
    if p_ok then
      perform public._auto_resolve(v.event_id, 'no_negociable_fallado', v.id, 'El no negociable quedó cumplido.', v_me);
    else
      perform public._raise_alert(v.event_id, 4, 'no_negociable_fallado',
        format('No negociable fallado: %s', v.title), v_note, 'criterion', v.id, v_me);
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Valorar la producción
-- ---------------------------------------------------------------------------

-- Valora el equipo de campo (niveles 2 a 4). El productor general no se valora a sí mismo y el cliente no valora aquí.
create or replace function public.rate_production(p_event uuid, p_stars int, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_level smallint;
  v_new boolean;
begin
  if v_me is null or not public.is_event_team(p_event) then
    raise exception 'No tienes permiso para valorar este evento.' using errcode = '42501';
  end if;
  select level into v_level from event_members where event_id = p_event and profile_id = v_me;
  if v_level is null or v_level < 2 then
    raise exception 'La valoración la da el equipo de campo, no el productor general.' using errcode = '42501';
  end if;
  if p_stars is null or p_stars not between 1 and 5 then
    raise exception 'La valoración va de 1 a 5.' using errcode = '22023';
  end if;

  insert into event_ratings (event_id, profile_id, stars, comment)
  values (p_event, v_me, p_stars, nullif(trim(coalesce(p_comment, '')), ''))
  on conflict (event_id, profile_id) do update
    set stars = excluded.stars, comment = excluded.comment, updated_at = now()
  returning (xmax = 0) into v_new;

  -- En la bitácora queda que valoró, no cuánto: la nota de cada persona es reservada.
  perform public._log(p_event, 'production_rated',
    format('%s %s la producción.', public._actor_name(v_me), case when v_new then 'valoró' else 'actualizó su valoración de' end),
    1, 'event', p_event, '{}'::jsonb, false, v_me);
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Números para la cuenta de estrellas
-- ---------------------------------------------------------------------------

-- Devuelve solo números (sin títulos ni textos internos), para que cualquier miembro, incluido el cliente,
-- vea las mismas estrellas. p_min_level: desde qué nivel una alerta cuenta como incidente.
create or replace function public.event_score_inputs(p_event uuid, p_min_level int default 3) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_now timestamptz := now();
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_event_member(p_event) then
    raise exception 'No tienes permiso para ver este evento.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'is_milestone', i.is_milestone,
        'start_delay_min', case when i.actual_start is null then null
                                else round(extract(epoch from (i.actual_start - i.planned_start)) / 60)::int end
      ) order by i.planned_start)
      from route_items i
      where i.event_id = p_event and i.status <> 'cancelled'
        and (i.actual_start is not null or i.planned_start <= v_now)
    ), '[]'::jsonb) || coalesce((
      -- Cada citado cuenta como una pieza: llegó a su hora o no.
      select jsonb_agg(jsonb_build_object(
        'is_milestone', false,
        'start_delay_min', case when g.arrived_at is null then null
                                else round(extract(epoch from (g.arrived_at - g.call_at)) / 60)::int end
      ) order by g.call_at)
      from event_guests g
      where g.event_id = p_event and g.removed_at is null
        and (g.arrived_at is not null or g.call_at <= v_now)
    ), '[]'::jsonb),
    'commitments', (
      select jsonb_build_object(
        'met', count(*) filter (where c.outcome = 'met'),
        'partial', count(*) filter (where c.outcome = 'partial'),
        'unmet', count(*) filter (where c.outcome = 'unmet'),
        'unchecked', count(*) filter (where c.outcome is null))
      from commitments c where c.event_id = p_event
    ),
    'incidents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'level', a.level,
        'resolve_min', case when a.resolved_at is null then null
                            else greatest(round(extract(epoch from (a.resolved_at - a.raised_at)) / 60)::int, 0) end
      ) order by a.raised_at)
      from alerts a where a.event_id = p_event and a.level >= p_min_level
    ), '[]'::jsonb),
    'mandatories', (
      select jsonb_build_object(
        'ok', count(*) filter (where status = 'ok'),
        'failed', count(*) filter (where status = 'failed'),
        'pending', count(*) filter (where status = 'pending'))
      from event_criteria where event_id = p_event and kind = 'no_negociable'
    ),
    'star_milestones', (
      select jsonb_build_object(
        'ok', count(*) filter (where status = 'ok'),
        'failed', count(*) filter (where status = 'failed'),
        'pending', count(*) filter (where status = 'pending'))
      from event_criteria where event_id = p_event and kind = 'hito_estrella'
    ),
    'rating', (
      select jsonb_build_object('average', round(avg(stars)::numeric, 2), 'count', count(*))
      from event_ratings where event_id = p_event
    ),
    'red_flags', (select count(*) from alerts where event_id = p_event and level = 4),
    'started', exists (select 1 from route_items where event_id = p_event and actual_start is not null),
    'summary', jsonb_build_object(
      'items_total', (select count(*) from route_items where event_id = p_event and status <> 'cancelled'),
      'items_done', (select count(*) from route_items where event_id = p_event and status = 'done'),
      'changes', (select count(*) from log_entries where event_id = p_event and kind = 'change_applied'),
      'alerts', (select count(*) from alerts where event_id = p_event),
      'alerts_open', (select count(*) from alerts where event_id = p_event and status <> 'resolved'),
      'evidences', (select count(*) from evidences where event_id = p_event),
      'guests', (select count(*) from event_guests where event_id = p_event and removed_at is null),
      'guests_on_time', (select count(*) from event_guests where event_id = p_event and removed_at is null
                           and arrived_at is not null and arrived_at <= call_at + interval '10 minutes')
    )
  ) into v_result;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- 6 · Cerrar el evento
-- ---------------------------------------------------------------------------

create or replace function public.close_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_status event_status;
  v_pending int;
begin
  if v_me is null or not public.is_event_backend(p_event) then
    raise exception 'Solo el productor general cierra el evento.' using errcode = '42501';
  end if;
  select status into v_status from events where id = p_event for update;
  if v_status = 'closed' then
    raise exception 'El evento ya está cerrado.' using errcode = '22023';
  end if;
  select count(*) into v_pending from event_criteria
    where event_id = p_event and kind = 'no_negociable' and status = 'pending';
  if v_pending > 0 then
    raise exception 'Antes de cerrar, marca los no negociables que faltan (%).', v_pending using errcode = '22023';
  end if;

  update events set status = 'closed', closed_at = now(), closed_by = v_me where id = p_event;
  perform public._log(p_event, 'event_closed',
    format('%s cerró el evento.', public._actor_name(v_me)), 1, 'event', p_event, '{}'::jsonb, true, v_me);
end $$;

-- ---------------------------------------------------------------------------
-- 7 · Citados y enlace de publicación
-- ---------------------------------------------------------------------------

-- Los maneja quien coordina: niveles 1 a 3.
create or replace function public._require_coordinator(p_event uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_level smallint;
begin
  perform public._require_team(p_event);
  select level into v_level from event_members where event_id = p_event and profile_id = auth.uid();
  if v_level is null or v_level > 3 then
    raise exception 'Esto lo maneja quien coordina el evento.' using errcode = '42501';
  end if;
end $$;

create or replace function public.add_guest(
  p_event uuid, p_full_name text, p_guest_role text, p_call_at timestamptz, p_phone text default null, p_email text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  perform public._require_coordinator(p_event);
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Escribe el nombre de la persona citada.' using errcode = '22023';
  end if;
  if p_call_at is null then
    raise exception 'Falta la hora de citación.' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'El correo no parece válido.' using errcode = '22023';
  end if;
  insert into event_guests (event_id, full_name, guest_role, phone, email, call_at, created_by)
  values (p_event, trim(p_full_name), coalesce(nullif(trim(p_guest_role), ''), 'Invitado'), v_phone, v_email, p_call_at, v_me)
  returning id into v_id;
  perform public._log(p_event, 'guest_updated',
    format('%s citó a %s (%s) para las %s.', public._actor_name(v_me), trim(p_full_name),
           coalesce(nullif(trim(p_guest_role), ''), 'Invitado'), public._hhmi(p_event, p_call_at)),
    1, 'guest', v_id, '{}'::jsonb, false, v_me);
  return v_id;
end $$;

-- p_action: 'reminded' (se le mandó recordatorio), 'arrived' (llegó ahora), 'undo_arrived', 'remove'.
create or replace function public.update_guest(p_guest uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_guests;
  v_delay int;
begin
  select * into v from event_guests where id = p_guest and removed_at is null for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._require_coordinator(v.event_id);

  if p_action = 'reminded' then
    update event_guests set reminded_at = now(), reminders = reminders + 1 where id = v.id;
    perform public._log(v.event_id, 'guest_updated',
      format('%s le mandó un recordatorio a %s.', public._actor_name(v_me), v.full_name), 1, 'guest', v.id, '{}'::jsonb, false, v_me);
  elsif p_action = 'arrived' then
    if v.arrived_at is not null then return; end if;
    update event_guests set arrived_at = now() where id = v.id;
    v_delay := round(extract(epoch from (now() - v.call_at)) / 60)::int;
    perform public._log(v.event_id, 'guest_updated',
      format('%s llegó %s.', v.full_name,
             case when v_delay > 0 then format('%s min después de su citación', v_delay)
                  when v_delay < 0 then format('%s min antes de su citación', -v_delay)
                  else 'a su hora' end),
      1, 'guest', v.id, jsonb_build_object('delay_min', v_delay), true, v_me);
  elsif p_action = 'undo_arrived' then
    if v.arrived_at is null then return; end if;
    update event_guests set arrived_at = null where id = v.id;
    perform public._log(v.event_id, 'correction',
      format('%s corrigió: %s todavía no llega.', public._actor_name(v_me), v.full_name), 1, 'guest', v.id, '{}'::jsonb, true, v_me);
  elsif p_action = 'remove' then
    update event_guests set removed_at = now() where id = v.id;
    perform public._log(v.event_id, 'guest_updated',
      format('%s retiró la citación de %s.', public._actor_name(v_me), v.full_name), 1, 'guest', v.id, '{}'::jsonb, false, v_me);
  else
    raise exception 'Acción desconocida.' using errcode = '22023';
  end if;
end $$;

-- Dónde quedó publicado el resultado (el episodio en YouTube, el video del evento...). Niveles 1 y 2.
create or replace function public.set_publish_url(p_event uuid, p_url text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_level smallint;
  v_url text := nullif(trim(coalesce(p_url, '')), '');
begin
  if v_me is null or not public.is_event_team(p_event) then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  select level into v_level from event_members where event_id = p_event and profile_id = v_me;
  if v_level is null or v_level > 2 then
    raise exception 'Esto lo marca el productor general o el productor de campo.' using errcode = '42501';
  end if;
  if v_url is not null and (v_url !~ '^https://[^[:space:]]+\.[^[:space:]]+$' or length(v_url) > 500) then
    raise exception 'Pega el enlace completo, empezando con https://' using errcode = '22023';
  end if;
  if v_url is not distinct from (select publish_url from events where id = p_event) then
    return;
  end if;
  update events set publish_url = v_url where id = p_event;
  perform public._log(p_event, 'published',
    case when v_url is null then format('%s quitó el enlace de publicación.', public._actor_name(v_me))
         else format('%s registró la publicación: %s', public._actor_name(v_me), v_url) end,
    1, 'event', p_event, jsonb_build_object('url', v_url), true, v_me);
end $$;

-- ---------------------------------------------------------------------------
-- 8 · Permisos de las funciones y tiempo real
-- ---------------------------------------------------------------------------

revoke execute on function public._seed_event_criteria(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public._events_seed_criteria() from public, anon, authenticated;
revoke execute on function public._require_coordinator(uuid) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.mark_criterion(uuid, boolean, text)',
    'public.rate_production(uuid, int, text)',
    'public.event_score_inputs(uuid, int)',
    'public.close_event(uuid)',
    'public.add_guest(uuid, text, text, timestamptz, text, text)',
    'public.update_guest(uuid, text)',
    'public.set_publish_url(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table event_criteria; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table event_guests; exception when duplicate_object then null; end;
  end if;
end $$;


-- Expediente y locación.
-- MANDO · Migración 7 · Expediente y locación del evento (decisiones 25 y 26).
--
--   1. Expediente: los documentos que el evento necesita (seguridad, permisos, proveedores, logística,
--      administración y eventualidades). La lista sale de config/expediente.json según el tipo de evento,
--      viaja dentro de la plantilla y se copia al evento al crearlo. Cada documento nace pendiente, con plazo
--      contado desde la hora clave. La productora marca «no aplica» lo que ese evento no necesita.
--   2. Recordatorios: las reglas de reloj avisan cuando a un documento le quedan pocos días (Atención),
--      cuando venció (Crítico) y, si es no negociable y el evento ya llegó a su hora clave, Red Flag.
--   3. Locación: punto de encuentro con mapa, quién coordina, transporte y placa, antecedentes del lugar,
--      zonas killer y puntos ciegos.
-- Toda tabla nueva tiene seguridad por fila y su prueba en tests/db. La bitácora sigue sin poder editarse.

-- ---------------------------------------------------------------------------
-- 1 · Esquema
-- ---------------------------------------------------------------------------

alter type log_kind add value if not exists 'requirement_updated';
alter type log_kind add value if not exists 'location_updated';

create table if not exists event_requirements (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  key         text,                                   -- clave del catálogo; null si se agregó a mano
  category    text not null default 'administracion'
              check (category in ('seguridad', 'permisos', 'proveedores', 'logistica', 'administracion', 'eventualidades')),
  title       text not null check (length(trim(title)) > 0),
  mandatory   boolean not null default false,         -- no negociable
  due_at      timestamptz,
  status      text not null default 'pending' check (status in ('pending', 'done', 'not_applicable')),
  owner_id    uuid references profiles(id),           -- quién debe subirlo
  file_path   text,
  file_name   text,
  sha256      text,
  note        text,
  done_by     uuid references profiles(id),
  done_at     timestamptz,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create unique index if not exists event_requirements_key_idx on event_requirements (event_id, key) where key is not null;
create index if not exists event_requirements_event_idx on event_requirements (event_id, status, due_at);

alter table event_requirements enable row level security;
-- Contratos, facturas y seguros son internos: solo el equipo los ve. Se escriben con las funciones de abajo.
drop policy if exists event_requirements_read on event_requirements;
create policy event_requirements_read on event_requirements for select to authenticated
  using (public.is_event_team(event_id));

create table if not exists event_locations (
  event_id          uuid primary key references events(id) on delete cascade,
  meeting_point     text,
  map_url           text,
  coordinator       text,
  coordinator_phone text,
  transport_plate   text,
  transport_detail  text,
  antecedents       jsonb not null default '[]'::jsonb,   -- lo que ya pasó antes en este lugar
  killer_zones      text,
  blind_spots       text,
  updated_by        uuid references profiles(id),
  updated_at        timestamptz not null default now()
);

alter table event_locations enable row level security;
drop policy if exists event_locations_read on event_locations;
create policy event_locations_read on event_locations for select to authenticated
  using (public.is_event_team(event_id));

-- ---------------------------------------------------------------------------
-- 2 · El expediente nace con el evento
-- ---------------------------------------------------------------------------

create or replace function public._seed_event_requirements(p_event uuid, p_template jsonb, p_key_time timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if jsonb_typeof(p_template -> 'documentos') is distinct from 'array' then
    return;
  end if;
  insert into event_requirements (event_id, key, category, title, mandatory, due_at, sort_order)
  select p_event, d.value ->> 'clave',
         coalesce(d.value ->> 'categoria', 'administracion'),
         trim(d.value ->> 'titulo'),
         coalesce((d.value ->> 'no_negociable')::boolean, false),
         case when p_key_time is null then null
              else p_key_time + make_interval(days => coalesce((d.value ->> 'plazo_dias')::int, 0)) end,
         d.ordinality
  from jsonb_array_elements(p_template -> 'documentos') with ordinality d
  where coalesce(trim(d.value ->> 'titulo'), '') <> '' and coalesce(d.value ->> 'clave', '') <> ''
  on conflict do nothing;
end $$;

create or replace function public._events_seed_criteria() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._seed_event_criteria(new.id, new.template);
  perform public._seed_event_requirements(new.id, new.template, new.starts_at);
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Ayudas
-- ---------------------------------------------------------------------------

-- Nivel de quien llama dentro del equipo del evento. Falla si no es del equipo.
create or replace function public._my_level(p_event uuid) returns smallint
language plpgsql stable security definer set search_path = public as $$
declare v_level smallint;
begin
  if auth.uid() is null or p_event is null or not public.is_event_team(p_event) then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  select level into v_level from event_members where event_id = p_event and profile_id = auth.uid();
  return coalesce(v_level, 4);
end $$;

create or replace function public._resolve_requirement_alerts(p_req event_requirements, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._auto_resolve(p_req.event_id, 'documento_pendiente', p_req.id, p_reason, auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Acciones del expediente
-- ---------------------------------------------------------------------------

-- Cualquiera del equipo sube un documento, también después del cierre (facturas, cobranza).
create or replace function public.complete_requirement(
  p_requirement uuid, p_file_path text default null, p_file_name text default null,
  p_sha256 text default null, p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_requirements;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_path text := nullif(trim(coalesce(p_file_path, '')), '');
begin
  select * into v from event_requirements where id = p_requirement for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._my_level(v.event_id);
  if v_path is null and v_note is null then
    raise exception 'Sube el archivo o escribe el dato.' using errcode = '22023';
  end if;
  if v_path is not null and v_path not like v.event_id::text || '/expediente/%' then
    raise exception 'El archivo no pertenece al expediente de este evento.' using errcode = '22023';
  end if;

  update event_requirements
    set status = 'done', file_path = coalesce(v_path, file_path), file_name = case when v_path is null then file_name else nullif(trim(p_file_name), '') end,
        sha256 = case when v_path is null then sha256 else p_sha256 end, note = coalesce(v_note, note),
        done_by = v_me, done_at = now()
    where id = v.id;

  perform public._log(v.event_id, 'requirement_updated',
    format('%s subió «%s» al expediente.', public._actor_name(v_me), v.title),
    1, 'requirement', v.id, jsonb_build_object('status', 'done', 'sha256', p_sha256), false, v_me);
  perform public._resolve_requirement_alerts(v, 'El documento ya está en el expediente.');
end $$;

-- «No aplica» o volver a pendiente: lo deciden los niveles 1 y 2.
create or replace function public.set_requirement_status(p_requirement uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_requirements;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into v from event_requirements where id = p_requirement for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  if public._my_level(v.event_id) > 2 then
    raise exception 'Esto lo decide el productor general o el productor de campo.' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'not_applicable') then
    raise exception 'Estado desconocido.' using errcode = '22023';
  end if;
  if v.status = p_status then
    return;
  end if;
  if p_status = 'not_applicable' and v.mandatory and v_note is null then
    raise exception 'Es no negociable: explica por qué no aplica en este evento.' using errcode = '22023';
  end if;

  update event_requirements set status = p_status, note = coalesce(v_note, note), done_by = v_me, done_at = now() where id = v.id;
  perform public._log(v.event_id, 'requirement_updated',
    format('%s marcó «%s» como %s.', public._actor_name(v_me), v.title,
           case p_status when 'not_applicable' then 'no aplica' else 'pendiente' end),
    1, 'requirement', v.id, jsonb_build_object('status', p_status, 'note', v_note), false, v_me);
  if p_status = 'not_applicable' then
    perform public._resolve_requirement_alerts(v, 'El documento no aplica en este evento.');
  end if;
end $$;

-- Quién debe subirlo y para cuándo. Niveles 1 y 2.
create or replace function public.plan_requirement(p_requirement uuid, p_owner uuid, p_due_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_requirements;
begin
  select * into v from event_requirements where id = p_requirement for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  if public._my_level(v.event_id) > 2 then
    raise exception 'Esto lo decide el productor general o el productor de campo.' using errcode = '42501';
  end if;
  if p_owner is not null and not exists (
    select 1 from event_members where event_id = v.event_id and profile_id = p_owner and role <> 'viewer') then
    raise exception 'Esa persona no es del equipo de este evento.' using errcode = '22023';
  end if;
  if v.owner_id is not distinct from p_owner and v.due_at is not distinct from p_due_at then
    return;
  end if;
  update event_requirements set owner_id = p_owner, due_at = p_due_at where id = v.id;
  perform public._log(v.event_id, 'requirement_updated',
    format('%s dejó «%s» a cargo de %s%s.', public._actor_name(v_me), v.title,
           coalesce(public._actor_name(p_owner), 'nadie'),
           case when p_due_at is null then '' else format(', con plazo hasta el %s', to_char(p_due_at at time zone (select timezone from events where id = v.event_id), 'DD/MM')) end),
    1, 'requirement', v.id, jsonb_build_object('owner', p_owner, 'due_at', p_due_at), false, v_me);
end $$;

create or replace function public.add_requirement(
  p_event uuid, p_title text, p_category text, p_due_at timestamptz default null, p_mandatory boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if public._my_level(p_event) > 2 then
    raise exception 'Esto lo decide el productor general o el productor de campo.' using errcode = '42501';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Escribe el nombre del documento.' using errcode = '22023';
  end if;
  insert into event_requirements (event_id, category, title, mandatory, due_at, sort_order)
  values (p_event, coalesce(nullif(p_category, ''), 'administracion'), trim(p_title), coalesce(p_mandatory, false), p_due_at,
          coalesce((select max(sort_order) from event_requirements where event_id = p_event), 0) + 1)
  returning id into v_id;
  perform public._log(p_event, 'requirement_updated',
    format('%s agregó «%s» al expediente.', public._actor_name(v_me), trim(p_title)),
    1, 'requirement', v_id, '{}'::jsonb, false, v_me);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Recordatorios por reloj
-- ---------------------------------------------------------------------------

-- Una sola alerta por documento, que va subiendo de nivel: por vencer → vencido → no negociable vencido.
create or replace function public._evaluate_requirement_rules(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  e events;
  v_now timestamptz := now();
  v_soon jsonb := public._rule(p_event, 'documento_por_vencer');
  v_late jsonb := public._rule(p_event, 'documento_vencido');
  v_flag jsonb := public._rule(p_event, 'documento_no_negociable_vencido');
  v_days int := public._rule_param(v_soon, 'dias_antes', 2)::int;
  v_before int;
  v_after int;
  v_left int;
  v_who text;
  r event_requirements;
begin
  select * into e from events where id = p_event;
  if not found or e.status = 'closed' then
    return 0;
  end if;
  select count(*) into v_before from log_entries where event_id = p_event and kind = 'alert_raised';

  for r in
    select * from event_requirements
    where event_id = p_event and status = 'pending' and due_at is not null
      and due_at - make_interval(days => v_days) <= v_now
  loop
    v_who := case when r.owner_id is null then '' else format(' Responsable: %s.', public._actor_name(r.owner_id)) end;
    if r.due_at < v_now then
      if r.mandatory and e.starts_at is not null and e.starts_at <= v_now then
        perform public._raise_alert(p_event, coalesce((v_flag ->> 'nivel')::int, 4), 'documento_pendiente',
          format('No negociable sin documento: %s', r.title),
          'El evento ya llegó a su hora clave y el documento no está en el expediente.' || v_who, 'requirement', r.id, null);
      else
        perform public._raise_alert(p_event, coalesce((v_late ->> 'nivel')::int, 3), 'documento_pendiente',
          format('Documento vencido: %s', r.title),
          format('Su plazo era el %s.', to_char(r.due_at at time zone e.timezone, 'DD/MM')) ||
            case when r.mandatory then ' Es un requisito no negociable.' else '' end || v_who, 'requirement', r.id, null);
      end if;
    else
      v_left := ceil(extract(epoch from (r.due_at - v_now)) / 86400)::int;
      perform public._raise_alert(p_event, coalesce((v_soon ->> 'nivel')::int, 2), 'documento_pendiente',
        format('Falta subir: %s', r.title),
        format('%s para su plazo.', case when v_left <= 1 then 'Queda menos de 1 día' else format('Quedan %s días', v_left) end) ||
          case when r.mandatory then ' Es un requisito no negociable.' else '' end || v_who, 'requirement', r.id, null);
    end if;
  end loop;

  select count(*) into v_after from log_entries where event_id = p_event and kind = 'alert_raised';
  return v_after - v_before;
end $$;

create or replace function public.evaluate_clock_rules(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_team(p_event);
  return public._evaluate_clock_rules(p_event) + public._evaluate_requirement_rules(p_event);
end $$;

-- Las reglas de la hoja de ruta corren cerca del evento; las del expediente, desde antes y hasta después.
create or replace function public.run_clock_rules_all() returns int
language plpgsql security definer set search_path = public as $$
declare e record; v_total int := 0;
begin
  for e in
    select id,
           (starts_at is not null and starts_at - interval '1 day' <= now()
            and coalesce(ends_at, starts_at) + interval '1 day' >= now()) as near
    from events
    where status in ('planned', 'live')
  loop
    if e.near then
      v_total := v_total + public._evaluate_clock_rules(e.id);
    end if;
    v_total := v_total + public._evaluate_requirement_rules(e.id);
  end loop;
  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- 6 · Locación
-- ---------------------------------------------------------------------------

-- p_data: meeting_point, map_url, coordinator, coordinator_phone, transport_plate, transport_detail,
--         antecedents (lista de textos), killer_zones, blind_spots. Niveles 1 y 2.
create or replace function public.set_location(p_event uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_url text := nullif(trim(coalesce(p_data ->> 'map_url', '')), '');
  v_antecedents jsonb;
begin
  if public._my_level(p_event) > 2 then
    raise exception 'Esto lo decide el productor general o el productor de campo.' using errcode = '42501';
  end if;
  if (select status from events where id = p_event) = 'closed' then
    raise exception 'El evento está cerrado: ya no acepta cambios.' using errcode = '42501';
  end if;
  if v_url is not null and (v_url !~ '^https://[^[:space:]]+\.[^[:space:]]+$' or length(v_url) > 500) then
    raise exception 'Pega el enlace del mapa completo, empezando con https://' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(trim(a.value)), '[]'::jsonb) into v_antecedents
  from jsonb_array_elements_text(case when jsonb_typeof(p_data -> 'antecedents') = 'array' then p_data -> 'antecedents' else '[]'::jsonb end) a
  where trim(a.value) <> '';
  if jsonb_array_length(v_antecedents) > 10 then
    raise exception 'Deja como máximo 10 antecedentes.' using errcode = '22023';
  end if;

  insert into event_locations (event_id, meeting_point, map_url, coordinator, coordinator_phone, transport_plate,
                               transport_detail, antecedents, killer_zones, blind_spots, updated_by, updated_at)
  values (p_event,
          nullif(trim(coalesce(p_data ->> 'meeting_point', '')), ''), v_url,
          nullif(trim(coalesce(p_data ->> 'coordinator', '')), ''),
          nullif(regexp_replace(coalesce(p_data ->> 'coordinator_phone', ''), '[^0-9+]', '', 'g'), ''),
          nullif(upper(trim(coalesce(p_data ->> 'transport_plate', ''))), ''),
          nullif(trim(coalesce(p_data ->> 'transport_detail', '')), ''),
          v_antecedents,
          nullif(trim(coalesce(p_data ->> 'killer_zones', '')), ''),
          nullif(trim(coalesce(p_data ->> 'blind_spots', '')), ''),
          v_me, now())
  on conflict (event_id) do update set
    meeting_point = excluded.meeting_point, map_url = excluded.map_url, coordinator = excluded.coordinator,
    coordinator_phone = excluded.coordinator_phone, transport_plate = excluded.transport_plate,
    transport_detail = excluded.transport_detail, antecedents = excluded.antecedents,
    killer_zones = excluded.killer_zones, blind_spots = excluded.blind_spots,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  perform public._log(p_event, 'location_updated',
    format('%s actualizó los datos de la locación.', public._actor_name(v_me)),
    1, 'event', p_event, '{}'::jsonb, false, v_me);
end $$;

-- ---------------------------------------------------------------------------
-- 7 · Archivos del expediente, permisos y tiempo real
-- ---------------------------------------------------------------------------

-- Los archivos del expediente van al mismo cubo privado, en <evento>/expediente/. Los sube el equipo,
-- también con el evento cerrado (facturas y cobranza llegan después). Leerlos sigue siendo solo del equipo.
create or replace function public.can_upload_requirement_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 2) <> 'expediente' or split_part(p_name, '/', 3) = '' then
    return false;
  end if;
  return public.is_event_team(split_part(p_name, '/', 1)::uuid);
end $$;

revoke execute on function public.can_upload_requirement_file(text) from public, anon;
grant execute on function public.can_upload_requirement_file(text) to authenticated;

revoke execute on function public._seed_event_requirements(uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public._my_level(uuid) from public, anon, authenticated;
revoke execute on function public._resolve_requirement_alerts(event_requirements, text) from public, anon, authenticated;
revoke execute on function public._evaluate_requirement_rules(uuid) from public, anon, authenticated;
revoke execute on function public.run_clock_rules_all() from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.complete_requirement(uuid, text, text, text, text)',
    'public.set_requirement_status(uuid, text, text)',
    'public.plan_requirement(uuid, uuid, timestamptz)',
    'public.add_requirement(uuid, text, text, timestamptz, boolean)',
    'public.evaluate_clock_rules(uuid)',
    'public.set_location(uuid, jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists expediente_files_insert on storage.objects;
    create policy expediente_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'evidences' and public.can_upload_requirement_file(name));
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table event_requirements; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table event_locations; exception when duplicate_object then null; end;
  end if;
end $$;


-- Aprobaciones del cliente.
-- MANDO · Migración 8 · Aprobaciones del cliente (decisiones 28 y 29).
--
--   1. Elementos base: casting, uniforme, utilería y referencias visuales. La productora sube cada elemento
--      con su foto; el cliente lo aprueba o pide un cambio, en vivo. Cada decisión queda en la bitácora.
--   2. Grupos por evento: salen del tipo de evento (config/aprobaciones.json) y la productora los ajusta
--      según el brief.
--   3. Sin todo aprobado no se empieza: mientras un grupo prendido no tenga elementos o quede algo sin
--      aprobar, las piezas clave del evento no se pueden marcar como empezadas.
-- Toda tabla nueva tiene seguridad por fila y su prueba en tests/db. La bitácora sigue sin poder editarse.

-- ---------------------------------------------------------------------------
-- 1 · Esquema
-- ---------------------------------------------------------------------------

alter type log_kind add value if not exists 'approval_updated';

alter table events add column if not exists approval_groups text[] not null default '{}';

create table if not exists event_approvals (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  group_key   text not null check (group_key in ('casting', 'uniforme', 'utileria', 'referencias')),
  code        text not null,                           -- código corto: C-01, U-02...
  name        text not null check (length(trim(name)) > 0),
  detail      text,
  file_path   text,
  sha256      text,
  version     int not null default 1,                  -- sube cada vez que se reemplaza
  status      text not null default 'pending' check (status in ('pending', 'approved', 'changes_requested')),
  decision_note text,
  decided_by  uuid references profiles(id),
  decided_at  timestamptz,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  removed_at  timestamptz,
  unique (event_id, code)
);
create index if not exists event_approvals_event_idx on event_approvals (event_id, group_key, created_at);

alter table event_approvals enable row level security;
-- El cliente es quien aprueba: todo miembro del evento ve los elementos. Se escriben con las funciones de abajo.
drop policy if exists event_approvals_read on event_approvals;
create policy event_approvals_read on event_approvals for select to authenticated
  using (public.is_event_member(event_id));

-- ---------------------------------------------------------------------------
-- 2 · Los grupos nacen con el evento
-- ---------------------------------------------------------------------------

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
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Acciones de la productora (niveles 1 a 3)
-- ---------------------------------------------------------------------------

create or replace function public._approval_prefix(p_group text) returns text
language sql immutable as $$
  select case p_group when 'casting' then 'C' when 'uniforme' then 'U' when 'utileria' then 'T' when 'referencias' then 'R' end
$$;

create or replace function public._check_approval_file(p_event uuid, p_path text) returns void
language plpgsql immutable as $$
begin
  if p_path is not null and p_path not like p_event::text || '/aprobaciones/%' then
    raise exception 'La foto no pertenece a las aprobaciones de este evento.' using errcode = '22023';
  end if;
end $$;

-- Qué grupos pide este evento, según el brief. Niveles 1 y 2.
create or replace function public.set_approval_groups(p_event uuid, p_groups text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_groups text[];
begin
  if public._my_level(p_event) > 2 then
    raise exception 'Esto lo decide el productor general o el productor de campo.' using errcode = '42501';
  end if;
  perform public._require_team(p_event);
  select coalesce(array_agg(g order by array_position(array['casting', 'uniforme', 'utileria', 'referencias'], g)), '{}')
    into v_groups
  from (select distinct unnest(coalesce(p_groups, '{}')) as g) x
  where g in ('casting', 'uniforme', 'utileria', 'referencias');
  if v_groups = (select approval_groups from events where id = p_event) then
    return;
  end if;
  update events set approval_groups = v_groups where id = p_event;
  perform public._log(p_event, 'approval_updated',
    format('%s definió lo que el cliente aprueba antes de empezar: %s.', public._actor_name(v_me),
           case when cardinality(v_groups) = 0 then 'nada' else array_to_string(v_groups, ', ') end),
    1, 'event', p_event, jsonb_build_object('groups', v_groups), true, v_me);
end $$;

create or replace function public.add_approval_item(
  p_event uuid, p_group text, p_name text, p_detail text default null, p_file_path text default null, p_sha256 text default null
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

  insert into event_approvals (event_id, group_key, code, name, detail, file_path, sha256, created_by)
  values (p_event, p_group, v_code, trim(p_name), nullif(trim(coalesce(p_detail, '')), ''), v_path, p_sha256, v_me)
  returning id into v_id;
  perform public._log(p_event, 'approval_updated',
    format('%s subió %s «%s» para aprobación.', public._actor_name(v_me), v_code, trim(p_name)),
    1, 'approval', v_id, jsonb_build_object('group', p_group, 'status', 'pending'), true, v_me);
  return v_id;
end $$;

-- Reemplazar vuelve el elemento a «por aprobar». p_action: 'replace' | 'remove'.
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
    update event_approvals set removed_at = now() where id = v.id;
    perform public._log(v.event_id, 'approval_updated',
      format('%s retiró %s «%s».', public._actor_name(v_me), v.code, v.name),
      1, 'approval', v.id, jsonb_build_object('group', v.group_key, 'removed', true), true, v_me);
  else
    raise exception 'Acción desconocida.' using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · La decisión del cliente
-- ---------------------------------------------------------------------------

-- Aprueba el cliente. El productor general puede registrar una aprobación que el cliente dio por otro medio,
-- y debe decir cómo la recibió. Pedir un cambio siempre lleva el motivo.
create or replace function public.decide_approval(p_item uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_approvals;
  v_role event_role;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_status text;
begin
  select * into v from event_approvals where id = p_item and removed_at is null for update;
  if not found or v_me is null then
    raise exception 'No tienes permiso para decidir esto.' using errcode = '42501';
  end if;
  v_role := public.my_event_role(v.event_id);
  if v_role is null or v_role = 'producer' then
    raise exception 'La aprobación la da el cliente.' using errcode = '42501';
  end if;
  if (select status from events where id = v.event_id) = 'closed' then
    raise exception 'El evento está cerrado: ya no acepta cambios.' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'Indica si apruebas o pides un cambio.' using errcode = '22023';
  end if;
  if not p_approve and v_note is null then
    raise exception 'Cuenta qué hay que cambiar.' using errcode = '22023';
  end if;
  if v_role = 'backend' and v_note is null then
    raise exception 'Anota cómo te dio el cliente su aprobación (llamada, correo, WhatsApp).' using errcode = '22023';
  end if;

  v_status := case when p_approve then 'approved' else 'changes_requested' end;
  update event_approvals set status = v_status, decision_note = v_note, decided_by = v_me, decided_at = now() where id = v.id;
  perform public._log(v.event_id, 'approval_updated',
    case
      when v_role = 'backend' then format('%s registró que el cliente %s %s «%s»: %s', public._actor_name(v_me),
                                          case when p_approve then 'aprobó' else 'pidió un cambio en' end, v.code, v.name, v_note)
      when p_approve then format('%s aprobó %s «%s».', public._actor_name(v_me), v.code, v.name)
      else format('%s pidió un cambio en %s «%s»: %s', public._actor_name(v_me), v.code, v.name, v_note)
    end,
    case when p_approve then 1 else 2 end, 'approval', v.id,
    jsonb_build_object('group', v.group_key, 'status', v_status, 'version', v.version, 'on_behalf', v_role = 'backend'), true, v_me);
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Sin todo aprobado no se empieza
-- ---------------------------------------------------------------------------

-- Texto con lo que falta, o null si el evento está listo. La misma cuenta que usa la pantalla.
create or replace function public._approvals_missing(p_event uuid) returns text
language sql stable security definer set search_path = public as $$
  select string_agg(
           case when t.total = 0 then g.name || ': falta subirlo' else g.name || ': ' || t.open || ' por aprobar' end,
           '; ' order by g.ord)
  from events e
  cross join lateral unnest(e.approval_groups) with ordinality as u(key, ord0)
  join (values ('casting', 'Casting', 1), ('uniforme', 'Uniforme', 2), ('utileria', 'Utilería', 3), ('referencias', 'Referencias visuales', 4))
       as g(key, name, ord) on g.key = u.key
  cross join lateral (
    select count(*) as total, count(*) filter (where a.status <> 'approved') as open
    from event_approvals a where a.event_id = e.id and a.group_key = u.key and a.removed_at is null
  ) t
  where e.id = p_event and (t.total = 0 or t.open > 0)
$$;

create or replace function public._route_items_approval_gate() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_missing text;
begin
  if new.is_milestone and old.actual_start is null and new.actual_start is not null then
    v_missing := public._approvals_missing(new.event_id);
    if v_missing is not null then
      raise exception 'No se puede empezar «%»: falta la aprobación del cliente (%).', new.title, v_missing using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists route_items_approval_gate on route_items;
create trigger route_items_approval_gate before update of actual_start on route_items
  for each row execute function public._route_items_approval_gate();

-- ---------------------------------------------------------------------------
-- 6 · Fotos, permisos y tiempo real
-- ---------------------------------------------------------------------------

-- Las fotos van al cubo privado, en <evento>/aprobaciones/. Las sube el equipo; las ve todo miembro del evento,
-- porque el cliente tiene que verlas para aprobar.
create or replace function public.can_upload_approval_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_event uuid;
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 2) <> 'aprobaciones' or split_part(p_name, '/', 3) = '' then
    return false;
  end if;
  v_event := split_part(p_name, '/', 1)::uuid;
  return public.is_event_team(v_event) and coalesce((select status from events where id = v_event) <> 'closed', false);
end $$;

create or replace function public.can_read_approval_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 2) <> 'aprobaciones' then
    return false;
  end if;
  return public.is_event_member(split_part(p_name, '/', 1)::uuid);
end $$;

revoke execute on function public.can_upload_approval_file(text) from public, anon;
revoke execute on function public.can_read_approval_file(text) from public, anon;
grant execute on function public.can_upload_approval_file(text) to authenticated;
grant execute on function public.can_read_approval_file(text) to authenticated;

revoke execute on function public._approval_prefix(text) from public, anon, authenticated;
revoke execute on function public._check_approval_file(uuid, text) from public, anon, authenticated;
revoke execute on function public._approvals_missing(uuid) from public, anon, authenticated;
revoke execute on function public._route_items_approval_gate() from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.set_approval_groups(uuid, text[])',
    'public.add_approval_item(uuid, text, text, text, text, text)',
    'public.update_approval_item(uuid, text, text, text, text, text)',
    'public.decide_approval(uuid, boolean, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists aprobaciones_files_insert on storage.objects;
    create policy aprobaciones_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'evidences' and public.can_upload_approval_file(name));
    drop policy if exists aprobaciones_files_read on storage.objects;
    create policy aprobaciones_files_read on storage.objects for select to authenticated
      using (bucket_id = 'evidences' and public.can_read_approval_file(name));
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table event_approvals; exception when duplicate_object then null; end;
  end if;
end $$;
