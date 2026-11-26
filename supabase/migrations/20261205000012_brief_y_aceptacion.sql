-- MANDO · Aceptación del cargo y brief del evento (decisiones 40 y 41).
--
-- 1. La persona convocada ACEPTA su cargo antes de entrar al evento.
-- 2. El backend carga el brief (el guion del evento). Cada persona del equipo lo lee y responde
--    «estoy enterado», o deja una duda. Con una duda abierta no avanza: la duda llega al backend
--    como alerta y solo el backend la responde, confirmando o corrigiendo el brief.
-- 3. Sin brief leído no se toma el mando.
--
-- Todo queda en la bitácora. Nada se edita ni se borra: las dudas se responden, el brief se versiona.

alter type log_kind add value if not exists 'role_accepted';
alter type log_kind add value if not exists 'brief_updated';
alter type log_kind add value if not exists 'brief_acknowledged';
alter type log_kind add value if not exists 'brief_doubt';

-- ---------------------------------------------------------------------------
-- 1 · Aceptación del cargo
-- ---------------------------------------------------------------------------

alter table event_members add column if not exists accepted_at timestamptz;
-- Quien ya había tomado el mando antes de esta regla, ya aceptó.
update event_members set accepted_at = welcomed_at where accepted_at is null and welcomed_at is not null;

