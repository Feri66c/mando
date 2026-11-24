-- MANDO · instalación completa para un proyecto de Supabase NUEVO y vacío.
-- Archivo generado con `npm run db:bundle`. No lo edites a mano: edita las migraciones o el seed.
-- Pégalo entero en Supabase → SQL Editor → New query → Run.

-- ===================== 20261124000001_esquema_inicial.sql =====================
-- MANDO · Migración 1 · Esquema inicial.
-- Copia fiel de db/schema.sql del paquete de diseño (24-11-2026). No editar aquí: los cambios van en migraciones nuevas.

-- MANDO · Event Control — esquema inicial (PostgreSQL 15+)
-- Propuesta de arranque. Código en inglés; textos visibles en español viven en la app.
-- Las políticas de Row Level Security se detallan en docs/04-roles-y-permisos.md.

create extension if not exists "pgcrypto";

-- ---------- Tipos ----------
create type event_role       as enum ('viewer', 'producer', 'backend');
create type event_status     as enum ('draft', 'planned', 'live', 'closed');
create type item_status      as enum ('pending', 'in_progress', 'done', 'at_risk', 'moved', 'cancelled');
create type change_kind      as enum ('extend', 'move', 'reassign', 'set_status', 'add_item', 'cancel_item', 'edit');
create type input_channel    as enum ('voice', 'text', 'tap', 'system');
create type source_kind      as enum ('brief', 'crm', 'calendar', 'email', 'files', 'messaging', 'document');
create type source_status    as enum ('pending', 'connected', 'error');
create type document_kind    as enum ('rider', 'quote', 'contract', 'permit', 'letter', 'insurance', 'safety', 'other');
create type moment_status    as enum ('scheduled', 'open', 'resolved', 'escalated');
create type alert_status     as enum ('open', 'acknowledged', 'resolved');
create type evidence_kind    as enum ('photo', 'audio', 'video', 'document', 'note');
create type permit_status    as enum ('not_started', 'requested', 'approved', 'rejected', 'expired');
create type log_kind         as enum (
  'event_created', 'brief_added', 'source_connected', 'route_published',
  'change_applied', 'status_changed', 'moment_opened', 'check_answered',
  'commitment_checked', 'evidence_added', 'alert_raised', 'alert_resolved',
  'provider_contacted', 'permit_updated', 'note', 'correction', 'event_closed'
);

-- ---------- Organización y personas ----------
create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table profiles (                      -- 1 a 1 con el usuario de autenticación
  id          uuid primary key,              -- = auth.users.id
  full_name   text not null,
  phone       text,
  created_at  timestamptz not null default now()
);

create table organization_members (
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_id      uuid not null references profiles(id) on delete cascade,
  is_admin        boolean not null default false,
  primary key (organization_id, profile_id)
);

-- ---------- Evento ----------
create table events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name            text not null,
  event_type      text,                       -- convención, lanzamiento, concierto, activación...
  client_name     text,
  venue_name      text,
  venue_address   text,
  timezone        text not null default 'America/Lima',
  starts_at       timestamptz,
  ends_at         timestamptz,
  status          event_status not null default 'draft',
  criticality_config jsonb not null default '{}'::jsonb,  -- copia de config/criticidad.json al crear
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now()
);

