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
