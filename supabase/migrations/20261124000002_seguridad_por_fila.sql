-- MANDO · Migración 2 · Seguridad por fila (Row Level Security) — Fase 0.
--
-- Hace cumplir docs/04-roles-y-permisos.md en la base de datos:
--   * producer y backend leen todo su evento; viewer solo lo que tiene visible_to_viewer = true.
--   * viewer no escribe en ninguna tabla.
--   * route_items no se actualiza directo: los cambios entran por change_requests (Fase 1 agrega la función que los aplica).
--   * log_entries no acepta escrituras desde la app: solo funciones del servidor (security definer). Update/delete
--     ya están bloqueados por el trigger de la migración 1.
--   * quien no es miembro de un evento no ve nada de ese evento.
-- Todas las políticas son "to authenticated": un visitante sin sesión (anon) no lee ni escribe nada.

-- ---------------------------------------------------------------------------
-- Ajustes pequeños al esquema detectados al revisar el paquete
-- ---------------------------------------------------------------------------

-- Las reglas de criticidad hablan de "permiso obligatorio"; la tabla no lo distinguía.
alter table permits add column if not exists is_required boolean not null default true;

-- ---------------------------------------------------------------------------
-- Perfil automático al crear un usuario de Supabase Auth
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Evidencia con hora del servidor (regla 5): received_at siempre la pone la base de datos.
-- ---------------------------------------------------------------------------
create or replace function public.stamp_evidence_received_at() returns trigger
language plpgsql as $$
begin
  new.received_at := now();
  return new;
end $$;

drop trigger if exists evidences_server_time on evidences;
create trigger evidences_server_time before insert on evidences
  for each row execute function public.stamp_evidence_received_at();

-- ---------------------------------------------------------------------------
-- Ayudas de permisos. Son "security definer" para poder consultar event_members
-- sin entrar en un ciclo con sus propias políticas.
-- ---------------------------------------------------------------------------
create or replace function public.my_event_role(p_event uuid) returns event_role
language sql stable security definer set search_path = public as $$
  select role from event_members where event_id = p_event and profile_id = auth.uid()
$$;

create or replace function public.is_event_member(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_members where event_id = p_event and profile_id = auth.uid())
$$;

-- Equipo = producer o backend.
create or replace function public.is_event_team(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_event_role(p_event) in ('producer', 'backend'), false)
$$;

create or replace function public.is_event_backend(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_event_role(p_event) = 'backend', false)
$$;

-- Regla de lectura de todo lo que tiene visible_to_viewer.
create or replace function public.can_view(p_event uuid, p_visible boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.my_event_role(p_event)
    when 'producer' then true
    when 'backend'  then true
    when 'viewer'   then coalesce(p_visible, false)
    else false
  end
$$;

create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from organization_members where organization_id = p_org and profile_id = auth.uid())
$$;

create or replace function public.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from organization_members
                 where organization_id = p_org and profile_id = auth.uid() and is_admin)
$$;

