-- MANDO · Brief procesado por la IA (decisión 89).
--
-- 1. Documentos complementarios del brief: noticias, notas policiales, directivas municipales…
--    El backend los sube a <evento>/brief/ y la IA los lee al procesar. El equipo los puede abrir.
-- 2. Recomendaciones de la IA («posibles puntos ciegos»): cuando el backend pulsa «Continuar»,
--    la bitácora guarda que las leyó y las dejó pasar, con la lista completa.
--
-- Nada se edita ni se borra: los documentos se suman y las recomendaciones quedan en la bitácora.

alter type log_kind add value if not exists 'brief_recommendations_accepted';

-- ---------------------------------------------------------------------------
-- 1 · Documentos complementarios
-- ---------------------------------------------------------------------------

create table if not exists brief_documents (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  path        text not null unique,
  name        text not null check (length(trim(name)) between 1 and 200),
  uploaded_by uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists brief_documents_event_idx on brief_documents (event_id, created_at);

alter table brief_documents enable row level security;
-- Los lee el equipo del evento, igual que el brief. El cliente no.
drop policy if exists brief_documents_read on brief_documents;
create policy brief_documents_read on brief_documents for select to authenticated using (public.is_event_team(event_id));
-- Sin políticas de escritura: entran por add_brief_document.

grant select on brief_documents to authenticated;
grant all on brief_documents to service_role;

create or replace function public.add_brief_document(p_event uuid, p_path text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_path text := nullif(trim(coalesce(p_path, '')), '');
  v_name text := left(nullif(trim(coalesce(p_name, '')), ''), 200);
  v_id uuid;
begin
  perform public._require_team(p_event);
  if not public.is_event_backend(p_event) then
    raise exception 'Los documentos del brief los sube el backend.' using errcode = '42501';
  end if;
  if v_path is null or v_path not like p_event::text || '/brief/%' then
    raise exception 'El documento no pertenece a este evento.' using errcode = '22023';
  end if;
  if v_name is null then
    raise exception 'El documento necesita un nombre.' using errcode = '22023';
  end if;
  if (select count(*) from brief_documents where event_id = p_event) >= 20 then
    raise exception 'El brief ya tiene 20 documentos complementarios.' using errcode = '22023';
  end if;
  insert into brief_documents (event_id, path, name, uploaded_by)
  values (p_event, v_path, v_name, v_me)
  on conflict (path) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from brief_documents where path = v_path and event_id = p_event;
    return v_id;
  end if;
  perform public._log(p_event, 'brief_updated',
    format('%s sumó un documento complementario al brief: %s.', public._actor_name(v_me), v_name),
    1, 'brief_document', v_id, jsonb_build_object('name', v_name), false, v_me);
  return v_id;
end $$;

-- El archivo del brief lo lee el equipo: el documento principal o uno complementario.
create or replace function public.can_read_brief_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_event uuid;
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 2) <> 'brief' then
    return false;
  end if;
  v_event := split_part(p_name, '/', 1)::uuid;
  return public.is_event_team(v_event)
     and (exists (select 1 from event_briefs b where b.event_id = v_event and b.document_path = p_name)
          or exists (select 1 from brief_documents d where d.event_id = v_event and d.path = p_name));
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Recomendaciones de la IA leídas y aceptadas
-- ---------------------------------------------------------------------------

-- p_items: [{ "titulo": "...", "nivel": "alto|medio|bajo" }, ...] tal como la pantalla las mostró.
create or replace function public.accept_brief_recommendations(p_event uuid, p_items jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_count int;
  v_version int;
begin
  perform public._require_team(p_event);
  if not public.is_event_backend(p_event) then
    raise exception 'Las recomendaciones del brief las acepta el backend.' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Faltan las recomendaciones.' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count > 40 or length(p_items::text) > 20000 then
    raise exception 'Son demasiadas recomendaciones para guardar.' using errcode = '22023';
  end if;
  select version into v_version from event_briefs where event_id = p_event;
  return public._log(p_event, 'brief_recommendations_accepted',
    format('%s leyó %s recomendaciones de la IA sobre el brief y decidió continuar.', public._actor_name(v_me), v_count),
    1, 'brief', p_event, jsonb_build_object('version', v_version, 'items', p_items), false, v_me);
end $$;

revoke execute on function public.add_brief_document(uuid, text, text) from public, anon;
revoke execute on function public.accept_brief_recommendations(uuid, jsonb) from public, anon;
grant execute on function public.add_brief_document(uuid, text, text) to authenticated, service_role;
grant execute on function public.accept_brief_recommendations(uuid, jsonb) to authenticated, service_role;