create or replace function public.accept_role(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_members;
begin
  select * into v from event_members where event_id = p_event and profile_id = v_me for update;
  if not found then
    raise exception 'No eres parte de este evento.' using errcode = '42501';
  end if;
  if v.accepted_at is not null then
    return;
  end if;
  update event_members set accepted_at = now() where event_id = p_event and profile_id = v_me;
  perform public._log(p_event, 'role_accepted',
    format('%s aceptó su cargo%s.', public._actor_name(v_me), coalesce(' de ' || v.title, '')),
    1, 'member', v_me, jsonb_build_object('role', v.role), false, v_me);
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Brief del evento
-- ---------------------------------------------------------------------------

create table if not exists event_briefs (
  event_id   uuid primary key references events(id) on delete cascade,
  version    int  not null default 1 check (version >= 1),
  summary    text not null check (length(trim(summary)) between 1 and 4000),
  objective  text check (objective is null or length(objective) <= 1000),
  attendees  text check (attendees is null or length(attendees) <= 200),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists brief_acks (
  event_id   uuid not null references events(id) on delete cascade,
  profile_id uuid not null references profiles(id),
  version    int  not null,
  acked_at   timestamptz not null default now(),
  primary key (event_id, profile_id, version)
);

create table if not exists brief_doubts (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  profile_id  uuid not null references profiles(id),
  version     int  not null,
  question    text not null check (length(trim(question)) between 1 and 1000),
  status      text not null default 'open' check (status in ('open', 'answered')),
  answer      text check (answer is null or length(answer) <= 1000),
  corrected   boolean not null default false,   -- el backend corrigió el brief al responder
  answered_by uuid references profiles(id),
  answered_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists brief_doubts_event_idx on brief_doubts (event_id, status);

alter table event_briefs enable row level security;
alter table brief_acks   enable row level security;
alter table brief_doubts enable row level security;

-- El brief lo lee el equipo. El cliente no: su vista es aparte.
drop policy if exists event_briefs_read on event_briefs;
create policy event_briefs_read on event_briefs for select to authenticated using (public.is_event_team(event_id));
-- Cada quien ve su propio «enterado» y sus dudas; el backend ve los de todo el evento.
drop policy if exists brief_acks_read on brief_acks;
create policy brief_acks_read on brief_acks for select to authenticated
  using (profile_id = auth.uid() or public.is_event_backend(event_id));
drop policy if exists brief_doubts_read on brief_doubts;
create policy brief_doubts_read on brief_doubts for select to authenticated
  using (profile_id = auth.uid() or public.is_event_backend(event_id));
-- Sin políticas de escritura: todo entra por las funciones de abajo.

-- El backend carga o corrige el brief. Cada cambio sube la versión y hay que volver a leerlo.
create or replace function public.set_brief(
  p_event uuid, p_summary text, p_objective text default null, p_attendees text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_summary text := nullif(trim(coalesce(p_summary, '')), '');
  v_version int;
begin
  perform public._require_team(p_event);
  if not public.is_event_backend(p_event) then
    raise exception 'El brief lo carga el backend.' using errcode = '42501';
  end if;
  if v_summary is null then
    raise exception 'Escribe el brief del evento.' using errcode = '22023';
  end if;
  insert into event_briefs (event_id, summary, objective, attendees, updated_by)
  values (p_event, v_summary, nullif(trim(coalesce(p_objective, '')), ''), nullif(trim(coalesce(p_attendees, '')), ''), v_me)
  on conflict (event_id) do update
    set version = event_briefs.version + 1, summary = excluded.summary, objective = excluded.objective,
        attendees = excluded.attendees, updated_by = v_me, updated_at = now()
  returning version into v_version;
  perform public._log(p_event, 'brief_updated',
    format('%s %s el brief (versión %s).', public._actor_name(v_me),
           case when v_version = 1 then 'cargó' else 'corrigió' end, v_version),
    1, 'brief', p_event, jsonb_build_object('version', v_version), false, v_me);
  return v_version;
end $$;

-- «Estoy enterado del brief». No se puede con una duda propia sin responder.
create or replace function public.ack_brief(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_version int;
begin
  perform public._require_team(p_event);
  select version into v_version from event_briefs where event_id = p_event;
  if v_version is null then
    raise exception 'El backend todavía no carga el brief.' using errcode = '22023';
  end if;
  if exists (select 1 from brief_doubts where event_id = p_event and profile_id = v_me and status = 'open') then
    raise exception 'Tienes una duda sin responder. Espera la confirmación del backend.' using errcode = '42501';
  end if;
  insert into brief_acks (event_id, profile_id, version) values (p_event, v_me, v_version)
  on conflict do nothing;
  if found then
    perform public._log(p_event, 'brief_acknowledged',
      format('%s confirmó que está enterado del brief (versión %s).', public._actor_name(v_me), v_version),
      1, 'brief', p_event, jsonb_build_object('version', v_version), false, v_me);
  end if;
end $$;

-- Una duda sobre el brief: llega al backend como alerta y la persona no avanza hasta la respuesta.
create or replace function public.raise_brief_doubt(p_event uuid, p_question text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_q text := nullif(trim(coalesce(p_question, '')), '');
  v_version int;
  v_id uuid;
begin
  perform public._require_team(p_event);
  select version into v_version from event_briefs where event_id = p_event;
  if v_version is null then
    raise exception 'El backend todavía no carga el brief.' using errcode = '22023';
  end if;
  if v_q is null then
    raise exception 'Cuenta qué no coincide con lo que sabías.' using errcode = '22023';
  end if;
  if exists (select 1 from brief_doubts where event_id = p_event and profile_id = v_me and status = 'open') then
    raise exception 'Ya tienes una duda esperando respuesta.' using errcode = '22023';
  end if;
  insert into brief_doubts (event_id, profile_id, version, question) values (p_event, v_me, v_version, v_q)
  returning id into v_id;
  perform public._log(p_event, 'brief_doubt',
    format('%s dejó una duda sobre el brief: %s', public._actor_name(v_me), v_q),
    2, 'brief_doubt', v_id, jsonb_build_object('version', v_version), false, v_me);
  perform public._raise_alert(p_event, 2, 'brief_doubt',
    format('Duda sobre el brief de %s', public._actor_name(v_me)), v_q, 'brief_doubt', v_id, v_me);
  return v_id;
end $$;

-- El backend responde la duda. Si hace falta corregir el brief, primero lo corrige con set_brief.
create or replace function public.answer_brief_doubt(p_doubt uuid, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v brief_doubts;
  v_a text := nullif(trim(coalesce(p_answer, '')), '');
  v_version int;
begin
  select * into v from brief_doubts where id = p_doubt for update;
  if not found or v_me is null or not public.is_event_backend(v.event_id) then
    raise exception 'Las dudas del brief las responde el backend.' using errcode = '42501';
  end if;
  perform public._require_team(v.event_id);
  if v.status <> 'open' then
    raise exception 'Esa duda ya fue respondida.' using errcode = '22023';
  end if;
  if v_a is null then
    raise exception 'Escribe la respuesta.' using errcode = '22023';
  end if;
  select version into v_version from event_briefs where event_id = v.event_id;
  update brief_doubts
     set status = 'answered', answer = v_a, corrected = coalesce(v_version, v.version) > v.version,
         answered_by = v_me, answered_at = now()
   where id = v.id;
  update alerts set status = 'resolved', resolved_at = now(), resolved_by = v_me
   where event_id = v.event_id and rule_key = 'brief_doubt' and entity_id = v.id and status <> 'resolved';
  perform public._log(v.event_id, 'brief_doubt',
    format('%s respondió la duda de %s sobre el brief: %s', public._actor_name(v_me), public._actor_name(v.profile_id), v_a),
    1, 'brief_doubt', v.id, jsonb_build_object('corrected', coalesce(v_version, v.version) > v.version), false, v_me);
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Sin cargo aceptado y brief leído no se toma el mando
-- ---------------------------------------------------------------------------

create or replace function public.mark_welcomed(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_members;
  v_version int;
begin
  select * into v from event_members where event_id = p_event and profile_id = v_me for update;
  if not found then
    raise exception 'No eres parte de este evento.' using errcode = '42501';
  end if;
  if v.welcomed_at is not null then
    return;
  end if;
  if v.role <> 'viewer' then
    select version into v_version from event_briefs where event_id = p_event;
    if v_version is not null and not exists (
      select 1 from brief_acks where event_id = p_event and profile_id = v_me and version = v_version
    ) then
      raise exception 'Primero confirma que estás enterado del brief.' using errcode = '42501';
    end if;
  end if;
  update event_members set welcomed_at = now(), accepted_at = coalesce(accepted_at, now())
   where event_id = p_event and profile_id = v_me;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Permisos de ejecución
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'public.accept_role(uuid)',
    'public.set_brief(uuid, text, text, text)',
    'public.ack_brief(uuid)',
    'public.raise_brief_doubt(uuid, text)',
    'public.answer_brief_doubt(uuid, text)',
    'public.mark_welcomed(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
