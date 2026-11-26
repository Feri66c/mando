-- Tiempos del timeline (decisión 34).
-- La productora estima cuánto toma cada actividad. La estimación no mueve la hoja de ruta:
-- el plan solo cambia con una solicitud de cambio. MANDO compara ambas y avisa lo que no cuadra.

alter table route_items
  add column if not exists estimated_minutes int check (estimated_minutes between 5 and 1440),
  add column if not exists estimated_by uuid references profiles(id),
  add column if not exists estimated_at timestamptz;

create or replace function public.set_estimate(p_item uuid, p_minutes int) returns void
language plpgsql security definer set search_path = public as $$
declare v route_items; v_me uuid := auth.uid(); v_status text;
begin
  select * into v from route_items where id = p_item for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._require_team(v.event_id);
  if public._my_level(v.event_id) > 2 then
    raise exception 'Los tiempos los estima el productor general o el productor de campo.' using errcode = '42501';
  end if;
  select status::text into v_status from events where id = v.event_id;
  if v_status = 'closed' then
    raise exception 'El evento ya cerró.' using errcode = '22023';
  end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 1440 then
    raise exception 'El tiempo va de 5 minutos a 24 horas.' using errcode = '22023';
  end if;
  if v.estimated_minutes is not distinct from p_minutes then
    return;
  end if;
  update route_items set estimated_minutes = p_minutes, estimated_by = v_me, estimated_at = now() where id = v.id;
  perform public._log(v.event_id, 'planning_updated',
    format('%s estimó %s min para «%s».', public._actor_name(v_me), p_minutes, v.title),
    1, 'route_item', v.id, jsonb_build_object('estimated_minutes', p_minutes), false, v_me);
end $$;

revoke execute on function public.set_estimate(uuid, int) from public, anon;
grant execute on function public.set_estimate(uuid, int) to authenticated;
