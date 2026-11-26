-- MANDO · Backend y MANDO Express (decisiones 46 a 48).
--
-- En MANDO hay dos lados: el productor y el backend. El cliente sale a MANDO Express, donde solo
-- le llegan sus avisos: «Todo OK» (lo decide el sistema según el avance), «Observación»
-- (lo que impide completar) y «Sin confirmación». Las ocurrencias internas se quedan en la bitácora.
--
-- El backend también manda instrucciones al productor: le llegan como aviso y quedan en la bitácora.

alter type log_kind add value if not exists 'instruction_sent';
alter type log_kind add value if not exists 'client_notice';

create table if not exists client_notices (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id) on delete cascade,
  kind       text not null check (kind in ('ok', 'observation', 'unconfirmed')),
  body       text not null check (length(trim(body)) between 1 and 500),
  source     text not null default 'backend' check (source in ('system', 'backend')),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists client_notices_event_idx on client_notices (event_id, created_at desc);

alter table client_notices enable row level security;
-- Los lee el cliente del evento y el equipo. Nadie los escribe directo ni los cambia: solo se agregan.
drop policy if exists client_notices_read on client_notices;
create policy client_notices_read on client_notices for select to authenticated using (public.is_event_member(event_id));

-- Aviso del sistema: «Todo OK». No se repite el mismo texto en el mismo evento.
create or replace function public._system_notice(p_event uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from client_notices where event_id = p_event and source = 'system' and body = p_body) then
    return;
  end if;
  insert into client_notices (event_id, kind, body, source) values (p_event, 'ok', p_body, 'system');
  perform public._log(p_event, 'client_notice', format('Sistema avisó al cliente (todo OK): %s', p_body),
    1, 'event', p_event, jsonb_build_object('kind', 'ok', 'source', 'system'), false, null);
end $$;

-- Aviso del backend al cliente. «Todo OK» también puede salir de aquí, pero lo normal es que lo marque el sistema.
create or replace function public.send_client_notice(p_event uuid, p_kind text, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_body text := nullif(trim(coalesce(p_body, '')), ''); v_id uuid;
begin
  perform public._require_team(p_event);
  if not public.is_event_backend(p_event) then
    raise exception 'Al cliente le informa el backend.' using errcode = '42501';
  end if;
  if p_kind not in ('ok', 'observation', 'unconfirmed') then
    raise exception 'Tipo de aviso desconocido.' using errcode = '22023';
  end if;
  if v_body is null then
    raise exception 'Escribe el aviso.' using errcode = '22023';
  end if;
  insert into client_notices (event_id, kind, body, source, created_by) values (p_event, p_kind, v_body, 'backend', v_me)
  returning id into v_id;
  perform public._log(p_event, 'client_notice',
    format('%s informó al cliente (%s): %s', public._actor_name(v_me),
           case p_kind when 'ok' then 'todo OK' when 'observation' then 'observación' else 'sin confirmación' end, v_body),
    1, 'client_notice', v_id, jsonb_build_object('kind', p_kind), false, v_me);
  return v_id;
end $$;

-- Instrucción del backend al productor.
create or replace function public.send_instruction(p_event uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_body text := nullif(trim(coalesce(p_body, '')), ''); v_id uuid;
begin
  perform public._require_team(p_event);
  if not public.is_event_backend(p_event) then
    raise exception 'Las instrucciones las da el backend.' using errcode = '42501';
  end if;
  if v_body is null or length(v_body) > 500 then
    raise exception 'Escribe la instrucción (hasta 500 letras).' using errcode = '22023';
  end if;
  v_id := public._raise_alert(p_event, 1, null, 'Instrucción del backend', v_body, 'event', p_event, v_me);
  perform public._log(p_event, 'instruction_sent',
    format('%s dio una instrucción al productor: %s', public._actor_name(v_me), v_body),
    1, 'alert', v_id, '{}'::jsonb, false, v_me);
  return v_id;
end $$;

-- El sistema marca «Todo OK» cuando se cumple una actividad que el cliente puede ver.
create or replace function public._route_items_notice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and old.status is distinct from new.status and (new.is_milestone or new.visible_to_viewer) then
    perform public._system_notice(new.event_id, format('Se cumplió «%s».', new.title));
  end if;
  return new;
end $$;
drop trigger if exists route_items_notice on route_items;
create trigger route_items_notice after update of status on route_items
  for each row execute function public._route_items_notice();

-- Y cuando el cliente termina de aprobar: todo aprobado y, si ya no falta nada, planificación completa.
create or replace function public._approvals_notice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from new.status and public._approvals_missing(new.event_id) is null then
    perform public._system_notice(new.event_id, 'Aprobaste todo. El evento puede arrancar.');
    if not exists (select 1 from jsonb_array_elements(public._planning_status(new.event_id)) e where not (e ->> 'ready')::boolean) then
      perform public._system_notice(new.event_id, 'Planificación completa. El evento quedó desbloqueado.');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists event_approvals_notice on event_approvals;
create trigger event_approvals_notice after update of status on event_approvals
  for each row execute function public._approvals_notice();

revoke execute on function public._system_notice(uuid, text) from public, anon, authenticated;
revoke execute on function public._route_items_notice() from public, anon, authenticated;
revoke execute on function public._approvals_notice() from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array['public.send_client_notice(uuid, text, text)', 'public.send_instruction(uuid, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