create table event_members (
  event_id    uuid not null references events(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  role        event_role not null,
  title       text,                           -- "Productor general", "Jefe de sonido"...
  invited_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  primary key (event_id, profile_id)
);

-- ---------- Fuentes ----------
create table briefs (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  body        text,                           -- texto escrito o transcripción
  audio_path  text,                           -- ruta en almacenamiento si se grabó
  channel     input_channel not null default 'text',
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now()
);

create table sources (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  kind        source_kind not null,
  label       text not null,                  -- "CRM", "Calendario de producción"...
  status      source_status not null default 'pending',
  config      jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------- Operación ----------
create table areas (                          -- sonido, luces, estructuras, logística, transporte, permisos, seguridad...
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  name        text not null,
  sort_order  int not null default 0
);

create table providers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name            text not null,
  service         text,                       -- "Sonido y luces", "Transporte"...
  contact_name    text,
  phone           text,
  email           text,
  notes           text
);

create table event_providers (
  event_id    uuid not null references events(id) on delete cascade,
  provider_id uuid not null references providers(id),
  area_id     uuid references areas(id),
  primary key (event_id, provider_id)
);

create table documents (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  kind        document_kind not null,
  title       text not null,
  file_path   text not null,
  provider_id uuid references providers(id),
  extracted   jsonb,                          -- datos leídos del documento (fase posterior)
  visible_to_viewer boolean not null default false,
  uploaded_by uuid references profiles(id),
  created_at  timestamptz not null default now()
);

create table permits (                        -- permisos municipales, cartas, seguros, seguridad
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  title       text not null,                  -- "Licencia municipal de evento", "Carta a serenazgo"...
  authority   text,                           -- ante quién se tramita
  status      permit_status not null default 'not_started',
  due_at      timestamptz,
  document_id uuid references documents(id),
  owner_id    uuid references profiles(id),
  notes       text,
  updated_at  timestamptz not null default now()
);

-- ---------- Hoja de ruta ----------
create table route_items (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  title         text not null,
  area_id       uuid references areas(id),
  provider_id   uuid references providers(id),
  owner_id      uuid references profiles(id),          -- responsable
  planned_start timestamptz not null,                  -- plan publicado (no cambia)
  planned_end   timestamptz not null,
  current_start timestamptz not null,                  -- plan vigente (cambia con los cambios)
  current_end   timestamptz not null,
  actual_start  timestamptz,
  actual_end    timestamptz,
  status        item_status not null default 'pending',
  is_milestone  boolean not null default false,        -- apertura de puertas, inicio de show
  visible_to_viewer boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  check (planned_end >= planned_start),
  check (current_end >= current_start)
);
create index on route_items (event_id, current_start);

create table route_dependencies (              -- B depende de A: si A se mueve, B se recalcula
  item_id       uuid not null references route_items(id) on delete cascade,
  depends_on_id uuid not null references route_items(id) on delete cascade,
  lag_minutes   int not null default 0,
  primary key (item_id, depends_on_id),
  check (item_id <> depends_on_id)
);

create table change_requests (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  item_id       uuid references route_items(id),
  kind          change_kind not null,
  channel       input_channel not null,
  raw_input     text,                           -- lo que dijo o escribió el productor
  delta_minutes int,
  payload       jsonb not null default '{}'::jsonb,   -- valores nuevos según el tipo
  reason        text,
  affected      jsonb,                          -- actividades recalculadas: [{item_id, old_start, new_start}]
  requested_by  uuid not null references profiles(id),
  requested_at  timestamptz not null default now(),
  applied_at    timestamptz
);

-- ---------- Momentos críticos ----------
create table critical_moments (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  route_item_id uuid references route_items(id),
  template_key  text,                           -- config/plantillas-momentos.json
  title         text not null,
  level         smallint not null default 1 check (level between 1 and 4),
  status        moment_status not null default 'scheduled',
  opened_by     uuid references profiles(id),
  opened_at     timestamptz,
  resolved_at   timestamptz,
  resolution    text
);

create table moment_checks (                    -- preguntas guiadas y sus respuestas
  id          uuid primary key default gen_random_uuid(),
  moment_id   uuid not null references critical_moments(id) on delete cascade,
  question    text not null,
  answer_text text,
  answer_audio_path text,
  answered_by uuid references profiles(id),
  answered_at timestamptz,
  sort_order  int not null default 0
);

create table commitments (                      -- prometido vs. encontrado
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  moment_id     uuid references critical_moments(id),
  document_id   uuid references documents(id),  -- de dónde sale la promesa (rider, cotización)
  provider_id   uuid references providers(id),
  item_label    text not null,                  -- "Consola"
  promised      text not null,                  -- "32 canales"
  found         text,                           -- "24 canales"
  matches       boolean,                        -- null = sin verificar
  checked_by    uuid references profiles(id),
  checked_at    timestamptz
);

-- ---------- Alertas ----------
create table alerts (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  level         smallint not null check (level between 1 and 4),
  rule_key      text,                           -- regla que la generó; null si fue manual
  title         text not null,
  detail        text,
  entity_type   text,                           -- 'route_item' | 'critical_moment' | 'permit' | 'commitment'
  entity_id     uuid,
  status        alert_status not null default 'open',
  visible_to_viewer boolean not null default false,
  raised_by     uuid references profiles(id),   -- null = sistema
  raised_at     timestamptz not null default now(),
  resolved_by   uuid references profiles(id),
  resolved_at   timestamptz
);
create index on alerts (event_id, status, level desc);

-- ---------- Evidencias ----------
create table evidences (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  kind          evidence_kind not null,
  file_path     text,                           -- null si es nota
  note          text,
  sha256        text,
  moment_id     uuid references critical_moments(id),
  route_item_id uuid references route_items(id),
  alert_id      uuid references alerts(id),
  captured_at   timestamptz not null,           -- hora del dispositivo
  received_at   timestamptz not null default now(),  -- hora del servidor
  captured_by   uuid not null references profiles(id),
  visible_to_viewer boolean not null default true
);

-- ---------- Bitácora (solo crece) ----------
create table log_entries (
  id            bigint generated always as identity primary key,
  event_id      uuid not null references events(id) on delete cascade,
  at            timestamptz not null default now(),
  actor_id      uuid references profiles(id),   -- null = sistema
  kind          log_kind not null,
  level         smallint check (level between 1 and 4),
  summary       text not null,                  -- frase legible en español: "Productor movió Apertura de puertas a 19:30"
  entity_type   text,
  entity_id     uuid,
  payload       jsonb not null default '{}'::jsonb,
  corrects_id   bigint references log_entries(id),   -- si es una corrección de otra entrada
  visible_to_viewer boolean not null default true
);
create index on log_entries (event_id, at);

create or replace function forbid_log_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'La bitácora no se edita ni se borra. Registra una corrección.';
end $$;

create trigger log_entries_no_update before update or delete on log_entries
  for each row execute function forbid_log_mutation();

-- ---------- Ayudas de permisos ----------
create or replace function event_role_of(p_event uuid, p_profile uuid) returns event_role
language sql stable as $$
  select role from event_members where event_id = p_event and profile_id = p_profile
$$;

-- Row Level Security: activar en todas las tablas con event_id y definir políticas
-- según docs/04-roles-y-permisos.md. Ejemplo para la bitácora:
alter table log_entries enable row level security;

-- create policy log_read on log_entries for select using (
--   event_role_of(event_id, auth.uid()) in ('producer', 'backend')
--   or (event_role_of(event_id, auth.uid()) = 'viewer' and visible_to_viewer)
-- );
-- create policy log_insert on log_entries for insert with check (
--   event_role_of(event_id, auth.uid()) in ('producer', 'backend')
-- );


-- ===================== 20261124000002_seguridad_por_fila.sql =====================
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


-- ===================== seed.sql (datos de ejemplo) =====================
-- MANDO · datos de ejemplo para DESARROLLO. Todo es ficticio (regla 9: no usar en producción con clientes reales).
-- Basado en db/seed.sql del paquete de diseño, con tres agregados para que la Fase 0 funcione en Supabase:
--   1. Crea los tres usuarios de prueba en auth.users (antes había que crearlos a mano).
--   2. Agrega al productor y a la torre de control como miembros de la organización.
--   3. Copia config/criticidad.json en events.criticality_config (supuesto: esa es la escala vigente).
--
-- Usuarios de prueba (contraseña de los tres: MandoPrueba2026). Cámbiala o borra estos usuarios
-- antes de dar acceso a personas reales.
--   productor@mando.test  → Productor
--   torre@mando.test      → Backend (torre de control)
--   cliente@mando.test    → Viewer (cliente)


insert into organizations (id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Productora de ejemplo')
on conflict (id) do nothing;

-- 1 · Usuarios de inicio de sesión. Un trigger crea su fila en profiles con full_name.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated',
   'productor@mando.test', extensions.crypt('MandoPrueba2026', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Productor de ejemplo"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated',
   'torre@mando.test', extensions.crypt('MandoPrueba2026', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Torre de control de ejemplo"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a3', 'authenticated', 'authenticated',
   'cliente@mando.test', extensions.crypt('MandoPrueba2026', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Cliente de ejemplo"}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1',
   '{"sub":"00000000-0000-0000-0000-0000000000a1","email":"productor@mando.test","email_verified":true}', 'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a2',
   '{"sub":"00000000-0000-0000-0000-0000000000a2","email":"torre@mando.test","email_verified":true}', 'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a3',
   '{"sub":"00000000-0000-0000-0000-0000000000a3","email":"cliente@mando.test","email_verified":true}', 'email', now(), now(), now())
on conflict do nothing;

-- Por si los perfiles ya existían (o el trigger no corrió), se aseguran con su nombre.
insert into profiles (id, full_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Productor de ejemplo'),
  ('00000000-0000-0000-0000-0000000000a2', 'Torre de control de ejemplo'),
  ('00000000-0000-0000-0000-0000000000a3', 'Cliente de ejemplo')
on conflict (id) do update set full_name = excluded.full_name;

-- 2 · Equipo de la organización (el cliente no es miembro de la organización).
insert into organization_members (organization_id, profile_id, is_admin) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', false),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', true)
on conflict do nothing;

-- ---- Desde aquí, igual que db/seed.sql del paquete ----
insert into events (id, organization_id, name, event_type, client_name, venue_name, timezone, starts_at, ends_at, status, created_by) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001',
   'Convención anual · Lima', 'convención', 'Cliente de ejemplo', 'Centro de convenciones',
   'America/Lima', '2026-12-12 08:00-05', '2026-12-13 01:00-05', 'planned',
   '00000000-0000-0000-0000-0000000000a2');

insert into event_members (event_id, profile_id, role, title) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'producer', 'Productor general'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2', 'backend',  'Torre de control'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a3', 'viewer',   'Cliente');

insert into areas (id, event_id, name, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'Montaje', 1),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e1', 'Sonido', 2),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000e1', 'Sala', 3);

insert into providers (id, organization_id, name, service, contact_name, phone) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001',
   'Proveedor de sonido de ejemplo', 'Sonido y luces', 'Contacto de ejemplo', '+51 900 000 000');

