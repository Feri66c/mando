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
