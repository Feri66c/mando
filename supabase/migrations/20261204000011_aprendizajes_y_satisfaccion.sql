-- Encuesta de cierre (decisión 36): aprendizajes del equipo y ficha de satisfacción del cliente.

alter type log_kind add value if not exists 'feedback_shared';

create table if not exists event_feedback (
  event_id    uuid not null references events(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  kind        text not null check (kind in ('learnings', 'satisfaction')),
  stars       smallint check (stars between 1 and 5),
  items       text[] not null default '{}' check (coalesce(array_length(items, 1), 0) <= 10),
  extra       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (event_id, profile_id),
  check (kind <> 'satisfaction' or stars is not null)
);

-- ¿Puede leer lo que dejaron los demás? Solo el productor general y el productor de campo.
create or replace function public.can_read_feedback(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from event_members
    where event_id = p_event and profile_id = auth.uid() and role <> 'viewer' and level is not null and level <= 2
  );
$$;

alter table event_feedback enable row level security;
-- Cada persona ve lo suyo; los niveles 1 y 2 ven todo. Se escribe solo con las funciones de abajo.
drop policy if exists event_feedback_read on event_feedback;
create policy event_feedback_read on event_feedback for select to authenticated
  using (profile_id = auth.uid() or public.can_read_feedback(event_id));

create or replace function public.save_learnings(p_event uuid, p_items text[], p_extra text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_items text[];
  v_extra text := nullif(trim(coalesce(p_extra, '')), '');
  v_new boolean;
begin
  if v_me is null or not public.is_event_team(p_event) then
    raise exception 'Los aprendizajes los deja el equipo del evento.' using errcode = '42501';
  end if;
  select coalesce(array_agg(left(trim(x), 300) order by ord), '{}') into v_items
    from unnest(coalesce(p_items, '{}')) with ordinality as t(x, ord)
    where trim(coalesce(x, '')) <> '';
  if coalesce(array_length(v_items, 1), 0) > 6 then
    raise exception 'Son hasta 6 aprendizajes.' using errcode = '22023';
  end if;
  if coalesce(array_length(v_items, 1), 0) = 0 and v_extra is null then
    raise exception 'Escribe al menos un aprendizaje.' using errcode = '22023';
  end if;

  insert into event_feedback (event_id, profile_id, kind, items, extra)
  values (p_event, v_me, 'learnings', v_items, left(v_extra, 1000))
  on conflict (event_id, profile_id) do update
    set kind = 'learnings', items = excluded.items, extra = excluded.extra, stars = null, updated_at = now()
  returning (xmax = 0) into v_new;

  -- En la bitácora queda que los compartió, no qué escribió.
  perform public._log(p_event, 'feedback_shared',
    format('%s %s sus aprendizajes.', public._actor_name(v_me), case when v_new then 'compartió' else 'actualizó' end),
    1, 'event', p_event, '{}'::jsonb, false, v_me);
end $$;

create or replace function public.save_satisfaction(p_event uuid, p_stars int, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_new boolean;
begin
  if v_me is null or not exists (select 1 from event_members where event_id = p_event and profile_id = v_me and role = 'viewer') then
    raise exception 'La ficha de satisfacción la llena el cliente.' using errcode = '42501';
  end if;
  if p_stars is null or p_stars not between 1 and 5 then
    raise exception 'La satisfacción va de 1 a 5.' using errcode = '22023';
  end if;

  insert into event_feedback (event_id, profile_id, kind, stars, extra)
  values (p_event, v_me, 'satisfaction', p_stars, left(nullif(trim(coalesce(p_comment, '')), ''), 1000))
  on conflict (event_id, profile_id) do update
    set kind = 'satisfaction', stars = excluded.stars, extra = excluded.extra, updated_at = now()
  returning (xmax = 0) into v_new;

  perform public._log(p_event, 'feedback_shared',
    format('%s %s su ficha de satisfacción.', public._actor_name(v_me), case when v_new then 'dejó' else 'actualizó' end),
    1, 'event', p_event, '{}'::jsonb, true, v_me);
end $$;

-- Lo que dejó cada persona, con su nombre, para el productor general y el productor de campo.
create or replace function public.event_feedback_board(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_read_feedback(p_event) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', coalesce(p.full_name, 'Sin nombre'), 'title', m.title, 'kind', f.kind,
      'stars', f.stars, 'items', to_jsonb(f.items), 'extra', f.extra, 'updated_at', f.updated_at
    ) order by f.kind desc, f.updated_at)
    from event_feedback f
    join profiles p on p.id = f.profile_id
    left join event_members m on m.event_id = f.event_id and m.profile_id = f.profile_id
    where f.event_id = p_event
  ), '[]'::jsonb);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.can_read_feedback(uuid)', 'public.save_learnings(uuid, text[], text)',
    'public.save_satisfaction(uuid, int, text)', 'public.event_feedback_board(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