insert into route_items (id, event_id, title, area_id, provider_id, owner_id, planned_start, planned_end, current_start, current_end, is_milestone, sort_order) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'Montaje de escenario',
   '00000000-0000-0000-0000-0000000000b1', null, '00000000-0000-0000-0000-0000000000a1',
   '2026-12-12 08:00-05', '2026-12-12 13:00-05', '2026-12-12 08:00-05', '2026-12-12 13:00-05', false, 1),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e1', 'Prueba de sonido',
   '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
   '2026-12-12 14:00-05', '2026-12-12 16:00-05', '2026-12-12 14:00-05', '2026-12-12 16:00-05', false, 2),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000e1', 'Apertura de puertas',
   '00000000-0000-0000-0000-0000000000b3', null, '00000000-0000-0000-0000-0000000000a1',
   '2026-12-12 18:30-05', '2026-12-12 20:00-05', '2026-12-12 18:30-05', '2026-12-12 20:00-05', true, 3),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000e1', 'Show central',
   '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
   '2026-12-12 20:00-05', '2026-12-12 23:00-05', '2026-12-12 20:00-05', '2026-12-12 23:00-05', true, 4),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000e1', 'Desmontaje',
   '00000000-0000-0000-0000-0000000000b1', null, '00000000-0000-0000-0000-0000000000a1',
   '2026-12-12 23:30-05', '2026-12-13 01:00-05', '2026-12-12 23:30-05', '2026-12-13 01:00-05', false, 5);