-- Ve la organización quien es miembro o participa en alguno de sus eventos (solo el nombre).
create or replace function public.can_see_org(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_org_member(p_org)
      or exists (select 1 from events e join event_members m on m.event_id = e.id
                 where e.organization_id = p_org and m.profile_id = auth.uid())
$$;

-- Ve un perfil quien comparte un evento con esa persona. Un viewer no ve a otros viewers (los demás clientes).
create or replace function public.can_see_profile(p_profile uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_profile = auth.uid()
      or exists (select 1 from event_members me
                 join event_members them on them.event_id = me.event_id
                 where me.profile_id = auth.uid() and them.profile_id = p_profile
                   and (me.role <> 'viewer' or them.role <> 'viewer'))
$$;

-- Proveedor visible para el equipo de un evento que lo usa, o para los miembros de la organización.
create or replace function public.can_see_provider(p_provider uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_org_member(p_org)
      or exists (select 1 from event_providers ep
                 where ep.provider_id = p_provider and public.is_event_team(ep.event_id))
$$;

-- La función original de la migración 1 queda, pero ya no es pública: revelaba roles ajenos.
revoke execute on function public.event_role_of(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Activar RLS en todas las tablas
-- ---------------------------------------------------------------------------
alter table organizations        enable row level security;
alter table profiles             enable row level security;
alter table organization_members enable row level security;
alter table events               enable row level security;
alter table event_members        enable row level security;
alter table briefs               enable row level security;
alter table sources              enable row level security;
alter table areas                enable row level security;
alter table providers            enable row level security;
alter table event_providers      enable row level security;
alter table documents            enable row level security;
alter table permits              enable row level security;
alter table route_items          enable row level security;
alter table route_dependencies   enable row level security;
alter table change_requests      enable row level security;
alter table critical_moments     enable row level security;
alter table moment_checks        enable row level security;
alter table commitments          enable row level security;
alter table alerts               enable row level security;
alter table evidences            enable row level security;
alter table log_entries          enable row level security;

-- ---------------------------------------------------------------------------
-- Personas y organización
-- ---------------------------------------------------------------------------
create policy org_read on organizations for select to authenticated
  using (public.can_see_org(id));
create policy org_update on organizations for update to authenticated
  using (public.is_org_admin(id)) with check (public.is_org_admin(id));

create policy profile_read on profiles for select to authenticated
  using (public.can_see_profile(id));
create policy profile_insert_self on profiles for insert to authenticated
  with check (id = auth.uid());
create policy profile_update_self on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy org_members_read on organization_members for select to authenticated
  using (profile_id = auth.uid() or public.is_org_admin(organization_id));
create policy org_members_insert on organization_members for insert to authenticated
  with check (public.is_org_admin(organization_id));
create policy org_members_update on organization_members for update to authenticated
  using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy org_members_delete on organization_members for delete to authenticated
  using (public.is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- Evento y miembros
-- ---------------------------------------------------------------------------
create policy events_read on events for select to authenticated
  using (public.is_event_member(id));
-- Crear eventos: administradores de la organización (la pantalla llega en la Fase 3).
create policy events_insert on events for insert to authenticated
  with check (public.is_org_admin(organization_id) and created_by = auth.uid());
create policy events_update on events for update to authenticated
  using (public.is_event_backend(id)) with check (public.is_event_backend(id));

-- El equipo ve a todos; el viewer se ve a sí mismo y al equipo, nunca a otros clientes.
create policy event_members_read on event_members for select to authenticated
  using (
    public.is_event_team(event_id)
    or profile_id = auth.uid()
    or (public.is_event_member(event_id) and role <> 'viewer')
  );
create policy event_members_insert on event_members for insert to authenticated
  with check (public.is_event_backend(event_id));
create policy event_members_update on event_members for update to authenticated
  using (public.is_event_backend(event_id)) with check (public.is_event_backend(event_id));
create policy event_members_delete on event_members for delete to authenticated
  using (public.is_event_backend(event_id));

-- ---------------------------------------------------------------------------
-- Fuentes: solo el equipo
-- ---------------------------------------------------------------------------
create policy briefs_read on briefs for select to authenticated
  using (public.is_event_team(event_id));
create policy briefs_insert on briefs for insert to authenticated
  with check (public.is_event_team(event_id) and created_by = auth.uid());

create policy sources_read on sources for select to authenticated
  using (public.is_event_team(event_id));
create policy sources_write on sources for all to authenticated
  using (public.is_event_backend(event_id)) with check (public.is_event_backend(event_id));

-- ---------------------------------------------------------------------------
-- Operación
-- ---------------------------------------------------------------------------
-- Las áreas (Sonido, Sala...) las ve todo miembro: la hoja de ruta del cliente las muestra.
create policy areas_read on areas for select to authenticated
  using (public.is_event_member(event_id));
create policy areas_write on areas for all to authenticated
  using (public.is_event_backend(event_id)) with check (public.is_event_backend(event_id));

create policy providers_read on providers for select to authenticated
  using (public.can_see_provider(id, organization_id));
create policy providers_insert on providers for insert to authenticated
  with check (public.is_org_admin(organization_id));
create policy providers_update on providers for update to authenticated
  using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy event_providers_read on event_providers for select to authenticated
  using (public.is_event_team(event_id));
create policy event_providers_write on event_providers for all to authenticated
  using (public.is_event_backend(event_id)) with check (public.is_event_backend(event_id));

create policy documents_read on documents for select to authenticated
  using (public.can_view(event_id, visible_to_viewer));
create policy documents_insert on documents for insert to authenticated
  with check (public.is_event_backend(event_id) and uploaded_by = auth.uid());
create policy documents_update on documents for update to authenticated
  using (public.is_event_backend(event_id)) with check (public.is_event_backend(event_id));

create policy permits_read on permits for select to authenticated
  using (public.is_event_team(event_id));
create policy permits_write on permits for all to authenticated
  using (public.is_event_backend(event_id)) with check (public.is_event_backend(event_id));

-- ---------------------------------------------------------------------------
-- Hoja de ruta
-- ---------------------------------------------------------------------------
create policy route_items_read on route_items for select to authenticated
  using (public.can_view(event_id, visible_to_viewer));
-- Armar el borrador: el equipo inserta actividades. No hay política de update ni delete:
-- todo cambio pasa por change_requests (regla 3 del proyecto).
create policy route_items_insert on route_items for insert to authenticated
  with check (public.is_event_team(event_id));

-- Una dependencia se ve solo si se ven las dos actividades.
create policy route_deps_read on route_dependencies for select to authenticated
  using (
    exists (select 1 from route_items a where a.id = item_id)
    and exists (select 1 from route_items b where b.id = depends_on_id)
  );
create policy route_deps_insert on route_dependencies for insert to authenticated
  with check (
    exists (select 1 from route_items a join route_items b on b.event_id = a.event_id
            where a.id = item_id and b.id = depends_on_id and public.is_event_team(a.event_id))
  );

create policy change_requests_read on change_requests for select to authenticated
  using (public.is_event_team(event_id));
create policy change_requests_insert on change_requests for insert to authenticated
  with check (public.is_event_team(event_id) and requested_by = auth.uid() and applied_at is null);

-- ---------------------------------------------------------------------------
-- Momentos críticos, preguntas y compromisos: solo el equipo
-- ---------------------------------------------------------------------------
create policy moments_read on critical_moments for select to authenticated
  using (public.is_event_team(event_id));
create policy moments_insert on critical_moments for insert to authenticated
  with check (public.is_event_team(event_id));
create policy moments_update on critical_moments for update to authenticated
  using (public.is_event_team(event_id)) with check (public.is_event_team(event_id));

create policy checks_read on moment_checks for select to authenticated
  using (exists (select 1 from critical_moments m where m.id = moment_id and public.is_event_team(m.event_id)));
create policy checks_insert on moment_checks for insert to authenticated
  with check (exists (select 1 from critical_moments m where m.id = moment_id and public.is_event_team(m.event_id)));
create policy checks_update on moment_checks for update to authenticated
  using (exists (select 1 from critical_moments m where m.id = moment_id and public.is_event_team(m.event_id)))
  with check (exists (select 1 from critical_moments m where m.id = moment_id and public.is_event_team(m.event_id)));

create policy commitments_read on commitments for select to authenticated
  using (public.is_event_team(event_id));
create policy commitments_insert on commitments for insert to authenticated
  with check (public.is_event_team(event_id));
create policy commitments_update on commitments for update to authenticated
  using (public.is_event_team(event_id)) with check (public.is_event_team(event_id));

-- ---------------------------------------------------------------------------
-- Alertas
-- ---------------------------------------------------------------------------
create policy alerts_read on alerts for select to authenticated
  using (public.can_view(event_id, visible_to_viewer));
create policy alerts_insert on alerts for insert to authenticated
  with check (public.is_event_team(event_id));
create policy alerts_update on alerts for update to authenticated
  using (public.is_event_team(event_id)) with check (public.is_event_team(event_id));

-- ---------------------------------------------------------------------------
-- Evidencias: se agregan, no se editan ni se borran desde la app
-- ---------------------------------------------------------------------------
create policy evidences_read on evidences for select to authenticated
  using (public.can_view(event_id, visible_to_viewer));
create policy evidences_insert on evidences for insert to authenticated
  with check (public.is_event_team(event_id) and captured_by = auth.uid());

-- ---------------------------------------------------------------------------
-- Bitácora: solo lectura desde la app
-- ---------------------------------------------------------------------------
create policy log_read on log_entries for select to authenticated
  using (public.can_view(event_id, visible_to_viewer));
-- Doble candado: además de no tener políticas de escritura, se quitan los privilegios.
revoke insert, update, delete, truncate on log_entries from anon, authenticated;

-- TRUNCATE no pasa por RLS: nadie desde la app puede vaciar tablas.
revoke truncate on all tables in schema public from anon, authenticated;