-- Cadena: sonido depende de montaje; puertas de sonido; show de puertas; desmontaje de show.
insert into route_dependencies (item_id, depends_on_id) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d2'),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d3'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000d4');

insert into critical_moments (id, event_id, route_item_id, template_key, title) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-0000000000d2', 'prueba_de_sonido', 'Prueba de sonido');

insert into moment_checks (moment_id, question, sort_order) values
  ('00000000-0000-0000-0000-0000000000f1', '¿Qué sientes que no funciona bien?', 1),
  ('00000000-0000-0000-0000-0000000000f1', '¿Qué te prometió el proveedor?', 2),
  ('00000000-0000-0000-0000-0000000000f1', 'Ingresa aquí el rider técnico.', 3);

insert into commitments (event_id, moment_id, provider_id, item_label, promised) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1',
   '00000000-0000-0000-0000-0000000000c1', 'Consola', '32 canales'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1',
   '00000000-0000-0000-0000-0000000000c1', 'Monitores de piso', '6 unidades');

insert into log_entries (event_id, actor_id, kind, summary) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2',
   'event_created', 'Se creó el evento Convención anual · Lima');

-- 3 · Escala de criticidad del evento (copia de config/criticidad.json; una prueba verifica que coincidan).
update events set criticality_config = $crit${
  "_nota": "Valores por defecto PROPUESTOS. Los niveles y umbrales deben alinearse con la escala de criticidad que ya usa el desarrollo de medios de HUB51. Se copian a cada evento al crearlo.",
  "niveles": [
    {
      "nivel": 1,
      "clave": "informativo",
      "nombre": "Informativo",
      "descripcion": "Hito cumplido a tiempo. Solo se registra.",
      "color": "#a9cce8",
      "notifica": [],
      "visible_para_cliente": false
    },
    {
      "nivel": 2,
      "clave": "atencion",
      "nombre": "Atención",
      "descripcion": "Retraso o pendiente sin responsable.",
      "color": "#c9a227",
      "notifica": [
        "producer"
      ],
      "visible_para_cliente": false
    },
    {
      "nivel": 3,
      "clave": "critico",
      "nombre": "Crítico",
      "descripcion": "Lo entregado no coincide con lo prometido, o un retraso arrastra otras actividades.",
      "color": "#b3402e",
      "notifica": [
        "producer",
        "backend"
      ],
      "visible_para_cliente": false
    },
    {
      "nivel": 4,
      "clave": "red_flag",
      "nombre": "Red Flag",
      "descripcion": "Compromete el evento. Escala al cliente.",
      "color": "#061428",
      "notifica": [
        "producer",
        "backend",
        "viewer"
      ],
      "visible_para_cliente": true
    }
  ],
  "reglas": [
    {
      "clave": "actividad_sin_responsable",
      "nivel": 2,
      "cuando": "Una actividad está a menos de `minutos_antes` de empezar y no tiene responsable.",
      "parametros": {
        "minutos_antes": 120
      }
    },
    {
      "clave": "actividad_retrasada",
      "nivel": 2,
      "cuando": "Pasó la hora de inicio vigente más `tolerancia_min` y la actividad no ha empezado.",
      "parametros": {
        "tolerancia_min": 10
      }
    },
    {
      "clave": "retraso_con_arrastre",
      "nivel": 3,
      "cuando": "Un retraso o un cambio mueve `min_dependientes` o más actividades, o suma `min_minutos` o más.",
      "parametros": {
        "min_dependientes": 2,
        "min_minutos": 30
      }
    },
    {
      "clave": "compromiso_no_coincide",
      "nivel": 3,
      "cuando": "En un momento crítico, lo encontrado no coincide con lo prometido.",
      "parametros": {}
    },
    {
      "clave": "hito_comprometido",
      "nivel": 4,
      "cuando": "El plan vigente de un hito (apertura de puertas, inicio de show) se aleja `min_minutos` o más del plan publicado.",
      "parametros": {
        "min_minutos": 30
      }
    },
    {
      "clave": "permiso_sin_aprobar",
      "nivel": 3,
      "cuando": "Un permiso obligatorio no está aprobado y faltan `dias_antes` días o menos para el evento.",
      "parametros": {
        "dias_antes": 3
      }
    },
    {
      "clave": "permiso_sin_aprobar_dia_del_evento",
      "nivel": 4,
      "cuando": "Un permiso obligatorio no está aprobado el día del evento.",
      "parametros": {}
    },
    {
      "clave": "momento_critico_sin_resolver",
      "nivel": 3,
      "cuando": "Un momento crítico lleva abierto más de `minutos` sin resolución.",
      "parametros": {
        "minutos": 30
      }
    }
  ]
}$crit$::jsonb
where id = '00000000-0000-0000-0000-0000000000e1';
