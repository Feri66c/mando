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


-- ===================== 20261126000003_operacion_etapa_1.sql =====================
-- MANDO · Migración 3 · Operar un evento (Etapa 1 del prompt maestro).
--
-- Agrega las funciones del servidor con las que la app opera el evento. Cada una:
--   * valida que quien llama sea del equipo del evento (productor o torre de control) y que el evento no esté cerrado,
--   * trabaja dentro de una sola transacción,
--   * escribe en la bitácora (log_entries) y evalúa las reglas de criticidad (events.criticality_config).
-- La app sigue sin poder hacer update directo en route_items ni escribir en la bitácora.
--
-- Contenido:
--   1. Ajustes de esquema: compromisos con tres estados, nuevo tipo de bitácora.
--   2. Ayudas internas (no se pueden llamar desde la app): reglas, niveles, bitácora, alertas.
--   3. Hoja de ruta viva: request_change / confirm_change con recálculo en cascada, mark_item.
--   4. Momentos críticos y compromisos.
--   5. Evidencias.
--   6. Alertas: manuales, reconocer, resolver, reglas por reloj.
--   7. Archivos de evidencia (Supabase Storage) y tiempo real (Supabase Realtime).

-- ---------------------------------------------------------------------------
-- 1 · Ajustes de esquema
-- ---------------------------------------------------------------------------

-- Prometido contra entregado: cumplido, parcial o incumplido (decisión 11). matches queda como resumen.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'commitment_outcome') then
    create type commitment_outcome as enum ('met', 'partial', 'unmet');
  end if;
end $$;
alter table commitments add column if not exists outcome commitment_outcome;

-- Reconocer una alerta y resolver un momento crítico también quedan en la bitácora con su propio tipo.
alter type log_kind add value if not exists 'alert_acknowledged';
alter type log_kind add value if not exists 'moment_resolved';

create index if not exists alerts_dedup_idx on alerts (event_id, rule_key, entity_id) where status <> 'resolved';
create index if not exists evidences_event_idx on evidences (event_id, received_at);

-- ---------------------------------------------------------------------------
-- 2 · Ayudas internas
-- ---------------------------------------------------------------------------

-- Corta la operación si quien llama no es del equipo o si el evento ya cerró.
create or replace function public._require_team(p_event uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_event is null or not public.is_event_team(p_event) then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  if (select status from events where id = p_event) = 'closed' then
    raise exception 'El evento está cerrado: ya no acepta cambios.' using errcode = '42501';
  end if;
end $$;

-- Una regla de criticidad del evento, o null si el evento no la tiene (regla apagada).
create or replace function public._rule(p_event uuid, p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select r from events e, jsonb_array_elements(coalesce(e.criticality_config -> 'reglas', '[]'::jsonb)) r
  where e.id = p_event and r ->> 'clave' = p_key
  limit 1
$$;

create or replace function public._rule_param(p_rule jsonb, p_param text, p_default numeric) returns numeric
language sql immutable as $$
  select coalesce((p_rule -> 'parametros' ->> p_param)::numeric, p_default)
$$;

create or replace function public._level_config(p_event uuid, p_level int) returns jsonb
language sql stable security definer set search_path = public as $$
  select n from events e, jsonb_array_elements(coalesce(e.criticality_config -> 'niveles', '[]'::jsonb)) n
  where e.id = p_event and (n ->> 'nivel')::int = p_level
  limit 1
$$;

create or replace function public._level_name(p_event uuid, p_level int) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(public._level_config(p_event, p_level) ->> 'nombre', 'Nivel ' || p_level)
$$;

-- ¿El cliente ve las alertas de este nivel? Sin configuración, solo el nivel 4.
create or replace function public._level_visible(p_event uuid, p_level int) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((public._level_config(p_event, p_level) ->> 'visible_para_cliente')::boolean, p_level = 4)
$$;

-- "19:30" en la zona horaria del evento.
create or replace function public._hhmi(p_event uuid, p_at timestamptz) returns text
language sql stable security definer set search_path = public as $$
  select to_char(p_at at time zone coalesce((select timezone from events where id = p_event), 'America/Lima'), 'HH24:MI')
$$;

create or replace function public._actor_name(p_actor uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select full_name from profiles where id = p_actor), 'Sistema')
$$;

-- Única puerta de escritura a la bitácora.
create or replace function public._log(
  p_event uuid, p_kind log_kind, p_summary text, p_level int, p_entity_type text, p_entity_id uuid,
  p_payload jsonb, p_visible boolean, p_actor uuid
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into log_entries (event_id, actor_id, kind, level, summary, entity_type, entity_id, payload, visible_to_viewer)
  values (p_event, p_actor, p_kind, p_level, p_summary, p_entity_type, p_entity_id,
          coalesce(p_payload, '{}'::jsonb), coalesce(p_visible, false))
  returning id into v_id;
  return v_id;
end $$;

-- Levanta una alerta. Una misma situación (regla + entidad) no se repite: si ya hay una abierta o reconocida,
-- solo sube su nivel cuando corresponde. Devuelve el id de la alerta.
create or replace function public._raise_alert(
  p_event uuid, p_level int, p_rule text, p_title text, p_detail text,
  p_entity_type text, p_entity_id uuid, p_actor uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_existing alerts;
  v_id uuid;
  v_visible boolean := public._level_visible(p_event, p_level);
begin
  if p_rule is not null and p_entity_id is not null then
    select * into v_existing from alerts
    where event_id = p_event and rule_key = p_rule and entity_id = p_entity_id and status <> 'resolved'
    order by raised_at desc limit 1
    for update;
    if found then
      if p_level > v_existing.level then
        update alerts
          set level = p_level, title = p_title, detail = p_detail,
              visible_to_viewer = v_existing.visible_to_viewer or v_visible
          where id = v_existing.id;
        perform public._log(p_event, 'alert_raised',
          format('Alerta sube a %s: %s', public._level_name(p_event, p_level), p_title),
          p_level, 'alert', v_existing.id,
          jsonb_build_object('rule', p_rule, 'from_level', v_existing.level, 'to_level', p_level),
          v_existing.visible_to_viewer or v_visible, p_actor);
      end if;
      return v_existing.id;
    end if;
  end if;

  insert into alerts (event_id, level, rule_key, title, detail, entity_type, entity_id, visible_to_viewer, raised_by)
  values (p_event, p_level, p_rule, p_title, p_detail, p_entity_type, p_entity_id, v_visible, p_actor)
  returning id into v_id;

  perform public._log(p_event, 'alert_raised',
    format('%s: %s', public._level_name(p_event, p_level), p_title),
    p_level, 'alert', v_id, jsonb_build_object('rule', p_rule), v_visible, p_actor);
  return v_id;
end $$;

-- Resuelve sola una alerta de regla cuando la situación desaparece (p. ej., la actividad retrasada empezó).
create or replace function public._auto_resolve(p_event uuid, p_rule text, p_entity_id uuid, p_reason text, p_actor uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v alerts;
begin
  for v in
    select * from alerts
    where event_id = p_event and rule_key = p_rule and entity_id = p_entity_id and status <> 'resolved'
    for update
  loop
    update alerts set status = 'resolved', resolved_at = now(), resolved_by = p_actor where id = v.id;
    perform public._log(p_event, 'alert_resolved', format('Resuelta: %s. %s', v.title, p_reason),
      v.level, 'alert', v.id, jsonb_build_object('rule', p_rule, 'automatic', true), v.visible_to_viewer, p_actor);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Hoja de ruta viva
-- ---------------------------------------------------------------------------

-- Nuevo horario de la actividad según el tipo de cambio.
--   extend: suma (o resta) minutos al final.   move: desplaza inicio y fin (por minutos o a una hora nueva).
create or replace function public._change_target(
  p_item uuid, p_kind change_kind, p_delta int, p_new_start timestamptz,
  out o_start timestamptz, out o_end timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare r route_items;
begin
  select * into r from route_items where id = p_item;
  if not found then raise exception 'La actividad no existe.'; end if;
  if r.status in ('done', 'cancelled') then
    raise exception 'La actividad «%» ya terminó o fue cancelada: no se puede mover.', r.title;
  end if;
  if p_kind = 'extend' then
    if coalesce(p_delta, 0) = 0 then raise exception 'Indica cuántos minutos agregar o quitar.'; end if;
    o_start := r.current_start;
    o_end := r.current_end + make_interval(mins => p_delta);
    if o_end < o_start then raise exception 'La actividad no puede terminar antes de empezar.'; end if;
  elsif p_kind = 'move' then
    if p_new_start is not null then
      o_start := p_new_start;
    elsif coalesce(p_delta, 0) <> 0 then
      o_start := r.current_start + make_interval(mins => p_delta);
    else
      raise exception 'Indica la hora nueva o cuántos minutos mover.';
    end if;
    if r.actual_start is not null and o_start <> r.current_start then
      raise exception 'La actividad «%» ya empezó: solo se puede alargar o acortar.', r.title;
    end if;
    o_end := o_start + (r.current_end - r.current_start);
  else
    raise exception 'Ese tipo de cambio todavía no está disponible.';
  end if;
end $$;

-- Simula el cambio y el arrastre en cascada (docs/07). No escribe nada.
-- Devuelve la lista de actividades que cambian: la primera es la actividad pedida.
create or replace function public._simulate_change(p_item uuid, p_new_start timestamptz, p_new_end timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_event uuid;
  v_map jsonb;
  v_touched uuid[] := array[p_item];
  v_changed boolean;
  v_rounds int := 0;
  d record;
  v_start timestamptz;
  v_end timestamptz;
  v_required timestamptz;
begin
  select event_id into v_event from route_items where id = p_item;
  select jsonb_object_agg(id::text, jsonb_build_array(current_start, current_end)) into v_map
  from route_items where event_id = v_event;
  v_map := jsonb_set(v_map, array[p_item::text], jsonb_build_array(p_new_start, p_new_end));

  loop
    v_changed := false;
    v_rounds := v_rounds + 1;
    for d in
      select rd.item_id, rd.depends_on_id, rd.lag_minutes
      from route_dependencies rd
      join route_items b on b.id = rd.item_id
      where b.event_id = v_event
        and b.status not in ('done', 'cancelled')
        and rd.item_id <> p_item
        and rd.depends_on_id = any (v_touched)
    loop
      v_start := (v_map -> d.item_id::text ->> 0)::timestamptz;
      v_end := (v_map -> d.item_id::text ->> 1)::timestamptz;
      v_required := (v_map -> d.depends_on_id::text ->> 1)::timestamptz + make_interval(mins => d.lag_minutes);
      if v_start < v_required then
        v_map := jsonb_set(v_map, array[d.item_id::text], jsonb_build_array(v_required, v_required + (v_end - v_start)));
        if not d.item_id = any (v_touched) then v_touched := v_touched || d.item_id; end if;
        v_changed := true;
      end if;
    end loop;
    exit when not v_changed or v_rounds > 500;
  end loop;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'item_id', ri.id,
        'title', ri.title,
        'is_target', ri.id = p_item,
        'is_milestone', ri.is_milestone,
        'visible_to_viewer', ri.visible_to_viewer,
        'planned_start', ri.planned_start,
        'old_start', ri.current_start,
        'old_end', ri.current_end,
        'new_start', (v_map -> ri.id::text ->> 0)::timestamptz,
        'new_end', (v_map -> ri.id::text ->> 1)::timestamptz
      ) order by (ri.id <> p_item), ri.current_start, ri.sort_order)
    from route_items ri
    where ri.event_id = v_event
      and (ri.id = p_item
           or (v_map -> ri.id::text ->> 0)::timestamptz <> ri.current_start
           or (v_map -> ri.id::text ->> 1)::timestamptz <> ri.current_end)
  ), '[]'::jsonb);
end $$;

-- Pide un cambio y devuelve la vista previa. No mueve nada todavía: eso lo hace confirm_change.
create or replace function public.request_change(
  p_item uuid,
  p_kind change_kind,
  p_delta_minutes int default null,
  p_new_start timestamptz default null,
  p_reason text default null,
  p_raw_input text default null,
  p_channel input_channel default 'tap'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_event uuid;
  v_target record;
  v_affected jsonb;
  v_id uuid;
begin
  select event_id into v_event from route_items where id = p_item;
  perform public._require_team(v_event);
  select * into v_target from public._change_target(p_item, p_kind, p_delta_minutes, p_new_start);
  v_affected := public._simulate_change(p_item, v_target.o_start, v_target.o_end);

  insert into change_requests (event_id, item_id, kind, channel, raw_input, delta_minutes, payload, reason, affected, requested_by)
  values (v_event, p_item, p_kind, coalesce(p_channel, 'tap'), nullif(trim(p_raw_input), ''), p_delta_minutes,
          jsonb_build_object('new_start', p_new_start), nullif(trim(p_reason), ''), v_affected, auth.uid())
  returning id into v_id;

  return jsonb_build_object('request_id', v_id, 'affected', v_affected);
end $$;

-- Aplica un cambio pedido: recalcula con los datos de este momento, mueve todo de una vez,
-- deja la entrada de bitácora y evalúa las reglas retraso_con_arrastre e hito_comprometido.
create or replace function public.confirm_change(p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req change_requests;
  v_item route_items;
  v_target record;
  v_affected jsonb;
  a jsonb;
  v_dragged int;
  v_shift_min int;
  v_rule jsonb;
  v_actor uuid := auth.uid();
  v_summary text;
  v_from text;
begin
  select * into v_req from change_requests where id = p_request for update;
  if not found then raise exception 'Ese cambio no existe.'; end if;
  perform public._require_team(v_req.event_id);
  if v_req.applied_at is not null then raise exception 'Ese cambio ya se aplicó.'; end if;
  if v_req.requested_by <> v_actor and not public.is_event_backend(v_req.event_id) then
    raise exception 'Solo quien pidió el cambio (o la torre de control) puede confirmarlo.' using errcode = '42501';
  end if;

  -- Bloquea la hoja de ruta del evento mientras se aplica: dos cambios a la vez no se pisan.
  perform 1 from route_items where event_id = v_req.event_id for update;
  select * into v_item from route_items where id = v_req.item_id;

  select * into v_target from public._change_target(
    v_req.item_id, v_req.kind, v_req.delta_minutes, (v_req.payload ->> 'new_start')::timestamptz);
  v_affected := public._simulate_change(v_req.item_id, v_target.o_start, v_target.o_end);

  for a in select * from jsonb_array_elements(v_affected) loop
    update route_items
      set current_start = (a ->> 'new_start')::timestamptz,
          current_end = (a ->> 'new_end')::timestamptz,
          status = case when status = 'pending' and (a ->> 'new_start') is distinct from (a ->> 'old_start')
                        then 'moved'::item_status else status end
      where id = (a ->> 'item_id')::uuid;
  end loop;

  update change_requests set applied_at = now(), affected = v_affected where id = p_request;

  v_dragged := jsonb_array_length(v_affected) - 1;
  v_shift_min := round(extract(epoch from (v_target.o_end - v_item.current_end)) / 60);
  v_from := public._hhmi(v_req.event_id, v_item.current_start) || ' – ' || public._hhmi(v_req.event_id, v_item.current_end);
  v_summary := format('%s %s «%s»: %s → %s – %s',
    public._actor_name(v_actor),
    case when v_req.kind = 'extend' then 'ajustó' else 'movió' end,
    v_item.title, v_from,
    public._hhmi(v_req.event_id, v_target.o_start), public._hhmi(v_req.event_id, v_target.o_end));
  if v_dragged > 0 then
    v_summary := v_summary || format('. Arrastra %s %s', v_dragged, case when v_dragged = 1 then 'actividad' else 'actividades' end);
  end if;
  if v_req.reason is not null then v_summary := v_summary || '. Motivo: ' || v_req.reason; end if;

  perform public._log(v_req.event_id, 'change_applied', v_summary, null, 'route_item', v_req.item_id,
    jsonb_build_object('change_request_id', p_request, 'kind', v_req.kind, 'delta_minutes', v_shift_min, 'dragged', v_dragged),
    v_item.visible_to_viewer, v_actor);

  -- Regla: retraso_con_arrastre.
  v_rule := public._rule(v_req.event_id, 'retraso_con_arrastre');
  if v_rule is not null and (v_dragged >= public._rule_param(v_rule, 'min_dependientes', 2)
                             or v_shift_min >= public._rule_param(v_rule, 'min_minutos', 30)) then
    perform public._raise_alert(v_req.event_id, (v_rule ->> 'nivel')::int, 'retraso_con_arrastre',
      format('«%s» se retrasa %s min', v_item.title, v_shift_min),
      case when v_dragged > 0 then format('El cambio arrastra %s %s.', v_dragged,
        case when v_dragged = 1 then 'actividad' else 'actividades' end) else null end,
      'route_item', v_req.item_id, null);
  end if;

  -- Regla: hito_comprometido (cada hito que se aleja del plan publicado).
  v_rule := public._rule(v_req.event_id, 'hito_comprometido');
  if v_rule is not null then
    for a in select * from jsonb_array_elements(v_affected) where (value ->> 'is_milestone')::boolean loop
      if abs(extract(epoch from ((a ->> 'new_start')::timestamptz - (a ->> 'planned_start')::timestamptz)) / 60)
         >= public._rule_param(v_rule, 'min_minutos', 30) then
        perform public._raise_alert(v_req.event_id, (v_rule ->> 'nivel')::int, 'hito_comprometido',
          format('El hito «%s» se aleja del plan', a ->> 'title'),
          format('Plan publicado: %s. Ahora: %s.',
            public._hhmi(v_req.event_id, (a ->> 'planned_start')::timestamptz),
            public._hhmi(v_req.event_id, (a ->> 'new_start')::timestamptz)),
          'route_item', (a ->> 'item_id')::uuid, null);
      end if;
    end loop;
  end if;

  return v_affected;
end $$;

-- Marcas de un toque del Modo En Vivo: 'start' (empezó), 'finish' (terminó), 'at_risk' (en riesgo).
-- La hora la pone el servidor.
create or replace function public.mark_item(p_item uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r route_items;
  v_actor uuid := auth.uid();
  v_now timestamptz := now();
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
      jsonb_build_object('action', 'start', 'late_minutes', v_late), r.visible_to_viewer, v_actor);
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
      jsonb_build_object('action', 'finish', 'late_minutes', v_late), r.visible_to_viewer, v_actor);
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

-- ---------------------------------------------------------------------------
-- 4 · Momentos críticos y compromisos (internos del equipo: la bitácora no los muestra al cliente)
-- ---------------------------------------------------------------------------

create or replace function public.open_moment(p_moment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m critical_moments;
begin
  select * into m from critical_moments where id = p_moment for update;
  if not found then raise exception 'El momento crítico no existe.'; end if;
  perform public._require_team(m.event_id);
  if m.status = 'open' then return; end if;
  if m.status = 'resolved' then raise exception 'El momento «%» ya se resolvió.', m.title; end if;
  update critical_moments set status = 'open', opened_at = now(), opened_by = auth.uid() where id = p_moment;
  perform public._log(m.event_id, 'moment_opened', format('Se abrió el momento crítico «%s»', m.title),
    m.level, 'critical_moment', p_moment, '{}'::jsonb, false, auth.uid());
end $$;

-- Crea y abre un momento crítico desde una plantilla (config/plantillas-momentos.json, la lee la app).
create or replace function public.create_moment(
  p_event uuid, p_route_item uuid, p_template_key text, p_title text, p_questions text[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; i int;
begin
  perform public._require_team(p_event);
  if p_route_item is not null and not exists (select 1 from route_items where id = p_route_item and event_id = p_event) then
    raise exception 'La actividad no es de este evento.';
  end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Ponle un nombre al momento crítico.'; end if;
  insert into critical_moments (event_id, route_item_id, template_key, title, status, opened_by, opened_at)
  values (p_event, p_route_item, nullif(p_template_key, ''), trim(p_title), 'open', auth.uid(), now())
  returning id into v_id;
  for i in 1 .. coalesce(array_length(p_questions, 1), 0) loop
    insert into moment_checks (moment_id, question, sort_order) values (v_id, p_questions[i], i);
  end loop;
  perform public._log(p_event, 'moment_opened', format('Se abrió el momento crítico «%s»', trim(p_title)),
    1, 'critical_moment', v_id, jsonb_build_object('template', p_template_key), false, auth.uid());
  return v_id;
end $$;

create or replace function public.answer_check(p_check uuid, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
declare c moment_checks; m critical_moments;
begin
  select * into c from moment_checks where id = p_check for update;
  if not found then raise exception 'La pregunta no existe.'; end if;
  select * into m from critical_moments where id = c.moment_id;
  perform public._require_team(m.event_id);
  if coalesce(trim(p_answer), '') = '' then raise exception 'Escribe una respuesta.'; end if;
  update moment_checks set answer_text = trim(p_answer), answered_by = auth.uid(), answered_at = now() where id = p_check;
  perform public._log(m.event_id, 'check_answered', format('%s — %s', c.question, trim(p_answer)), null,
    'critical_moment', m.id, jsonb_build_object('check_id', p_check), false, auth.uid());
end $$;

create or replace function public.add_commitment(p_moment uuid, p_label text, p_promised text) returns uuid
language plpgsql security definer set search_path = public as $$
declare m critical_moments; v_id uuid; v_provider uuid;
begin
  select * into m from critical_moments where id = p_moment;
  if not found then raise exception 'El momento crítico no existe.'; end if;
  perform public._require_team(m.event_id);
  if coalesce(trim(p_label), '') = '' or coalesce(trim(p_promised), '') = '' then
    raise exception 'Escribe qué es y qué se prometió.';
  end if;
  select provider_id into v_provider from route_items where id = m.route_item_id;
  insert into commitments (event_id, moment_id, provider_id, item_label, promised)
  values (m.event_id, p_moment, v_provider, trim(p_label), trim(p_promised))
  returning id into v_id;
  return v_id;
end $$;

-- Prometido contra entregado. Parcial o incumplido levanta compromiso_no_coincide; cumplido la resuelve.
create or replace function public.check_commitment(p_commitment uuid, p_found text, p_outcome commitment_outcome)
returns void
language plpgsql security definer set search_path = public as $$
declare
  c commitments;
  v_rule jsonb;
  v_level int;
  v_actor uuid := auth.uid();
  v_word text := case p_outcome when 'met' then 'cumplido' when 'partial' then 'parcial' else 'incumplido' end;
begin
  select * into c from commitments where id = p_commitment for update;
  if not found then raise exception 'El compromiso no existe.'; end if;
  perform public._require_team(c.event_id);
  if p_outcome is null then raise exception 'Marca si se cumplió, fue parcial o no se cumplió.'; end if;
  update commitments
    set found = nullif(trim(p_found), ''), outcome = p_outcome, matches = (p_outcome = 'met'),
        checked_by = v_actor, checked_at = now()
    where id = p_commitment;
  perform public._log(c.event_id, 'commitment_checked',
    format('%s: prometido %s, encontrado %s (%s)', c.item_label, c.promised, coalesce(nullif(trim(p_found), ''), '—'), v_word),
    null, 'commitment', p_commitment, jsonb_build_object('outcome', p_outcome), false, v_actor);

  if p_outcome = 'met' then
    perform public._auto_resolve(c.event_id, 'compromiso_no_coincide', p_commitment, 'Se cumplió lo prometido.', v_actor);
    return;
  end if;
  v_rule := public._rule(c.event_id, 'compromiso_no_coincide');
  if v_rule is null then return; end if;
  v_level := case when p_outcome = 'partial'
                  then public._rule_param(v_rule, 'nivel_parcial', (v_rule ->> 'nivel')::numeric)::int
                  else (v_rule ->> 'nivel')::int end;
  perform public._raise_alert(c.event_id, v_level, 'compromiso_no_coincide',
    format('%s no coincide con lo prometido', c.item_label),
    format('Prometido: %s. Encontrado: %s.', c.promised, coalesce(nullif(trim(p_found), ''), '—')),
    'commitment', p_commitment, null);
  if c.moment_id is not null then
    update critical_moments set level = greatest(level, v_level) where id = c.moment_id;
  end if;
end $$;

create or replace function public.resolve_moment(p_moment uuid, p_resolution text) returns void
language plpgsql security definer set search_path = public as $$
declare m critical_moments;
begin
  select * into m from critical_moments where id = p_moment for update;
  if not found then raise exception 'El momento crítico no existe.'; end if;
  perform public._require_team(m.event_id);
  if m.status = 'resolved' then raise exception 'El momento «%» ya se resolvió.', m.title; end if;
  if coalesce(trim(p_resolution), '') = '' then raise exception 'Cuenta cómo terminó.'; end if;
  update critical_moments set status = 'resolved', resolved_at = now(), resolution = trim(p_resolution) where id = p_moment;
  perform public._log(m.event_id, 'moment_resolved', format('Se resolvió «%s»: %s', m.title, trim(p_resolution)),
    m.level, 'critical_moment', p_moment, jsonb_build_object('resolved', true), false, auth.uid());
  perform public._auto_resolve(m.event_id, 'momento_critico_sin_resolver', p_moment, 'El momento se resolvió.', auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Evidencias: se agregan, nunca se editan ni se borran
-- ---------------------------------------------------------------------------
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
  p_visible boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_where text;
  v_word text := case p_kind when 'photo' then 'foto' when 'audio' then 'audio' when 'video' then 'video'
                             when 'document' then 'documento' else 'nota' end;
begin
  perform public._require_team(p_event);
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
                         captured_at, captured_by, visible_to_viewer)
  values (p_event, p_kind, case when p_kind = 'note' then null else p_file_path end, nullif(trim(p_note), ''),
          p_sha256, p_moment, p_route_item, p_alert, coalesce(p_captured_at, now()), auth.uid(), coalesce(p_visible, true))
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
-- 6 · Alertas
-- ---------------------------------------------------------------------------

-- «Reportar problema»: alerta manual con nivel elegido por el equipo.
create or replace function public.raise_alert(
  p_event uuid, p_level int, p_title text, p_detail text default null,
  p_entity_type text default null, p_entity_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_team(p_event);
  if p_level not between 1 and 4 then raise exception 'El nivel va de 1 a 4.'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Describe el problema.'; end if;
  return public._raise_alert(p_event, p_level, null, trim(p_title), nullif(trim(p_detail), ''),
    p_entity_type, p_entity_id, auth.uid());
end $$;

create or replace function public.ack_alert(p_alert uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a alerts;
begin
  select * into a from alerts where id = p_alert for update;
  if not found then raise exception 'La alerta no existe.'; end if;
  perform public._require_team(a.event_id);
  if a.status <> 'open' then return; end if;
  update alerts set status = 'acknowledged' where id = p_alert;
  perform public._log(a.event_id, 'alert_acknowledged',
    format('%s reconoció la alerta: %s', public._actor_name(auth.uid()), a.title),
    a.level, 'alert', p_alert, '{}'::jsonb, a.visible_to_viewer, auth.uid());
end $$;

create or replace function public.resolve_alert(p_alert uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a alerts;
begin
  select * into a from alerts where id = p_alert for update;
  if not found then raise exception 'La alerta no existe.'; end if;
  perform public._require_team(a.event_id);
  if a.status = 'resolved' then raise exception 'La alerta ya está resuelta.'; end if;
  update alerts set status = 'resolved', resolved_by = auth.uid(), resolved_at = now() where id = p_alert;
  perform public._log(a.event_id, 'alert_resolved',
    format('Resuelta: %s%s', a.title, coalesce('. ' || nullif(trim(p_note), ''), '')),
    a.level, 'alert', p_alert, '{}'::jsonb, a.visible_to_viewer, auth.uid());
end $$;

-- Reglas que dependen del reloj. La pantalla del equipo la llama cada minuto mientras está abierta.
-- Devuelve cuántas alertas nuevas o con nivel subido dejó.
create or replace function public.evaluate_clock_rules(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  e events;
  v_rule jsonb;
  v_now timestamptz := now();
  v_before int;
  v_after int;
  r record;
begin
  perform public._require_team(p_event);
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

-- ---------------------------------------------------------------------------
-- Quién puede llamar qué
-- ---------------------------------------------------------------------------
-- Las ayudas internas no se llaman desde la app.
revoke execute on function public._require_team(uuid) from public, anon, authenticated;
revoke execute on function public._rule(uuid, text) from public, anon, authenticated;
revoke execute on function public._rule_param(jsonb, text, numeric) from public, anon, authenticated;
revoke execute on function public._level_config(uuid, int) from public, anon, authenticated;
revoke execute on function public._level_name(uuid, int) from public, anon, authenticated;
revoke execute on function public._level_visible(uuid, int) from public, anon, authenticated;
revoke execute on function public._hhmi(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public._actor_name(uuid) from public, anon, authenticated;
revoke execute on function public._log(uuid, log_kind, text, int, text, uuid, jsonb, boolean, uuid) from public, anon, authenticated;
revoke execute on function public._raise_alert(uuid, int, text, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public._auto_resolve(uuid, text, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public._change_target(uuid, change_kind, int, timestamptz) from public, anon, authenticated;
revoke execute on function public._simulate_change(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Las acciones: solo con sesión. Además, cada una valida el rol en el evento.
do $$
declare f text;
begin
  foreach f in array array[
    'public.request_change(uuid, change_kind, int, timestamptz, text, text, input_channel)',
    'public.confirm_change(uuid)',
    'public.mark_item(uuid, text)',
    'public.open_moment(uuid)',
    'public.create_moment(uuid, uuid, text, text, text[])',
    'public.answer_check(uuid, text)',
    'public.add_commitment(uuid, text, text)',
    'public.check_commitment(uuid, text, commitment_outcome)',
    'public.resolve_moment(uuid, text)',
    'public.add_evidence(uuid, evidence_kind, text, text, text, timestamptz, uuid, uuid, uuid, boolean)',
    'public.raise_alert(uuid, int, text, text, text, uuid)',
    'public.ack_alert(uuid)',
    'public.resolve_alert(uuid, text)',
    'public.evaluate_clock_rules(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7 · Archivos de evidencia y tiempo real (solo si existen, como en Supabase)
-- ---------------------------------------------------------------------------

-- ¿Puede subir un archivo a esta ruta? Ruta: <id del evento>/<archivo>. Solo el equipo, evento abierto.
create or replace function public.can_upload_evidence_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_event uuid;
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 2) = '' then
    return false;
  end if;
  v_event := split_part(p_name, '/', 1)::uuid;
  return public.is_event_team(v_event)
     and coalesce((select status from events where id = v_event) <> 'closed', false);
end $$;

-- ¿Puede ver este archivo? El equipo ve los de su evento; el cliente, solo los de evidencias visibles.
create or replace function public.can_read_evidence_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_event uuid;
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_event := split_part(p_name, '/', 1)::uuid;
  return public.is_event_team(v_event)
      or exists (select 1 from evidences ev
                 where ev.file_path = p_name and ev.event_id = v_event
                   and public.can_view(ev.event_id, ev.visible_to_viewer));
end $$;

revoke execute on function public.can_upload_evidence_file(text) from public, anon;
revoke execute on function public.can_read_evidence_file(text) from public, anon;
grant execute on function public.can_upload_evidence_file(text) to authenticated;
grant execute on function public.can_read_evidence_file(text) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is not null then
    -- Cubo privado. 50 MB por archivo. Sin políticas de update ni delete: un archivo subido no se cambia.
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('evidences', 'evidences', false, 52428800)
    on conflict (id) do nothing;

    drop policy if exists evidences_files_insert on storage.objects;
    create policy evidences_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'evidences' and public.can_upload_evidence_file(name));
    drop policy if exists evidences_files_read on storage.objects;
    create policy evidences_files_read on storage.objects for select to authenticated
      using (bucket_id = 'evidences' and public.can_read_evidence_file(name));
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- Qué filas recibe cada persona lo decide la seguridad por fila.
    begin alter publication supabase_realtime add table route_items; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table log_entries; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table alerts; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table evidences; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table critical_moments; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table moment_checks; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table commitments; exception when duplicate_object then null; end;
  end if;
end $$;


-- ===================== 20261127000004_app_movil.sql =====================
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


-- ===================== 20261128000005_invitaciones_y_tipos.sql =====================
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


-- ===================== 20261129000006_meritos_y_cierre.sql =====================
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


-- ===================== 20261130000007_expediente_y_locacion.sql =====================
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


-- ===================== 20261201000008_aprobaciones_del_cliente.sql =====================
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


-- ===================== 20261202000009_planificacion.sql =====================
-- MANDO · Migración 9 · Planificación: los 5 elementos y el candado del timeline (decisiones 30 a 33).
--
--   1. Base de personas de la organización: se registran una vez (nombre, DNI, vigencia, foto) y en cada evento
--      se eligen con un check.
--   2. Lista técnica del evento, con obligatorios y «por completar» hasta 24 o 2 horas antes.
--   3. Presupuesto: monto global que el cliente aprueba; el desglose lo ve la productora solo si el productor
--      general lo habilita.
--   4. Los 5 elementos (legal, personal, técnico, presupuesto, aprobaciones): mientras falte uno, las piezas clave
--      no se pueden marcar como empezadas.
-- Toda tabla nueva tiene seguridad por fila y su prueba en tests/db. La bitácora sigue sin poder editarse.

alter type log_kind add value if not exists 'planning_updated';

alter table events add column if not exists planning_gate boolean not null default false;

-- ---------------------------------------------------------------------------
-- 1 · Personas
-- ---------------------------------------------------------------------------

create table if not exists people (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  full_name       text not null check (length(trim(full_name)) > 0),
  doc_number      text,                       -- DNI o carné de extranjería
  doc_expires_on  date,
  doc_path        text,                       -- copia del DNI, en el cubo privado
  photo_path      text,
  phone           text,
  default_role    text,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, doc_number)
);

create table if not exists event_people (
  event_id   uuid not null references events(id) on delete cascade,
  person_id  uuid not null references people(id) on delete cascade,
  role       text not null check (length(trim(role)) > 0),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  primary key (event_id, person_id)
);

-- Quién maneja la base de personas: el administrador de la organización y los niveles 1 y 2 de sus eventos.
create or replace function public.can_manage_people(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_org_admin(p_org)
      or exists (select 1 from event_members m join events e on e.id = m.event_id
                 where e.organization_id = p_org and m.profile_id = auth.uid()
                   and m.role <> 'viewer' and coalesce(m.level, 4) <= 2)
$$;

alter table people enable row level security;
alter table event_people enable row level security;
-- Los datos personales (DNI, teléfono) solo los leen quienes manejan la base. El resto del equipo ve nombre,
-- rol y foto a través de event_people_board().
drop policy if exists people_read on people;
create policy people_read on people for select to authenticated using (public.can_manage_people(organization_id));
drop policy if exists event_people_read on event_people;
create policy event_people_read on event_people for select to authenticated using (public.is_event_team(event_id));

create or replace function public._person_doc_state(p people, p_date date) returns text
language sql immutable as $$
  select case
    when p.doc_number is null or p.doc_path is null then 'sin_dni'
    when p.doc_expires_on is null then 'sin_vigencia'
    when p.doc_expires_on < p_date then 'vencido'
    else 'vigente' end
$$;

-- Fecha contra la que se revisa la vigencia: el día del evento.
create or replace function public._event_day(p_event uuid) returns date
language sql stable security definer set search_path = public as $$
  select coalesce((starts_at at time zone timezone)::date, current_date) from events where id = p_event
$$;

create or replace function public._check_person_file(p_org uuid, p_path text) returns void
language plpgsql immutable as $$
begin
  if p_path is not null and p_path not like 'personas/' || p_org::text || '/%' then
    raise exception 'El archivo no pertenece a la base de personas de esta organización.' using errcode = '22023';
  end if;
end $$;

create or replace function public._require_planner(p_event uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if public._my_level(p_event) > 2 then
    raise exception 'Esto lo decide el productor general o el productor de campo.' using errcode = '42501';
  end if;
  perform public._require_team(p_event);
end $$;

-- Registrar o corregir a una persona. Si el DNI ya está en la base, se actualiza esa ficha: nadie se registra dos veces.
create or replace function public.save_person(
  p_event uuid, p_person uuid, p_full_name text, p_doc_number text default null, p_doc_expires_on date default null,
  p_phone text default null, p_default_role text default null, p_photo_path text default null, p_doc_path text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_org uuid;
  v_id uuid := p_person;
  v_doc text := nullif(regexp_replace(coalesce(p_doc_number, ''), '\s', '', 'g'), '');
  v_photo text := nullif(trim(coalesce(p_photo_path, '')), '');
  v_copy text := nullif(trim(coalesce(p_doc_path, '')), '');
begin
  perform public._require_planner(p_event);
  select organization_id into v_org from events where id = p_event;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Escribe el nombre completo.' using errcode = '22023';
  end if;
  perform public._check_person_file(v_org, v_photo);
  perform public._check_person_file(v_org, v_copy);
  if v_id is null and v_doc is not null then
    select id into v_id from people where organization_id = v_org and doc_number = v_doc;
  end if;
  if v_id is null then
    insert into people (organization_id, full_name, doc_number, doc_expires_on, phone, default_role, photo_path, doc_path, created_by)
    values (v_org, trim(p_full_name), v_doc, p_doc_expires_on, nullif(trim(coalesce(p_phone, '')), ''),
            nullif(trim(coalesce(p_default_role, '')), ''), v_photo, v_copy, v_me)
    returning id into v_id;
  else
    update people set
      full_name = trim(p_full_name),
      doc_number = coalesce(v_doc, doc_number),
      doc_expires_on = coalesce(p_doc_expires_on, doc_expires_on),
      phone = coalesce(nullif(trim(coalesce(p_phone, '')), ''), phone),
      default_role = coalesce(nullif(trim(coalesce(p_default_role, '')), ''), default_role),
      photo_path = coalesce(v_photo, photo_path),
      doc_path = coalesce(v_copy, doc_path),
      updated_at = now()
    where id = v_id and organization_id = v_org;
    if not found then
      raise exception 'Esa persona no está en la base de esta organización.' using errcode = '42501';
    end if;
  end if;
  return v_id;
end $$;

-- Elegir (o quitar) a una persona para este evento.
create or replace function public.assign_person(p_event uuid, p_person uuid, p_role text, p_assigned boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_person people;
  v_role text;
begin
  perform public._require_planner(p_event);
  select p.* into v_person from people p join events e on e.organization_id = p.organization_id where p.id = p_person and e.id = p_event;
  if not found then
    raise exception 'Esa persona no está en la base de esta organización.' using errcode = '42501';
  end if;
  if not coalesce(p_assigned, true) then
    delete from event_people where event_id = p_event and person_id = p_person;
    if found then
      perform public._log(p_event, 'planning_updated', format('%s quitó a %s del personal.', public._actor_name(v_me), v_person.full_name),
        1, 'person', p_person, '{}'::jsonb, false, v_me);
    end if;
    return;
  end if;
  v_role := coalesce(nullif(trim(coalesce(p_role, '')), ''), v_person.default_role);
  if v_role is null then
    raise exception 'Indica qué hace esta persona en el evento.' using errcode = '22023';
  end if;
  insert into event_people (event_id, person_id, role, created_by) values (p_event, p_person, v_role, v_me)
  on conflict (event_id, person_id) do update set role = excluded.role;
  perform public._log(p_event, 'planning_updated', format('%s sumó a %s como %s.', public._actor_name(v_me), v_person.full_name, v_role),
    1, 'person', p_person, jsonb_build_object('role', v_role), false, v_me);
end $$;

-- La lista que ve la pantalla. Niveles 1 y 2: toda la base, con DNI. Niveles 3 y 4: solo el personal del evento, sin datos personales.
create or replace function public.event_people_board(p_event uuid)
returns table (person_id uuid, full_name text, default_role text, role text, assigned boolean, photo_path text,
               doc_state text, doc_number text, doc_expires_on date, doc_path text, phone text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_full boolean := public._my_level(p_event) <= 2;   -- también exige ser del equipo
  v_day date := public._event_day(p_event);
begin
  return query
    select p.id, p.full_name, p.default_role, ep.role, ep.person_id is not null, p.photo_path,
           public._person_doc_state(p, v_day),
           case when v_full then p.doc_number end, case when v_full then p.doc_expires_on end,
           case when v_full then p.doc_path end, case when v_full then p.phone end
    from people p
    join events e on e.id = p_event and e.organization_id = p.organization_id
    left join event_people ep on ep.event_id = p_event and ep.person_id = p.id
    where v_full or ep.person_id is not null
    order by (ep.person_id is null), p.full_name;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Lista técnica
-- ---------------------------------------------------------------------------

create table if not exists event_tech_items (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events(id) on delete cascade,
  category     text not null default 'otros',
  title        text not null check (length(trim(title)) > 0),
  detail       text,                         -- modelo, medidas, cantidad de canales...
  quantity     int not null default 1 check (quantity > 0),
  mandatory    boolean not null default false,
  due_hours    int check (due_hours in (24, 2)),   -- lo no obligatorio se completa hasta tantas horas antes
  status       text not null default 'pending' check (status in ('pending', 'confirmed', 'not_applicable')),
  confirmed_by uuid references profiles(id),
  confirmed_at timestamptz,
  sort_order   int not null default 0,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists event_tech_items_event_idx on event_tech_items (event_id, sort_order);

alter table event_tech_items enable row level security;
drop policy if exists event_tech_items_read on event_tech_items;
create policy event_tech_items_read on event_tech_items for select to authenticated using (public.is_event_team(event_id));

create or replace function public.add_tech_item(
  p_event uuid, p_category text, p_title text, p_detail text default null, p_quantity int default 1,
  p_mandatory boolean default false, p_due_hours int default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_me uuid := auth.uid();
begin
  perform public._require_coordinator(p_event);
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Escribe qué equipo es.' using errcode = '22023';
  end if;
  if p_due_hours is not null and p_due_hours not in (24, 2) then
    raise exception 'El plazo es de 24 o de 2 horas antes.' using errcode = '22023';
  end if;
  insert into event_tech_items (event_id, category, title, detail, quantity, mandatory, due_hours, sort_order, created_by)
  values (p_event, coalesce(nullif(trim(p_category), ''), 'otros'), trim(p_title), nullif(trim(coalesce(p_detail, '')), ''),
          greatest(coalesce(p_quantity, 1), 1), coalesce(p_mandatory, false),
          case when coalesce(p_mandatory, false) then null else p_due_hours end,
          (select coalesce(max(sort_order), 0) + 1 from event_tech_items where event_id = p_event), v_me)
  returning id into v_id;
  perform public._log(p_event, 'planning_updated', format('%s agregó a la lista técnica: %s.', public._actor_name(v_me), trim(p_title)),
    1, 'tech_item', v_id, '{}'::jsonb, false, v_me);
  return v_id;
end $$;

-- Confirmar, volver a pendiente o marcar «no aplica». Sacar un obligatorio lo deciden los niveles 1 y 2.
create or replace function public.set_tech_item(p_item uuid, p_status text, p_detail text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v event_tech_items; v_me uuid := auth.uid();
begin
  select * into v from event_tech_items where id = p_item for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._require_coordinator(v.event_id);
  if p_status not in ('pending', 'confirmed', 'not_applicable') then
    raise exception 'Estado desconocido.' using errcode = '22023';
  end if;
  if p_status = 'not_applicable' and v.mandatory and public._my_level(v.event_id) > 2 then
    raise exception 'Sacar un obligatorio lo decide el productor general o el productor de campo.' using errcode = '42501';
  end if;
  update event_tech_items
    set status = p_status, detail = coalesce(nullif(trim(coalesce(p_detail, '')), ''), detail),
        confirmed_by = case when p_status = 'confirmed' then v_me end,
        confirmed_at = case when p_status = 'confirmed' then now() end
    where id = v.id;
  if p_status <> v.status then
    perform public._log(v.event_id, 'planning_updated',
      format('%s %s en la lista técnica: %s.', public._actor_name(v_me),
             case p_status when 'confirmed' then 'confirmó' when 'not_applicable' then 'marcó «no aplica»' else 'volvió a pendiente' end, v.title),
      1, 'tech_item', v.id, jsonb_build_object('status', p_status), false, v_me);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Presupuesto
-- ---------------------------------------------------------------------------

create table if not exists event_budgets (
  event_id          uuid primary key references events(id) on delete cascade,
  currency          text not null default 'PEN',
  total             numeric(12, 2) not null check (total > 0),
  breakdown_visible boolean not null default false,   -- ¿la productora ve el desglose?
  status            text not null default 'sent' check (status in ('sent', 'approved', 'changes_requested')),
  decision_note     text,
  decided_by        uuid references profiles(id),
  decided_at        timestamptz,
  updated_by        uuid references profiles(id),
  updated_at        timestamptz not null default now()
);

create table if not exists event_budget_lines (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  concept_key text,                            -- clave de config/costos-referencia.json, si aplica
  title       text not null check (length(trim(title)) > 0),
  quantity    numeric(10, 2) not null default 1 check (quantity > 0),
  unit_cost   numeric(12, 2) not null check (unit_cost >= 0),
  created_at  timestamptz not null default now()
);
create index if not exists event_budget_lines_event_idx on event_budget_lines (event_id, created_at);

-- El monto global lo ven el cliente (lo aprueba) y los niveles 1 y 2. El desglose, el productor general siempre
-- y el productor de campo solo si se le habilitó. Coordinación y técnicos no ven montos.
create or replace function public.can_see_budget(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_members m where m.event_id = p_event and m.profile_id = auth.uid()
                 and (m.role = 'viewer' or coalesce(m.level, 4) <= 2))
$$;
create or replace function public.can_see_budget_lines(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_members m where m.event_id = p_event and m.profile_id = auth.uid()
                 and (m.role = 'backend'
                      or (m.role = 'producer' and coalesce(m.level, 4) <= 2
                          and coalesce((select breakdown_visible from event_budgets b where b.event_id = p_event), false))))
$$;

alter table event_budgets enable row level security;
alter table event_budget_lines enable row level security;
drop policy if exists event_budgets_read on event_budgets;
create policy event_budgets_read on event_budgets for select to authenticated using (public.can_see_budget(event_id));
drop policy if exists event_budget_lines_read on event_budget_lines;
create policy event_budget_lines_read on event_budget_lines for select to authenticated using (public.can_see_budget_lines(event_id));

create or replace function public._require_backend(p_event uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_team(p_event);
  if not public.is_event_backend(p_event) then
    raise exception 'El presupuesto lo maneja el productor general.' using errcode = '42501';
  end if;
end $$;

-- Cargar o cambiar el monto. Si el monto cambia, el cliente tiene que aprobarlo de nuevo.
create or replace function public.set_budget(p_event uuid, p_total numeric, p_breakdown_visible boolean default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_old event_budgets;
begin
  perform public._require_backend(p_event);
  if p_total is null or p_total <= 0 then
    raise exception 'Escribe el monto del presupuesto.' using errcode = '22023';
  end if;
  select * into v_old from event_budgets where event_id = p_event for update;
  if not found then
    insert into event_budgets (event_id, total, breakdown_visible, updated_by)
    values (p_event, p_total, coalesce(p_breakdown_visible, false), v_me);
    perform public._log(p_event, 'planning_updated', format('%s cargó el presupuesto para aprobación del cliente.', public._actor_name(v_me)),
      1, 'budget', p_event, '{}'::jsonb, true, v_me);
    return;
  end if;
  update event_budgets set
    total = p_total, breakdown_visible = coalesce(p_breakdown_visible, breakdown_visible),
    status = case when p_total <> v_old.total then 'sent' else status end,
    decision_note = case when p_total <> v_old.total then null else decision_note end,
    decided_by = case when p_total <> v_old.total then null else decided_by end,
    decided_at = case when p_total <> v_old.total then null else decided_at end,
    updated_by = v_me, updated_at = now()
  where event_id = p_event;
  if p_total <> v_old.total then
    perform public._log(p_event, 'planning_updated', format('%s cambió el presupuesto: vuelve a estar por aprobar.', public._actor_name(v_me)),
      1, 'budget', p_event, '{}'::jsonb, true, v_me);
  elsif coalesce(p_breakdown_visible, v_old.breakdown_visible) <> v_old.breakdown_visible then
    perform public._log(p_event, 'planning_updated',
      format('%s %s el desglose del presupuesto a la productora.', public._actor_name(v_me),
             case when p_breakdown_visible then 'habilitó' else 'ocultó' end),
      1, 'budget', p_event, '{}'::jsonb, false, v_me);
  end if;
end $$;

create or replace function public.add_budget_line(p_event uuid, p_title text, p_quantity numeric, p_unit_cost numeric, p_concept_key text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public._require_backend(p_event);
  if coalesce(trim(p_title), '') = '' or p_quantity is null or p_quantity <= 0 or p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'Completa la partida: qué es, cuántos y cuánto cuesta cada uno.' using errcode = '22023';
  end if;
  insert into event_budget_lines (event_id, concept_key, title, quantity, unit_cost)
  values (p_event, nullif(trim(coalesce(p_concept_key, '')), ''), trim(p_title), p_quantity, p_unit_cost)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.remove_budget_line(p_line uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_event uuid;
begin
  select event_id into v_event from event_budget_lines where id = p_line;
  if v_event is null then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._require_backend(v_event);
  delete from event_budget_lines where id = p_line;
end $$;

-- Aprueba el cliente. El productor general puede registrar una aprobación recibida por otro medio, diciendo cómo.
create or replace function public.decide_budget(p_event uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_role event_role := public.my_event_role(p_event);
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if v_me is null or v_role is null or v_role = 'producer' then
    raise exception 'El presupuesto lo aprueba el cliente.' using errcode = '42501';
  end if;
  if (select status from events where id = p_event) = 'closed' then
    raise exception 'El evento está cerrado: ya no acepta cambios.' using errcode = '42501';
  end if;
  if p_approve is null or (not p_approve and v_note is null) then
    raise exception 'Cuenta qué hay que cambiar.' using errcode = '22023';
  end if;
  if v_role = 'backend' and v_note is null then
    raise exception 'Anota cómo te dio el cliente su aprobación (llamada, correo, WhatsApp).' using errcode = '22023';
  end if;
  update event_budgets set status = case when p_approve then 'approved' else 'changes_requested' end,
         decision_note = v_note, decided_by = v_me, decided_at = now()
  where event_id = p_event;
  if not found then
    raise exception 'Todavía no hay un presupuesto cargado.' using errcode = '22023';
  end if;
  perform public._log(p_event, 'planning_updated',
    case
      when v_role = 'backend' then format('%s registró que el cliente %s el presupuesto: %s', public._actor_name(v_me),
                                          case when p_approve then 'aprobó' else 'pidió un cambio en' end, v_note)
      when p_approve then format('%s aprobó el presupuesto.', public._actor_name(v_me))
      else format('%s pidió un cambio en el presupuesto: %s', public._actor_name(v_me), v_note)
    end,
    case when p_approve then 1 else 2 end, 'budget', p_event, jsonb_build_object('approved', p_approve), true, v_me);
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Los 5 elementos y el candado
-- ---------------------------------------------------------------------------

create or replace function public._planning_status(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_day date := public._event_day(p_event);
  v_docs_total int; v_docs_open int; v_people int; v_people_bad int;
  v_tech_total int; v_tech_must int; v_tech_open int;
  v_budget text; v_approvals text;
  v_missing text[];
  v_out jsonb := '[]'::jsonb;
begin
  -- Legal: documentos no negociables y la identidad del equipo.
  select count(*), count(*) filter (where status = 'pending') into v_docs_total, v_docs_open
    from event_requirements where event_id = p_event and mandatory and status <> 'not_applicable';
  select count(*), count(*) filter (where public._person_doc_state(p, v_day) <> 'vigente' or p.photo_path is null)
    into v_people, v_people_bad
    from event_people ep join people p on p.id = ep.person_id where ep.event_id = p_event;
  v_missing := '{}';
  if v_docs_open > 0 then v_missing := v_missing || case when v_docs_open = 1 then '1 documento no negociable por subir' else format('%s documentos no negociables por subir', v_docs_open) end; end if;
  if v_people_bad > 0 then v_missing := v_missing || case when v_people_bad = 1 then '1 persona sin foto o sin DNI vigente' else format('%s personas sin foto o sin DNI vigente', v_people_bad) end; end if;
  v_out := v_out || jsonb_build_object('key', 'legal', 'ready', cardinality(v_missing) = 0,
    'done', (v_docs_total - v_docs_open) + (v_people - v_people_bad), 'total', v_docs_total + v_people, 'missing', to_jsonb(v_missing));

  -- Personal: al menos una persona elegida.
  v_out := v_out || jsonb_build_object('key', 'personal', 'ready', v_people > 0, 'done', v_people, 'total', greatest(v_people, 1),
    'missing', case when v_people > 0 then '[]'::jsonb else '["Falta elegir al personal"]'::jsonb end);

  -- Técnico: los obligatorios confirmados.
  select count(*) filter (where status <> 'not_applicable'),
         count(*) filter (where mandatory and status <> 'not_applicable'),
         count(*) filter (where mandatory and status = 'pending')
    into v_tech_total, v_tech_must, v_tech_open from event_tech_items where event_id = p_event;
  v_missing := '{}';
  if v_tech_total = 0 then v_missing := v_missing || 'Falta la lista técnica'::text;
  elsif v_tech_open > 0 then v_missing := v_missing || case when v_tech_open = 1 then '1 obligatorio por confirmar' else format('%s obligatorios por confirmar', v_tech_open) end; end if;
  v_out := v_out || jsonb_build_object('key', 'tecnico', 'ready', cardinality(v_missing) = 0,
    'done', v_tech_must - v_tech_open, 'total', greatest(v_tech_must, 1), 'missing', to_jsonb(v_missing));

  -- Presupuesto: aprobado por el cliente.
  select status into v_budget from event_budgets where event_id = p_event;
  v_out := v_out || jsonb_build_object('key', 'presupuesto', 'ready', coalesce(v_budget = 'approved', false),
    'done', case when v_budget = 'approved' then 1 else 0 end, 'total', 1,
    'missing', case v_budget when 'approved' then '[]'::jsonb
                 when 'sent' then '["Falta la aprobación del cliente"]'::jsonb
                 when 'changes_requested' then '["El cliente pidió un cambio"]'::jsonb
                 else '["Falta cargar el presupuesto"]'::jsonb end);

  -- Aprobaciones del cliente: la misma cuenta de la migración 8.
  v_approvals := public._approvals_missing(p_event);
  v_out := v_out || jsonb_build_object('key', 'aprobaciones', 'ready', v_approvals is null,
    'done', (select count(*) from event_approvals a join events e on e.id = a.event_id
             where a.event_id = p_event and a.removed_at is null and a.status = 'approved' and a.group_key = any (e.approval_groups)),
    'total', greatest((select count(*) from event_approvals a join events e on e.id = a.event_id
             where a.event_id = p_event and a.removed_at is null and a.group_key = any (e.approval_groups)), 1),
    'missing', case when v_approvals is null then '[]'::jsonb else to_jsonb(string_to_array(v_approvals, '; ')) end);
  return v_out;
end $$;

-- Lo que lee la pantalla. La ve todo miembro del evento: el cliente también necesita saber qué falta.
create or replace function public.planning_status(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_event_member(p_event) then
    raise exception 'No tienes permiso para ver este evento.' using errcode = '42501';
  end if;
  return jsonb_build_object('gate', (select planning_gate from events where id = p_event), 'elements', public._planning_status(p_event));
end $$;

-- Texto con lo que falta para empezar, o null. Eventos con candado: los 5 elementos. El resto: solo aprobaciones.
create or replace function public._planning_missing(p_event uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when (select planning_gate from events where id = p_event) then (
    select string_agg((case e ->> 'key' when 'legal' then 'Legal' when 'personal' then 'Personal' when 'tecnico' then 'Técnico' when 'presupuesto' then 'Presupuesto' else 'Aprobaciones' end) || ': ' || (select string_agg(m, ', ') from jsonb_array_elements_text(e -> 'missing') m), '; ')
    from jsonb_array_elements(public._planning_status(p_event)) e where not (e ->> 'ready')::boolean
  ) else public._approvals_missing(p_event) end
$$;

create or replace function public._route_items_approval_gate() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_missing text;
begin
  if new.is_milestone and old.actual_start is null and new.actual_start is not null then
    v_missing := public._planning_missing(new.event_id);
    if v_missing is not null then
      raise exception 'No se puede empezar «%»: falta completar la planificación (%).', new.title, v_missing using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- Los eventos nuevos nacen con el candado y con su lista técnica.
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
  if jsonb_typeof(new.template -> 'tecnica') = 'array' then
    insert into event_tech_items (event_id, category, title, mandatory, due_hours, sort_order)
    select new.id, coalesce(t.value ->> 'categoria', 'otros'), trim(t.value ->> 'titulo'),
           coalesce((t.value ->> 'obligatorio')::boolean, false),
           case when (t.value ->> 'plazo_horas') in ('24', '2') and not coalesce((t.value ->> 'obligatorio')::boolean, false)
                then (t.value ->> 'plazo_horas')::int end,
           t.ordinality
    from jsonb_array_elements(new.template -> 'tecnica') with ordinality t
    where coalesce(trim(t.value ->> 'titulo'), '') <> '';
  end if;
  if (new.template ->> 'planificacion') = 'true' then
    update events set planning_gate = true where id = new.id;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Archivos, permisos y tiempo real
-- ---------------------------------------------------------------------------

-- Fotos y copias de DNI: personas/<organización>/foto|dni/<archivo>. Las suben quienes manejan la base.
-- La foto la ve el equipo de los eventos de esa organización; la copia del DNI, solo quienes manejan la base.
create or replace function public.can_upload_person_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if split_part(p_name, '/', 1) <> 'personas' or split_part(p_name, '/', 3) not in ('foto', 'dni') or split_part(p_name, '/', 4) = ''
     or split_part(p_name, '/', 2) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.can_manage_people(split_part(p_name, '/', 2)::uuid);
end $$;

create or replace function public.can_read_person_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  if split_part(p_name, '/', 1) <> 'personas' or split_part(p_name, '/', 3) not in ('foto', 'dni')
     or split_part(p_name, '/', 2) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_org := split_part(p_name, '/', 2)::uuid;
  if public.can_manage_people(v_org) then return true; end if;
  return split_part(p_name, '/', 3) = 'foto'
     and exists (select 1 from event_members m join events e on e.id = m.event_id
                 where e.organization_id = v_org and m.profile_id = auth.uid() and m.role <> 'viewer');
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public._person_doc_state(people, date)', 'public._event_day(uuid)', 'public._check_person_file(uuid, text)',
    'public._require_planner(uuid)', 'public._require_backend(uuid)', 'public._planning_status(uuid)', 'public._planning_missing(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.can_manage_people(uuid)', 'public.can_see_budget(uuid)', 'public.can_see_budget_lines(uuid)',
    'public.can_upload_person_file(text)', 'public.can_read_person_file(text)',
    'public.save_person(uuid, uuid, text, text, date, text, text, text, text)',
    'public.assign_person(uuid, uuid, text, boolean)', 'public.event_people_board(uuid)',
    'public.add_tech_item(uuid, text, text, text, int, boolean, int)', 'public.set_tech_item(uuid, text, text)',
    'public.set_budget(uuid, numeric, boolean)', 'public.add_budget_line(uuid, text, numeric, numeric, text)',
    'public.remove_budget_line(uuid)', 'public.decide_budget(uuid, boolean, text)', 'public.planning_status(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

do $$
declare t text;
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists personas_files_insert on storage.objects;
    create policy personas_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'evidences' and public.can_upload_person_file(name));
    drop policy if exists personas_files_read on storage.objects;
    create policy personas_files_read on storage.objects for select to authenticated
      using (bucket_id = 'evidences' and public.can_read_person_file(name));
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['event_people', 'event_tech_items', 'event_budgets'] loop
      begin execute format('alter publication supabase_realtime add table %I', t); exception when duplicate_object then null; end;
    end loop;
  end if;
end $$;


-- ===================== 20261203000010_tiempos_del_timeline.sql =====================
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


-- ===================== 20261204000011_aprendizajes_y_satisfaccion.sql =====================
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


-- ===================== 20261205000012_brief_y_aceptacion.sql =====================
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


-- ===================== 20261206000013_ajustes_de_planificacion.sql =====================
-- MANDO · Ajustes de la planificación dictados por Fer (decisiones 42 a 45).
--
-- 1. Técnico: cada concepto lleva su documento adjunto (presupuesto del proveedor, en PDF, Excel o foto).
--    «No aplica» ya no lo decide quien está en campo: lo pide y el backend lo revisa.
-- 2. Presupuesto: llega asignado desde el backend. Si hace falta, el backend abre «adicionales»
--    y el productor los solicita con un check.
-- 3. Plazo: lo que no es obligatorio se completa hasta N horas antes (5 por defecto, lo fija el backend).
--    Si al vencer falta algo, se levanta una Red Flag.

-- ---------------------------------------------------------------------------
-- 1 · Técnico: documento por concepto y «No aplica» con revisión
-- ---------------------------------------------------------------------------

alter table event_tech_items add column if not exists doc_path text;
alter table event_tech_items add column if not exists doc_name text;
alter table event_tech_items add column if not exists na_requested_at timestamptz;
alter table event_tech_items add column if not exists na_requested_by uuid references profiles(id);
alter table event_tech_items add column if not exists na_rejected_at timestamptz;

-- Adjuntar el documento confirma el concepto.
create or replace function public.attach_tech_doc(p_item uuid, p_path text, p_name text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v event_tech_items; v_me uuid := auth.uid(); v_path text := nullif(trim(coalesce(p_path, '')), '');
begin
  select * into v from event_tech_items where id = p_item for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._require_coordinator(v.event_id);
  if v_path is null or v_path not like v.event_id::text || '/expediente/%' then
    raise exception 'El archivo no pertenece a este evento.' using errcode = '22023';
  end if;
  update event_tech_items
     set doc_path = v_path, doc_name = nullif(trim(coalesce(p_name, '')), ''), status = 'confirmed',
         confirmed_by = v_me, confirmed_at = now(), na_requested_at = null, na_requested_by = null, na_rejected_at = null
   where id = v.id;
  update alerts set status = 'resolved', resolved_at = now(), resolved_by = v_me
   where event_id = v.event_id and rule_key in ('tech_na', 'tech_na_rejected') and entity_id = v.id and status <> 'resolved';
  perform public._log(v.event_id, 'planning_updated',
    format('%s adjuntó el documento de %s.', public._actor_name(v_me), v.title),
    1, 'tech_item', v.id, jsonb_build_object('status', 'confirmed', 'document', true), false, v_me);
end $$;

-- Pedir «No aplica». El backend lo marca directo; el resto lo pide y espera la revisión.
create or replace function public.request_tech_na(p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v event_tech_items; v_me uuid := auth.uid();
begin
  select * into v from event_tech_items where id = p_item for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._require_coordinator(v.event_id);
  if v.status <> 'pending' then
    raise exception 'Solo se pide «No aplica» en un concepto pendiente.' using errcode = '22023';
  end if;
  if public.is_event_backend(v.event_id) then
    update event_tech_items set status = 'not_applicable', na_requested_at = null, na_requested_by = null, na_rejected_at = null where id = v.id;
    perform public._log(v.event_id, 'planning_updated',
      format('%s marcó «no aplica» en la lista técnica: %s.', public._actor_name(v_me), v.title),
      1, 'tech_item', v.id, jsonb_build_object('status', 'not_applicable'), false, v_me);
    return;
  end if;
  if v.na_requested_at is not null then
    return;
  end if;
  update event_tech_items set na_requested_at = now(), na_requested_by = v_me, na_rejected_at = null where id = v.id;
  perform public._log(v.event_id, 'planning_updated',
    format('%s marcó «No aplica» en %s. Falta la revisión del backend.', public._actor_name(v_me), v.title),
    2, 'tech_item', v.id, jsonb_build_object('na', 'requested'), false, v_me);
  perform public._raise_alert(v.event_id, 2, 'tech_na', format('«No aplica» por revisar: %s', v.title),
    format('%s dice que %s no va en este evento.', public._actor_name(v_me), v.title), 'tech_item', v.id, v_me);
end $$;

-- El backend revisa: si sí aplica, el concepto sigue pendiente (y bloquea si es obligatorio).
create or replace function public.review_tech_na(p_item uuid, p_applies boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v event_tech_items; v_me uuid := auth.uid();
begin
  select * into v from event_tech_items where id = p_item for update;
  if not found or v_me is null or not public.is_event_backend(v.event_id) then
    raise exception '«No aplica» lo revisa el backend.' using errcode = '42501';
  end if;
  perform public._require_team(v.event_id);
  if v.na_requested_at is null then
    raise exception 'Ese concepto no tiene un «No aplica» por revisar.' using errcode = '22023';
  end if;
  if p_applies is null then
    raise exception 'Indica si aplica o no.' using errcode = '22023';
  end if;
  update alerts set status = 'resolved', resolved_at = now(), resolved_by = v_me
   where event_id = v.event_id and rule_key = 'tech_na' and entity_id = v.id and status <> 'resolved';
  if p_applies then
    update event_tech_items set na_requested_at = null, na_requested_by = null, na_rejected_at = now() where id = v.id;
    perform public._log(v.event_id, 'planning_updated',
      format('%s revisó: %s sí aplica en este evento.', public._actor_name(v_me), v.title),
      case when v.mandatory then 3 else 2 end, 'tech_item', v.id, jsonb_build_object('na', 'rejected'), false, v_me);
    perform public._raise_alert(v.event_id, case when v.mandatory then 3 else 2 end, 'tech_na_rejected',
      format('%s sí aplica en este evento', v.title),
      case when v.mandatory then 'Es obligatorio: el acceso sigue bloqueado hasta adjuntar su documento.' else 'Adjunta su documento antes del plazo.' end,
      'tech_item', v.id, v_me);
  else
    update event_tech_items set status = 'not_applicable', na_requested_at = null, na_requested_by = null, na_rejected_at = null where id = v.id;
    perform public._log(v.event_id, 'planning_updated',
      format('%s aceptó que %s no aplica.', public._actor_name(v_me), v.title),
      1, 'tech_item', v.id, jsonb_build_object('status', 'not_applicable'), false, v_me);
  end if;
end $$;

-- Confirmar o volver a pendiente sigue igual. «No aplica» directo queda solo para el backend.
create or replace function public.set_tech_item(p_item uuid, p_status text, p_detail text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v event_tech_items; v_me uuid := auth.uid();
begin
  select * into v from event_tech_items where id = p_item for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._require_coordinator(v.event_id);
  if p_status not in ('pending', 'confirmed', 'not_applicable') then
    raise exception 'Estado desconocido.' using errcode = '22023';
  end if;
  if p_status = 'not_applicable' and not public.is_event_backend(v.event_id) then
    raise exception '«No aplica» lo revisa el backend: pídelo desde el concepto.' using errcode = '42501';
  end if;
  update event_tech_items
    set status = p_status, detail = coalesce(nullif(trim(coalesce(p_detail, '')), ''), detail),
        confirmed_by = case when p_status = 'confirmed' then v_me end,
        confirmed_at = case when p_status = 'confirmed' then now() end,
        na_requested_at = null, na_requested_by = null,
        na_rejected_at = case when p_status = 'pending' then na_rejected_at end
    where id = v.id;
  if p_status <> v.status then
    perform public._log(v.event_id, 'planning_updated',
      format('%s %s en la lista técnica: %s.', public._actor_name(v_me),
             case p_status when 'confirmed' then 'confirmó' when 'not_applicable' then 'marcó «no aplica»' else 'volvió a pendiente' end, v.title),
      1, 'tech_item', v.id, jsonb_build_object('status', p_status), false, v_me);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Presupuesto: adicionales que abre el backend
-- ---------------------------------------------------------------------------

alter table event_budgets add column if not exists extras_open boolean not null default false;

create table if not exists event_budget_extras (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events(id) on delete cascade,
  kind         text not null check (kind in ('personal', 'tecnico', 'locacion', 'otro')),
  note         text check (note is null or length(note) <= 500),
  status       text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  requested_by uuid references profiles(id),
  requested_at timestamptz not null default now(),
  decided_by   uuid references profiles(id),
  decided_at   timestamptz
);
create index if not exists event_budget_extras_event_idx on event_budget_extras (event_id, requested_at);

alter table event_budget_extras enable row level security;
-- Los ve quien ve el presupuesto y es del equipo. El cliente no: es un tema interno hasta que el backend decida.
drop policy if exists event_budget_extras_read on event_budget_extras;
create policy event_budget_extras_read on event_budget_extras for select to authenticated
  using (public.is_event_team(event_id) and public.can_see_budget(event_id));

create or replace function public.open_budget_extras(p_event uuid, p_open boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  perform public._require_backend(p_event);
  update event_budgets set extras_open = coalesce(p_open, true) where event_id = p_event;
  if not found then
    raise exception 'Primero carga el presupuesto.' using errcode = '22023';
  end if;
  perform public._log(p_event, 'planning_updated',
    format('%s %s la opción de adicionales del presupuesto.', public._actor_name(v_me), case when coalesce(p_open, true) then 'abrió' else 'cerró' end),
    1, 'budget', p_event, jsonb_build_object('extras_open', coalesce(p_open, true)), false, v_me);
end $$;

create or replace function public.request_budget_extra(p_event uuid, p_kind text, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid;
begin
  if public._my_level(p_event) > 2 then
    raise exception 'Los adicionales los pide el productor general o el productor de campo.' using errcode = '42501';
  end if;
  perform public._require_team(p_event);
  if not coalesce((select extras_open from event_budgets where event_id = p_event), false) then
    raise exception 'El backend todavía no abre la opción de adicionales.' using errcode = '42501';
  end if;
  if p_kind not in ('personal', 'tecnico', 'locacion', 'otro') then
    raise exception 'Tipo de adicional desconocido.' using errcode = '22023';
  end if;
  if exists (select 1 from event_budget_extras where event_id = p_event and kind = p_kind and status = 'requested') then
    raise exception 'Ese adicional ya está solicitado.' using errcode = '22023';
  end if;
  insert into event_budget_extras (event_id, kind, note, requested_by)
  values (p_event, p_kind, nullif(trim(coalesce(p_note, '')), ''), v_me) returning id into v_id;
  perform public._log(p_event, 'planning_updated',
    format('%s solicitó un adicional de presupuesto.', public._actor_name(v_me)),
    2, 'budget_extra', v_id, jsonb_build_object('kind', p_kind), false, v_me);
  perform public._raise_alert(p_event, 2, 'budget_extra', 'Adicional de presupuesto por revisar',
    format('%s solicitó un adicional.', public._actor_name(v_me)), 'budget_extra', v_id, v_me);
  return v_id;
end $$;

create or replace function public.decide_budget_extra(p_extra uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v event_budget_extras; v_me uuid := auth.uid();
begin
  select * into v from event_budget_extras where id = p_extra for update;
  if not found or v_me is null or not public.is_event_backend(v.event_id) then
    raise exception 'Los adicionales los decide el backend.' using errcode = '42501';
  end if;
  perform public._require_team(v.event_id);
  if v.status <> 'requested' or p_approve is null then
    raise exception 'Ese adicional ya fue decidido.' using errcode = '22023';
  end if;
  update event_budget_extras set status = case when p_approve then 'approved' else 'rejected' end, decided_by = v_me, decided_at = now() where id = v.id;
  update alerts set status = 'resolved', resolved_at = now(), resolved_by = v_me
   where event_id = v.event_id and rule_key = 'budget_extra' and entity_id = v.id and status <> 'resolved';
  perform public._log(v.event_id, 'planning_updated',
    format('%s %s un adicional de presupuesto.', public._actor_name(v_me), case when p_approve then 'aprobó' else 'rechazó' end),
    1, 'budget_extra', v.id, jsonb_build_object('kind', v.kind, 'approved', p_approve), false, v_me);
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Plazo de la planificación
-- ---------------------------------------------------------------------------

alter table events add column if not exists planning_deadline_hours int not null default 5
  check (planning_deadline_hours between 1 and 72);

create or replace function public.set_planning_deadline(p_event uuid, p_hours int) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  perform public._require_backend(p_event);
  if p_hours is null or p_hours not between 1 and 72 then
    raise exception 'El plazo va de 1 a 72 horas antes del evento.' using errcode = '22023';
  end if;
  update events set planning_deadline_hours = p_hours where id = p_event;
  perform public._log(p_event, 'planning_updated',
    format('%s fijó el plazo de la planificación en %s h antes del evento.', public._actor_name(v_me), p_hours),
    1, 'event', p_event, jsonb_build_object('hours', p_hours), false, v_me);
end $$;

-- El backend aplica el plazo. Si falta algo, Red Flag; devuelve true cuando la levantó.
create or replace function public.apply_planning_deadline(p_event uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_missing text; v_hours int;
begin
  perform public._require_backend(p_event);
  select planning_deadline_hours into v_hours from events where id = p_event;
  select string_agg((case e ->> 'key' when 'legal' then 'Legal' when 'personal' then 'Personal' when 'tecnico' then 'Técnico'
                       when 'presupuesto' then 'Presupuesto' else 'Aprobaciones' end), ', ')
    into v_missing
    from jsonb_array_elements(public._planning_status(p_event)) e where not (e ->> 'ready')::boolean;
  if v_missing is null then
    perform public._log(p_event, 'planning_updated', format('Venció el plazo de %s h con todo completo.', v_hours),
      1, 'event', p_event, '{}'::jsonb, false, v_me);
    return false;
  end if;
  perform public._raise_alert(p_event, 4, 'planning_deadline', 'La productora no cumplió con los 5 elementos mínimos',
    format('A %s h del evento falta: %s. Eso pone en riesgo el evento.', v_hours, v_missing), 'event', p_event, v_me);
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Permisos de ejecución
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'public.attach_tech_doc(uuid, text, text)', 'public.request_tech_na(uuid)', 'public.review_tech_na(uuid, boolean)',
    'public.set_tech_item(uuid, text, text)',
    'public.open_budget_extras(uuid, boolean)', 'public.request_budget_extra(uuid, text, text)', 'public.decide_budget_extra(uuid, boolean)',
    'public.set_planning_deadline(uuid, int)', 'public.apply_planning_deadline(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;


-- ===================== 20261207000014_backend_y_express.sql =====================
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


-- ===================== 20261208000015_permisos_explicitos.sql =====================
-- MANDO · Permisos explícitos para el rol «authenticated» (decisión 49).
--
-- Los proyectos nuevos de Supabase ya no dan acceso automático a las tablas del esquema public:
-- sin estos permisos la app responde «permission denied for table …» aunque la persona haya entrado.
--
-- Esto NO relaja la seguridad por fila: cada tabla sigue con RLS y sin políticas de escritura,
-- así que solo se lee lo que las políticas dejan y todo se escribe por las funciones.
-- Quien no ha iniciado sesión (anon) no recibe ningún permiso sobre las tablas.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Funciones que usa la app. Quedan fuera las internas (empiezan con «_»), los disparadores
-- y las dos que ya estaban cerradas a propósito.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname not like '\_%'
       and p.proname not in ('event_role_of', 'run_clock_rules_all')
       and p.prorettype <> 'trigger'::regtype
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('grant execute on function %s to authenticated', r.fn);
  end loop;
end $$;
grant execute on function public.invitation_pending(text) to anon;

-- Lo que se cree más adelante nace con los mismos permisos.
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;


-- ===================== 20261209000016_casting_ficha_documento_cargos.sql =====================
-- MANDO · Migración 16 · Semáforo de casting, mini ficha, tipo de documento y catálogo de cargos (decisiones 50 a 53).
--
--   1. Casting con semáforo: cada persona queda Aprobada (verde), Backup (ámbar) o No admitida (rojo).
--      Nadie se retira del casting: la persona queda guardada con su veredicto.
--   2. Mini ficha: edad, talla, estatura, habilidad y demás datos de selección viajan con cada elemento.
--   3. Tipo de documento: DNI (8 dígitos exactos), carnet de extranjería o pasaporte.
--   4. Catálogo de cargos: la productora propone un cargo nuevo y el backend lo aprueba para toda la organización.
-- Toda tabla nueva tiene seguridad por fila y su prueba en tests/db. La bitácora sigue sin poder editarse.

-- ---------------------------------------------------------------------------
-- 1 · Casting: veredicto y mini ficha
-- ---------------------------------------------------------------------------

alter table event_approvals drop constraint if exists event_approvals_status_check;
alter table event_approvals add constraint event_approvals_status_check
  check (status in ('pending', 'approved', 'changes_requested', 'backup', 'rejected'));
alter table event_approvals add column if not exists profile jsonb not null default '{}'::jsonb;

-- La ficha es un objeto chico de textos: nada de listas ni objetos anidados.
create or replace function public._clean_profile(p_profile jsonb) returns jsonb
language plpgsql immutable as $$
declare v_out jsonb;
begin
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    return '{}'::jsonb;
  end if;
  select coalesce(jsonb_object_agg(left(trim(e.key), 40), left(trim(e.value #>> '{}'), 120)), '{}'::jsonb) into v_out
  from jsonb_each(p_profile) e
  where jsonb_typeof(e.value) in ('string', 'number', 'boolean') and trim(e.key) <> '' and trim(e.value #>> '{}') <> '';
  if (select count(*) from jsonb_object_keys(v_out)) > 30 then
    raise exception 'La ficha tiene demasiados datos.' using errcode = '22023';
  end if;
  return v_out;
end $$;

drop function if exists public.add_approval_item(uuid, text, text, text, text, text);
create or replace function public.add_approval_item(
  p_event uuid, p_group text, p_name text, p_detail text default null, p_file_path text default null,
  p_sha256 text default null, p_profile jsonb default null
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

  insert into event_approvals (event_id, group_key, code, name, detail, file_path, sha256, profile, created_by)
  values (p_event, p_group, v_code, trim(p_name), nullif(trim(coalesce(p_detail, '')), ''), v_path, p_sha256,
          public._clean_profile(p_profile), v_me)
  returning id into v_id;
  perform public._log(p_event, 'approval_updated',
    format('%s subió %s «%s» para aprobación.', public._actor_name(v_me), v_code, trim(p_name)),
    1, 'approval', v_id, jsonb_build_object('group', p_group, 'status', 'pending'), true, v_me);
  return v_id;
end $$;

-- Corregir la mini ficha no cambia el veredicto.
create or replace function public.set_approval_profile(p_item uuid, p_profile jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_approvals;
begin
  select * into v from event_approvals where id = p_item and removed_at is null for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._require_coordinator(v.event_id);
  update event_approvals set profile = public._clean_profile(p_profile) where id = v.id;
  perform public._log(v.event_id, 'approval_updated',
    format('%s actualizó la ficha de %s «%s».', public._actor_name(v_me), v.code, v.name),
    1, 'approval', v.id, jsonb_build_object('group', v.group_key, 'profile', true), false, v_me);
end $$;

-- Reemplazar vuelve el elemento a «por aprobar». En casting nadie se retira: se marca No admitido.
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
    if v.group_key = 'casting' then
      raise exception 'En casting nadie se retira: la persona queda guardada. Márcala como No admitido.' using errcode = '22023';
    end if;
    update event_approvals set removed_at = now() where id = v.id;
    perform public._log(v.event_id, 'approval_updated',
      format('%s retiró %s «%s».', public._actor_name(v_me), v.code, v.name),
      1, 'approval', v.id, jsonb_build_object('group', v.group_key, 'removed', true), true, v_me);
  else
    raise exception 'Acción desconocida.' using errcode = '22023';
  end if;
end $$;

-- El semáforo. Decide el cliente, o el backend en su nombre. p_verdict: 'approved' | 'backup' | 'rejected'.
create or replace function public.decide_casting(p_item uuid, p_verdict text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_approvals;
  v_role event_role;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_word text;
begin
  select * into v from event_approvals where id = p_item and removed_at is null for update;
  if not found or v_me is null then
    raise exception 'No tienes permiso para decidir esto.' using errcode = '42501';
  end if;
  v_role := public.my_event_role(v.event_id);
  if v_role is null then
    raise exception 'No tienes permiso para decidir esto.' using errcode = '42501';
  end if;
  if v_role = 'producer' then
    raise exception 'El veredicto lo da el cliente.' using errcode = '42501';
  end if;
  if (select status from events where id = v.event_id) = 'closed' then
    raise exception 'El evento está cerrado: ya no acepta cambios.' using errcode = '42501';
  end if;
  if v.group_key <> 'casting' then
    raise exception 'El semáforo es solo para el casting.' using errcode = '22023';
  end if;
  v_word := case p_verdict when 'approved' then 'Aprobado' when 'backup' then 'Backup' when 'rejected' then 'No admitido' end;
  if v_word is null then
    raise exception 'Elige Aprobado, Backup o No admitido.' using errcode = '22023';
  end if;
  if v.status = p_verdict then
    return;
  end if;

  update event_approvals set status = p_verdict, decision_note = v_note, decided_by = v_me, decided_at = now() where id = v.id;
  perform public._log(v.event_id, 'approval_updated',
    format('%s marcó %s «%s» como %s%s', public._actor_name(v_me), v.code, v.name, v_word,
           case when v_note is null then '.' else ': ' || v_note end),
    case when p_verdict = 'rejected' then 2 else 1 end, 'approval', v.id,
    jsonb_build_object('group', v.group_key, 'status', p_verdict, 'version', v.version, 'on_behalf', v_role = 'backend'), true, v_me);
end $$;

-- Lo que falta. Casting: nadie por revisar y al menos una persona aprobada. El resto: todo aprobado.
create or replace function public._approvals_missing(p_event uuid) returns text
language sql stable security definer set search_path = public as $$
  select string_agg(
           case when t.total = 0 then g.name || ': falta subirlo'
                when t.open > 0 then g.name || ': ' || t.open || ' por aprobar'
                else g.name || ': falta al menos una persona aprobada' end,
           '; ' order by g.ord)
  from events e
  cross join lateral unnest(e.approval_groups) with ordinality as u(key, ord0)
  join (values ('casting', 'Casting', 1), ('uniforme', 'Uniforme', 2), ('utileria', 'Utilería', 3), ('referencias', 'Referencias visuales', 4))
       as g(key, name, ord) on g.key = u.key
  cross join lateral (
    select count(*) as total,
           count(*) filter (where case when u.key = 'casting' then a.status in ('pending', 'changes_requested') else a.status <> 'approved' end) as open,
           count(*) filter (where a.status = 'approved') as approved
    from event_approvals a where a.event_id = e.id and a.group_key = u.key and a.removed_at is null
  ) t
  where e.id = p_event and (t.total = 0 or t.open > 0 or t.approved = 0)
$$;

-- El aviso de «todo aprobado» sale con la última decisión, sea cual sea su color.
create or replace function public._approvals_notice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('approved', 'backup', 'rejected') and old.status is distinct from new.status
     and public._approvals_missing(new.event_id) is null then
    perform public._system_notice(new.event_id, 'Aprobaste todo. El evento puede arrancar.');
    if not exists (select 1 from jsonb_array_elements(public._planning_status(new.event_id)) e where not (e ->> 'ready')::boolean) then
      perform public._system_notice(new.event_id, 'Planificación completa. El evento quedó desbloqueado.');
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Tipo de documento de identidad
-- ---------------------------------------------------------------------------

alter table people add column if not exists doc_type text not null default 'dni';
alter table people drop constraint if exists people_doc_type_check;
alter table people add constraint people_doc_type_check check (doc_type in ('dni', 'ce', 'pasaporte'));
alter table people drop constraint if exists people_organization_id_doc_number_key;
alter table people drop constraint if exists people_org_doc_key;
alter table people add constraint people_org_doc_key unique (organization_id, doc_type, doc_number);

-- Devuelve el número limpio, o falla con el motivo. DNI: 8 dígitos exactos.
create or replace function public._check_doc(p_type text, p_number text) returns text
language plpgsql immutable as $$
declare v text := upper(nullif(regexp_replace(coalesce(p_number, ''), '[\s.\-]', '', 'g'), ''));
begin
  if p_type not in ('dni', 'ce', 'pasaporte') then
    raise exception 'Elige el tipo de documento: DNI, carnet de extranjería o pasaporte.' using errcode = '22023';
  end if;
  if v is null then
    return null;
  end if;
  if p_type = 'dni' and v !~ '^[0-9]{8}$' then
    raise exception 'El DNI tiene exactamente 8 números.' using errcode = '22023';
  elsif p_type = 'ce' and v !~ '^[A-Z0-9]{9,12}$' then
    raise exception 'El carnet de extranjería tiene de 9 a 12 letras o números.' using errcode = '22023';
  elsif p_type = 'pasaporte' and v !~ '^[A-Z0-9]{6,12}$' then
    raise exception 'El pasaporte tiene de 6 a 12 letras o números.' using errcode = '22023';
  end if;
  return v;
end $$;

drop function if exists public.save_person(uuid, uuid, text, text, date, text, text, text, text);
-- Registrar o corregir a una persona. Si el documento ya está en la base, se actualiza esa ficha: nadie se registra dos veces.
create or replace function public.save_person(
  p_event uuid, p_person uuid, p_full_name text, p_doc_number text default null, p_doc_expires_on date default null,
  p_phone text default null, p_default_role text default null, p_photo_path text default null, p_doc_path text default null,
  p_doc_type text default 'dni'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_org uuid;
  v_id uuid := p_person;
  v_type text := coalesce(nullif(trim(coalesce(p_doc_type, '')), ''), 'dni');
  v_doc text;
  v_photo text := nullif(trim(coalesce(p_photo_path, '')), '');
  v_copy text := nullif(trim(coalesce(p_doc_path, '')), '');
begin
  perform public._require_planner(p_event);
  select organization_id into v_org from events where id = p_event;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Escribe el nombre completo.' using errcode = '22023';
  end if;
  v_doc := public._check_doc(v_type, p_doc_number);
  perform public._check_person_file(v_org, v_photo);
  perform public._check_person_file(v_org, v_copy);
  if v_id is null and v_doc is not null then
    select id into v_id from people where organization_id = v_org and doc_type = v_type and doc_number = v_doc;
  end if;
  if v_id is null then
    insert into people (organization_id, full_name, doc_type, doc_number, doc_expires_on, phone, default_role, photo_path, doc_path, created_by)
    values (v_org, trim(p_full_name), v_type, v_doc, p_doc_expires_on, nullif(trim(coalesce(p_phone, '')), ''),
            nullif(trim(coalesce(p_default_role, '')), ''), v_photo, v_copy, v_me)
    returning id into v_id;
  else
    update people set
      full_name = trim(p_full_name),
      doc_type = case when v_doc is null then doc_type else v_type end,
      doc_number = coalesce(v_doc, doc_number),
      doc_expires_on = coalesce(p_doc_expires_on, doc_expires_on),
      phone = coalesce(nullif(trim(coalesce(p_phone, '')), ''), phone),
      default_role = coalesce(nullif(trim(coalesce(p_default_role, '')), ''), default_role),
      photo_path = coalesce(v_photo, photo_path),
      doc_path = coalesce(v_copy, doc_path),
      updated_at = now()
    where id = v_id and organization_id = v_org;
    if not found then
      raise exception 'Esa persona no está en la base de esta organización.' using errcode = '42501';
    end if;
  end if;
  return v_id;
end $$;

drop function if exists public.event_people_board(uuid);
-- La lista que ve la pantalla. Niveles 1 y 2: toda la base, con documento. Niveles 3 y 4: solo el personal del evento, sin datos personales.
create or replace function public.event_people_board(p_event uuid)
returns table (person_id uuid, full_name text, default_role text, role text, assigned boolean, photo_path text,
               doc_state text, doc_number text, doc_expires_on date, doc_path text, phone text, doc_type text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_full boolean := public._my_level(p_event) <= 2;   -- también exige ser del equipo
  v_day date := public._event_day(p_event);
begin
  return query
    select p.id, p.full_name, p.default_role, ep.role, ep.person_id is not null, p.photo_path,
           public._person_doc_state(p, v_day),
           case when v_full then p.doc_number end, case when v_full then p.doc_expires_on end,
           case when v_full then p.doc_path end, case when v_full then p.phone end,
           case when v_full then p.doc_type end
    from people p
    join events e on e.id = p_event and e.organization_id = p.organization_id
    left join event_people ep on ep.event_id = p_event and ep.person_id = p.id
    where v_full or ep.person_id is not null
    order by (ep.person_id is null), p.full_name;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Catálogo de cargos: la productora propone, el backend aprueba
-- ---------------------------------------------------------------------------

create table if not exists role_catalog (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null check (length(trim(name)) between 2 and 60),
  name_key        text not null,                       -- en minúsculas y sin espacios de más: evita repetidos
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  proposed_by     uuid references profiles(id),
  proposed_event  uuid references events(id) on delete set null,
  reviewed_by     uuid references profiles(id),
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (organization_id, name_key)
);

-- Quién aprueba cargos: el administrador de la organización o el backend de alguno de sus eventos.
create or replace function public.can_review_roles(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_org_admin(p_org)
      or exists (select 1 from event_members m join events e on e.id = m.event_id
                 where e.organization_id = p_org and m.profile_id = auth.uid() and m.role = 'backend')
$$;

alter table role_catalog enable row level security;
-- Lo lee quien maneja la base de personas de la organización o aprueba sus cargos. Se escribe con las funciones de abajo.
drop policy if exists role_catalog_read on role_catalog;
create policy role_catalog_read on role_catalog for select to authenticated
  using (public.can_manage_people(organization_id) or public.can_review_roles(organization_id));

-- Proponer un cargo nuevo. Si ya existe, devuelve el que hay.
create or replace function public.propose_role(p_event uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_org uuid;
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_key text;
  v_id uuid;
begin
  perform public._require_planner(p_event);
  if length(v_name) < 2 or length(v_name) > 60 then
    raise exception 'Escribe el cargo (de 2 a 60 letras).' using errcode = '22023';
  end if;
  v_key := lower(v_name);
  select organization_id into v_org from events where id = p_event;
  select id into v_id from role_catalog where organization_id = v_org and name_key = v_key;
  if v_id is not null then
    return v_id;
  end if;
  insert into role_catalog (organization_id, name, name_key, proposed_by, proposed_event)
  values (v_org, v_name, v_key, v_me, p_event) returning id into v_id;
  perform public._log(p_event, 'planning_updated',
    format('%s propuso el cargo «%s». Espera la aprobación del backend.', public._actor_name(v_me), v_name),
    1, 'role', v_id, jsonb_build_object('status', 'pending'), false, v_me);
  return v_id;
end $$;

create or replace function public.review_role(p_role uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v role_catalog;
begin
  select * into v from role_catalog where id = p_role for update;
  if not found or v_me is null or not public.can_review_roles(v.organization_id) then
    raise exception 'Los cargos nuevos los aprueba el backend.' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'Indica si apruebas el cargo.' using errcode = '22023';
  end if;
  update role_catalog set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = v_me, reviewed_at = now()
    where id = v.id;
  if v.proposed_event is not null then
    perform public._log(v.proposed_event, 'planning_updated',
      format('%s %s el cargo «%s»%s', public._actor_name(v_me), case when p_approve then 'aprobó' else 'no aprobó' end, v.name,
             case when p_approve then ': ya está en el catálogo de todos.' else '.' end),
      1, 'role', v.id, jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end), false, v_me);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Permisos
-- ---------------------------------------------------------------------------

grant select on role_catalog to authenticated;
grant all on role_catalog to service_role;

revoke execute on function public._clean_profile(jsonb) from public, anon, authenticated;
revoke execute on function public._check_doc(text, text) from public, anon, authenticated;
revoke execute on function public._approvals_missing(uuid) from public, anon, authenticated;
revoke execute on function public._approvals_notice() from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.add_approval_item(uuid, text, text, text, text, text, jsonb)',
    'public.set_approval_profile(uuid, jsonb)',
    'public.update_approval_item(uuid, text, text, text, text, text)',
    'public.decide_casting(uuid, text, text)',
    'public.save_person(uuid, uuid, text, text, date, text, text, text, text, text)',
    'public.event_people_board(uuid)',
    'public.can_review_roles(uuid)',
    'public.propose_role(uuid, text)',
    'public.review_role(uuid, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- El usuario de ejemplo se llama como el rol que ve Fer en pantalla: Backend.
update profiles set full_name = 'Backend de ejemplo' where full_name = 'Torre de control de ejemplo';


-- ===================== 20261210000017_banco_de_talentos.sql =====================
-- MANDO · Migración 17 · Banco de talentos (decisiones 55 a 58).
--
--   1. La base de personas de la organización pasa a ser un banco de talentos: cada persona guarda sus
--      categorías (anfitriona, modelo, host...), su mini ficha y la constancia de que autorizó guardar sus datos.
--      Se reconoce por tipo y número de documento, en todos los eventos.
--   2. Del banco al casting con un toque: la persona entra con su foto y su ficha al casting del evento.
--   3. Importar una lista (CSV de la castinera) y exportar el banco.
-- No hay tablas nuevas: se amplían people y event_approvals, que ya tienen seguridad por fila. Los datos
-- personales siguen visibles solo para quienes manejan la base (niveles 1 y 2). Pruebas en tests/db/talentos.test.ts.

alter table people add column if not exists categories text[] not null default '{}';
alter table people add column if not exists profile jsonb not null default '{}'::jsonb;
alter table people add column if not exists consent_at timestamptz;
alter table people add column if not exists consent_by uuid references profiles(id);
alter table people add column if not exists source text not null default 'manual';
alter table people drop constraint if exists people_source_check;
alter table people add constraint people_source_check check (source in ('manual', 'csv'));
create index if not exists people_categories_idx on people using gin (categories);

alter table event_approvals add column if not exists person_id uuid references people(id) on delete set null;
create index if not exists event_approvals_person_idx on event_approvals (person_id) where person_id is not null;

-- Categorías limpias: en minúsculas, sin repetidos, hasta 12.
create or replace function public._clean_categories(p_categories text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(c order by c), '{}')
  from (select distinct left(lower(regexp_replace(trim(x), '\s+', ' ', 'g')), 40) as c
        from unnest(coalesce(p_categories, '{}')) x where trim(x) <> '' limit 12) t
$$;

-- ---------------------------------------------------------------------------
-- 1 · Guardar un talento
-- ---------------------------------------------------------------------------

-- Registrar o actualizar. Si el documento ya está en el banco, se actualiza esa ficha: vuelve con sus datos.
-- La mini ficha se suma a la que había (lo nuevo pisa lo viejo, lo que no se manda se conserva).
create or replace function public.save_talent(
  p_event uuid, p_person uuid, p_full_name text, p_doc_type text default 'dni', p_doc_number text default null,
  p_categories text[] default null, p_profile jsonb default null, p_phone text default null,
  p_photo_path text default null, p_consent boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_org uuid;
  v_id uuid := p_person;
  v_new boolean := false;
  v_type text := coalesce(nullif(trim(coalesce(p_doc_type, '')), ''), 'dni');
  v_doc text;
  v_photo text := nullif(trim(coalesce(p_photo_path, '')), '');
  v_name text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_cats text[] := public._clean_categories(p_categories);
  v_profile jsonb := public._clean_profile(p_profile);
begin
  perform public._require_planner(p_event);
  select organization_id into v_org from events where id = p_event;
  if v_name = '' then
    raise exception 'Escribe el nombre completo.' using errcode = '22023';
  end if;
  v_doc := public._check_doc(v_type, p_doc_number);
  perform public._check_person_file(v_org, v_photo);
  if v_id is null and v_doc is not null then
    select id into v_id from people where organization_id = v_org and doc_type = v_type and doc_number = v_doc;
  end if;
  if v_id is null then
    if not coalesce(p_consent, false) then
      raise exception 'Confirma que la persona autorizó guardar sus datos y su foto.' using errcode = '22023';
    end if;
    insert into people (organization_id, full_name, doc_type, doc_number, phone, photo_path, categories, profile, consent_at, consent_by, created_by)
    values (v_org, v_name, v_type, v_doc, nullif(trim(coalesce(p_phone, '')), ''), v_photo, v_cats, v_profile, now(), v_me, v_me)
    returning id into v_id;
    v_new := true;
  else
    update people set
      full_name = v_name,
      doc_type = case when v_doc is null then doc_type else v_type end,
      doc_number = coalesce(v_doc, doc_number),
      phone = coalesce(nullif(trim(coalesce(p_phone, '')), ''), phone),
      photo_path = coalesce(v_photo, photo_path),
      categories = case when p_categories is null then categories else v_cats end,
      profile = profile || v_profile,
      consent_at = case when coalesce(p_consent, false) and consent_at is null then now() else consent_at end,
      consent_by = case when coalesce(p_consent, false) and consent_at is null then v_me else consent_by end,
      updated_at = now()
    where id = v_id and organization_id = v_org;
    if not found then
      raise exception 'Esa persona no está en el banco de esta organización.' using errcode = '42501';
    end if;
  end if;
  perform public._log(p_event, 'planning_updated',
    format('%s %s a %s en el banco de talentos.', public._actor_name(v_me), case when v_new then 'registró' else 'actualizó' end, v_name),
    1, 'person', v_id, jsonb_build_object('talent', true, 'new', v_new), false, v_me);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Leer el banco. Solo quienes manejan la base (niveles 1 y 2).
-- ---------------------------------------------------------------------------

create or replace function public.talent_bank(p_event uuid)
returns table (person_id uuid, full_name text, doc_type text, doc_number text, phone text, photo_path text, categories text[],
               profile jsonb, default_role text, consent boolean, events int, in_casting boolean, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_planner(p_event);
  return query
    select p.id, p.full_name, p.doc_type, p.doc_number, p.phone, p.photo_path, p.categories, p.profile, p.default_role,
           p.consent_at is not null,
           (select count(distinct x.event_id)::int from (
              select ep.event_id from event_people ep where ep.person_id = p.id
              union all
              select a.event_id from event_approvals a where a.person_id = p.id and a.removed_at is null) x),
           exists (select 1 from event_approvals a where a.event_id = p_event and a.person_id = p.id and a.removed_at is null),
           p.updated_at
    from people p join events e on e.id = p_event and e.organization_id = p.organization_id
    order by p.full_name;
end $$;

-- Buscar por documento: «si vuelvo a escribir el DNI de Mayra, vuelve con sus datos».
create or replace function public.find_talent(p_event uuid, p_doc_type text, p_doc_number text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_doc text; v_id uuid;
begin
  perform public._require_planner(p_event);
  v_doc := public._check_doc(coalesce(p_doc_type, 'dni'), p_doc_number);
  if v_doc is null then
    return null;
  end if;
  select p.id into v_id from people p join events e on e.id = p_event and e.organization_id = p.organization_id
   where p.doc_type = coalesce(p_doc_type, 'dni') and p.doc_number = v_doc;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Del banco al casting
-- ---------------------------------------------------------------------------

create or replace function public.add_casting_from_talent(p_event uuid, p_person uuid, p_detail text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v people;
  v_id uuid;
  v_n int;
  v_code text;
begin
  perform public._require_planner(p_event);
  if (select status from events where id = p_event) = 'closed' then
    raise exception 'El evento está cerrado: ya no acepta cambios.' using errcode = '42501';
  end if;
  select p.* into v from people p join events e on e.organization_id = p.organization_id where p.id = p_person and e.id = p_event;
  if not found then
    raise exception 'Esa persona no está en el banco de esta organización.' using errcode = '42501';
  end if;
  if exists (select 1 from event_approvals where event_id = p_event and person_id = p_person and removed_at is null) then
    raise exception '% ya está en el casting de este evento.', v.full_name using errcode = '22023';
  end if;
  perform 1 from events where id = p_event for update;   -- un código a la vez
  select count(*) + 1 into v_n from event_approvals where event_id = p_event and group_key = 'casting';
  v_code := 'C-' || lpad(v_n::text, 2, '0');
  insert into event_approvals (event_id, group_key, code, name, detail, file_path, profile, person_id, created_by)
  values (p_event, 'casting', v_code, v.full_name,
          coalesce(nullif(trim(coalesce(p_detail, '')), ''), initcap(v.categories[1]), v.default_role),
          v.photo_path, v.profile, v.id, v_me)
  returning id into v_id;
  perform public._log(p_event, 'approval_updated',
    format('%s sumó a %s al casting desde el banco de talentos (%s).', public._actor_name(v_me), v.full_name, v_code),
    1, 'approval', v_id, jsonb_build_object('group', 'casting', 'status', 'pending', 'talent', true), true, v_me);
  return v_id;
end $$;

-- La foto de una persona del banco la ve también el cliente del evento donde esa persona está en casting.
create or replace function public.can_read_person_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  if split_part(p_name, '/', 1) <> 'personas' or split_part(p_name, '/', 3) not in ('foto', 'dni')
     or split_part(p_name, '/', 2) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_org := split_part(p_name, '/', 2)::uuid;
  if public.can_manage_people(v_org) then return true; end if;
  if split_part(p_name, '/', 3) <> 'foto' then return false; end if;
  return exists (select 1 from event_members m join events e on e.id = m.event_id
                 where e.organization_id = v_org and m.profile_id = auth.uid() and m.role <> 'viewer')
      or exists (select 1 from event_approvals a
                 where a.file_path = p_name and a.removed_at is null and public.is_event_member(a.event_id));
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Importar una lista
-- ---------------------------------------------------------------------------

-- p_rows: [{ "nombre": "...", "tipo": "dni", "documento": "...", "telefono": "...", "categorias": ["modelo"], "ficha": {...} }]
-- Devuelve cuántas se crearon, cuántas se actualizaron y qué filas se saltó, con el motivo.
create or replace function public.import_talents(p_event uuid, p_rows jsonb, p_consent boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_org uuid;
  r jsonb;
  v_n int := 0;
  v_created int := 0;
  v_updated int := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_name text; v_type text; v_doc text; v_id uuid; v_cats text[]; v_profile jsonb; v_phone text;
begin
  perform public._require_planner(p_event);
  select organization_id into v_org from events where id = p_event;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'La lista está vacía.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'La lista tiene más de 500 personas. Divídela en partes.' using errcode = '22023';
  end if;
  if not coalesce(p_consent, false) then
    raise exception 'Confirma que estas personas autorizaron guardar sus datos.' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_n := v_n + 1;
    v_name := regexp_replace(trim(coalesce(r ->> 'nombre', '')), '\s+', ' ', 'g');
    if v_name = '' then
      v_skipped := v_skipped || jsonb_build_object('fila', v_n, 'motivo', 'Falta el nombre');
      continue;
    end if;
    v_type := coalesce(nullif(trim(coalesce(r ->> 'tipo', '')), ''), 'dni');
    begin
      v_doc := public._check_doc(v_type, r ->> 'documento');
    exception when sqlstate '22023' then
      v_skipped := v_skipped || jsonb_build_object('fila', v_n, 'motivo', v_name || ': ' || sqlerrm);
      continue;
    end;
    v_cats := public._clean_categories(array(select jsonb_array_elements_text(
                case when jsonb_typeof(r -> 'categorias') = 'array' then r -> 'categorias' else '[]'::jsonb end)));
    v_profile := public._clean_profile(r -> 'ficha');
    v_phone := nullif(trim(coalesce(r ->> 'telefono', '')), '');

    v_id := null;
    if v_doc is not null then
      select id into v_id from people where organization_id = v_org and doc_type = v_type and doc_number = v_doc;
    else
      -- Sin documento: la misma persona es la que tiene el mismo nombre y tampoco tiene documento.
      select id into v_id from people where organization_id = v_org and doc_number is null and lower(full_name) = lower(v_name) limit 1;
    end if;
    if v_id is null then
      insert into people (organization_id, full_name, doc_type, doc_number, phone, categories, profile, consent_at, consent_by, source, created_by)
      values (v_org, v_name, v_type, v_doc, v_phone, v_cats, v_profile, now(), v_me, 'csv', v_me);
      v_created := v_created + 1;
    else
      update people set full_name = v_name, phone = coalesce(v_phone, phone),
        categories = public._clean_categories(categories || v_cats), profile = profile || v_profile,
        consent_at = coalesce(consent_at, now()), consent_by = coalesce(consent_by, v_me), updated_at = now()
      where id = v_id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  perform public._log(p_event, 'planning_updated',
    format('%s importó una lista al banco de talentos: %s nuevas, %s actualizadas, %s sin entrar.',
           public._actor_name(v_me), v_created, v_updated, jsonb_array_length(v_skipped)),
    1, 'event', p_event, jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', jsonb_array_length(v_skipped)), false, v_me);
  return jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped);
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Permisos
-- ---------------------------------------------------------------------------

revoke execute on function public._clean_categories(text[]) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.save_talent(uuid, uuid, text, text, text, text[], jsonb, text, text, boolean)',
    'public.talent_bank(uuid)',
    'public.find_talent(uuid, text, text)',
    'public.add_casting_from_talent(uuid, uuid, text)',
    'public.can_read_person_file(text)',
    'public.import_talents(uuid, jsonb, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;


-- ===================== 20261211000018_cadena_de_mando.sql =====================
-- MANDO · Migración 18 · Cadena de mando, visibilidad por persona, marcas y tercerización (decisiones 59 a 64).
--
--   1. Cadena de mando: cada persona del equipo puede tener un área, un mando al que reporta y su visibilidad.
--      Un mando central puede tener 8, 12 o 20 submandos bajo el mismo evento.
--   2. Visibilidad: «completa» (todo el evento), «area» (solo las actividades de su área) o «propia» (solo lo suyo).
--      Lo decide la base de datos, no la pantalla. Un submando nunca ve presupuesto, casting, expediente ajeno,
--      citados ni avisos al cliente: ve su mando, como un MANDO Express del equipo.
--   3. Marcas del evento: logos del cliente, de la agencia y de la productora. Modalidad del evento: directo,
--      de agencia o tercerizado.
--   4. Cambios de emergencia: 48 h, 24 h o último minuto. Solo se agregan; quedan en la bitácora.
--   5. Lista de ingreso para el local, con documento y cargo.
-- Toda tabla nueva tiene seguridad por fila y su prueba en tests/db. La bitácora sigue sin poder editarse.

alter type log_kind add value if not exists 'command_set';
alter type log_kind add value if not exists 'emergency_change';
alter type log_kind add value if not exists 'brand_updated';

-- ---------------------------------------------------------------------------
-- 1 · Esquema
-- ---------------------------------------------------------------------------

alter table event_members add column if not exists area_id uuid references areas(id) on delete set null;
alter table event_members add column if not exists reports_to uuid references profiles(id);
alter table event_members add column if not exists visibility text not null default 'completa'
  check (visibility in ('completa', 'area', 'propia'));
-- Los productores (niveles 1 y 2) siempre ven todo: limitar lo que alguien ve es para coordinación y técnicos.
-- Así, todo permiso que ya dependía del nivel (banco de talentos, documentos, presupuesto) sigue valiendo igual.
alter table event_members drop constraint if exists event_members_visibility_level;
alter table event_members add constraint event_members_visibility_level
  check (visibility = 'completa' or (role = 'producer' and level >= 3));
create index if not exists event_members_reports_idx on event_members (event_id, reports_to);

alter table invitations add column if not exists area_id uuid references areas(id) on delete set null;
alter table invitations add column if not exists reports_to uuid references profiles(id);
alter table invitations add column if not exists visibility text check (visibility in ('completa', 'area', 'propia'));

alter table events add column if not exists modality text not null default 'directo'
  check (modality in ('directo', 'agencia', 'tercerizado'));
alter table events add column if not exists agency_name text;

create table if not exists event_brands (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id) on delete cascade,
  kind       text not null check (kind in ('cliente', 'agencia', 'productora')),
  name       text not null check (length(trim(name)) between 1 and 80),
  file_path  text,                              -- logo en el cubo privado, <evento>/marcas/. null = solo el nombre
  sort_order int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists event_brands_name_idx on event_brands (event_id, kind, lower(name));

create table if not exists emergency_changes (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events(id) on delete cascade,
  kind         text not null check (kind in ('persona', 'proveedor', 'horario', 'locacion', 'otro')),
  time_window  text not null check (time_window in ('con_tiempo', '48h', '24h', 'ultimo_minuto')),
  title        text not null check (length(trim(title)) between 1 and 160),
  detail       text check (detail is null or length(detail) <= 1000),
  hours_before numeric(8, 1),                   -- horas que faltaban para el evento; negativo = ya empezó
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists emergency_changes_event_idx on emergency_changes (event_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2 · Quién ve qué
-- ---------------------------------------------------------------------------

-- Ve todo el evento: el backend y quien tiene visibilidad completa. El cliente nunca.
create or replace function public.sees_all(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_members m
                 where m.event_id = p_event and m.profile_id = auth.uid()
                   and m.role <> 'viewer' and (m.role = 'backend' or m.visibility = 'completa'))
$$;

-- Una actividad de la hoja de ruta. El submando ve las de su área, las que tiene a su cargo y los hitos
-- del evento (necesita saber a qué hora abren puertas).
create or replace function public.can_see_item(p_event uuid, p_area uuid, p_owner uuid, p_milestone boolean, p_visible boolean)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when m.role = 'viewer' then coalesce(p_visible, false)
      when m.role = 'backend' or m.visibility = 'completa' then true
      when p_owner = auth.uid() or coalesce(p_milestone, false) then true
      when m.visibility = 'area' then p_area is not null and p_area = m.area_id
      else false
    end
    from event_members m where m.event_id = p_event and m.profile_id = auth.uid()), false)
$$;

create or replace function public.can_see_item_id(p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.can_see_item(i.event_id, i.area_id, i.owner_id, i.is_milestone, i.visible_to_viewer)
                   from route_items i where i.id = p_item), false)
$$;

-- Lo que cuelga de una actividad (alertas, evidencias, bitácora, cambios, momentos): el cliente ve lo visible,
-- quien ve todo ve todo, y el submando ve lo que hizo él y lo de las actividades que le tocan.
create or replace function public.can_see_scoped(p_event uuid, p_visible boolean, p_actor uuid, p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when m.role = 'viewer' then coalesce(p_visible, false)
      when m.role = 'backend' or m.visibility = 'completa' then true
      else coalesce(p_actor = auth.uid(), false) or (p_item is not null and public.can_see_item_id(p_item))
    end
    from event_members m where m.event_id = p_event and m.profile_id = auth.uid()), false)
$$;

drop policy if exists route_items_read on route_items;
create policy route_items_read on route_items for select to authenticated
  using (public.can_see_item(event_id, area_id, owner_id, is_milestone, visible_to_viewer));

drop policy if exists alerts_read on alerts;
create policy alerts_read on alerts for select to authenticated
  using (public.can_see_scoped(event_id, visible_to_viewer, raised_by, case when entity_type = 'route_item' then entity_id end));

drop policy if exists evidences_read on evidences;
create policy evidences_read on evidences for select to authenticated
  using (public.can_see_scoped(event_id, visible_to_viewer, captured_by, route_item_id));

drop policy if exists log_read on log_entries;
create policy log_read on log_entries for select to authenticated
  using (public.can_see_scoped(event_id, visible_to_viewer, actor_id, case when entity_type = 'route_item' then entity_id end));

drop policy if exists change_requests_read on change_requests;
create policy change_requests_read on change_requests for select to authenticated
  using (public.can_see_scoped(event_id, false, requested_by, item_id));

drop policy if exists moments_read on critical_moments;
create policy moments_read on critical_moments for select to authenticated
  using (public.can_see_scoped(event_id, false, opened_by, route_item_id));

-- Los compromisos se ven si se ve su momento (la subconsulta pasa por la política de arriba).
drop policy if exists commitments_read on commitments;
create policy commitments_read on commitments for select to authenticated
  using (public.sees_all(event_id)
         or (public.is_event_team(event_id) and exists (select 1 from critical_moments m where m.id = moment_id)));

-- Expediente: contratos, facturas y seguros. El submando solo ve lo que le toca subir o lo que subió.
drop policy if exists event_requirements_read on event_requirements;
create policy event_requirements_read on event_requirements for select to authenticated
  using (public.sees_all(event_id)
         or (public.is_event_team(event_id) and (owner_id = auth.uid() or done_by = auth.uid())));

-- Citados (teléfonos y correos), casting y avisos al cliente: solo quien ve todo. El cliente sigue viendo lo suyo.
drop policy if exists event_guests_read on event_guests;
create policy event_guests_read on event_guests for select to authenticated using (public.sees_all(event_id));

drop policy if exists event_approvals_read on event_approvals;
create policy event_approvals_read on event_approvals for select to authenticated
  using (public.sees_all(event_id) or public.my_event_role(event_id) = 'viewer');

drop policy if exists client_notices_read on client_notices;
create policy client_notices_read on client_notices for select to authenticated
  using (public.sees_all(event_id) or public.my_event_role(event_id) = 'viewer');

-- Presupuesto: además del nivel, hace falta visibilidad completa. Un submando nunca ve montos.
create or replace function public.can_see_budget(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_members m where m.event_id = p_event and m.profile_id = auth.uid()
                 and (m.role = 'viewer' or m.role = 'backend'
                      or (coalesce(m.level, 4) <= 2 and m.visibility = 'completa')))
$$;
create or replace function public.can_see_budget_lines(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_members m where m.event_id = p_event and m.profile_id = auth.uid()
                 and (m.role = 'backend'
                      or (m.role = 'producer' and coalesce(m.level, 4) <= 2 and m.visibility = 'completa'
                          and coalesce((select breakdown_visible from event_budgets b where b.event_id = p_event), false))))
$$;

-- Lo que dejaron los demás en la encuesta de cierre: niveles 1 y 2 con visibilidad completa.
create or replace function public.can_read_feedback(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from event_members
    where event_id = p_event and profile_id = auth.uid() and role <> 'viewer' and level is not null and level <= 2
      and (role = 'backend' or visibility = 'completa')
  );
$$;

-- La base de personas y el banco de talentos: igual, niveles 1 y 2 con visibilidad completa.
create or replace function public.can_manage_people(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_org_admin(p_org)
      or exists (select 1 from event_members m join events e on e.id = m.event_id
                 where e.organization_id = p_org and m.profile_id = auth.uid()
                   and m.role <> 'viewer' and coalesce(m.level, 4) <= 2
                   and (m.role = 'backend' or m.visibility = 'completa'))
$$;

-- Archivos del cubo privado. Antes todo el equipo leía cualquier archivo del evento; ahora el submando lee
-- solo los de las evidencias que ve, los documentos que le tocan y los logos.
create or replace function public.can_read_evidence_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_event uuid;
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_event := split_part(p_name, '/', 1)::uuid;
  return public.sees_all(v_event)
      or exists (select 1 from evidences ev
                 where ev.file_path = p_name and ev.event_id = v_event
                   and public.can_see_scoped(ev.event_id, ev.visible_to_viewer, ev.captured_by, ev.route_item_id))
      or (public.is_event_team(v_event)
          and exists (select 1 from event_requirements r
                      where r.file_path = p_name and r.event_id = v_event
                        and (r.owner_id = auth.uid() or r.done_by = auth.uid())));
end $$;

create or replace function public.can_read_approval_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_event uuid;
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 2) <> 'aprobaciones' then
    return false;
  end if;
  v_event := split_part(p_name, '/', 1)::uuid;
  return public.sees_all(v_event) or coalesce(public.my_event_role(v_event) = 'viewer', false);
end $$;

-- Un submando solo marca «en curso» o «cumplida» las actividades de su mando.
create or replace function public._route_items_scope_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.status is distinct from old.status and new.status in ('in_progress', 'done')
     and public.is_event_team(old.event_id)
     and not public.can_see_item(old.event_id, old.area_id, old.owner_id, old.is_milestone, old.visible_to_viewer) then
    raise exception 'Esa actividad no es de tu mando.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists route_items_scope_guard on route_items;
create trigger route_items_scope_guard before update of status on route_items
  for each row execute function public._route_items_scope_guard();

-- Tampoco pide cambios sobre actividades que no ve.
create or replace function public._change_requests_scope_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.item_id is not null and public.is_event_team(new.event_id)
     and not public.can_see_item_id(new.item_id) then
    raise exception 'Esa actividad no es de tu mando.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists change_requests_scope_guard on change_requests;
create trigger change_requests_scope_guard before insert on change_requests
  for each row execute function public._change_requests_scope_guard();

-- Las invitaciones las ve el backend y quien las hizo.
drop policy if exists invitations_read on invitations;
create policy invitations_read on invitations for select to authenticated
  using (public.is_event_backend(event_id) or (invited_by = auth.uid() and public.sees_all(event_id)));

-- ---------------------------------------------------------------------------
-- 3 · Armar la cadena de mando
-- ---------------------------------------------------------------------------

-- Busca el área por nombre dentro del evento; si no existe, la crea.
create or replace function public._area_by_name(p_event uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_name text := nullif(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), ''); v_id uuid;
begin
  if v_name is null then return null; end if;
  if length(v_name) > 60 then
    raise exception 'El nombre del área es muy largo.' using errcode = '22023';
  end if;
  select id into v_id from areas where event_id = p_event and lower(name) = lower(v_name) limit 1;
  if v_id is null then
    insert into areas (event_id, name, sort_order)
    values (p_event, v_name, coalesce((select max(sort_order) from areas where event_id = p_event), 0) + 1)
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- ¿Puede quien llama dar mando a alguien de ese nivel? El backend, siempre. El productor de campo con
-- visibilidad completa, solo a coordinación y técnicos (niveles 3 y 4): sus submandos.
create or replace function public._can_command(p_event uuid, p_target_level int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_members m
                 where m.event_id = p_event and m.profile_id = auth.uid()
                   and (m.role = 'backend'
                        or (m.role = 'producer' and m.level = 2 and m.visibility = 'completa' and coalesce(p_target_level, 0) >= 3)))
$$;

-- El mando al que reporta tiene que ser del equipo, con igual o mayor jerarquía, y sin cerrar un círculo.
create or replace function public._check_reports_to(p_event uuid, p_profile uuid, p_level int, p_reports_to uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_boss event_members; v_cursor uuid := p_reports_to; v_steps int := 0;
begin
  if p_reports_to is null then return; end if;
  select * into v_boss from event_members where event_id = p_event and profile_id = p_reports_to;
  if not found or v_boss.role = 'viewer' or p_reports_to = p_profile or coalesce(v_boss.level, 4) > coalesce(p_level, 4) then
    raise exception 'El mando tiene que ser alguien del equipo con igual o mayor jerarquía.' using errcode = '22023';
  end if;
  while v_cursor is not null and v_steps < 50 loop
    if v_cursor = p_profile then
      raise exception 'Esa persona ya está bajo el mando de quien quieres asignarle.' using errcode = '22023';
    end if;
    select reports_to into v_cursor from event_members where event_id = p_event and profile_id = v_cursor;
    v_steps := v_steps + 1;
  end loop;
end $$;

create or replace function public._visibility_label(p_visibility text) returns text
language sql immutable as $$
  select case p_visibility when 'completa' then 'todo el evento' when 'area' then 'solo su área' else 'solo lo suyo' end
$$;

-- Definir el área, el mando y la visibilidad de una persona del equipo.
create or replace function public.set_member_command(
  p_event uuid, p_profile uuid, p_area text, p_reports_to uuid, p_visibility text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_target event_members; v_area uuid;
begin
  perform public._require_team(p_event);
  select * into v_target from event_members where event_id = p_event and profile_id = p_profile;
  if not found or v_target.role = 'viewer' then
    raise exception 'Esa persona no es del equipo.' using errcode = '22023';
  end if;
  if not public._can_command(p_event, v_target.level) then
    raise exception 'La cadena de mando la arma el backend o el productor a cargo.' using errcode = '42501';
  end if;
  if p_visibility is null or p_visibility not in ('completa', 'area', 'propia') then
    raise exception 'Elige qué ve esta persona.' using errcode = '22023';
  end if;
  if v_target.role = 'backend' and p_visibility <> 'completa' then
    raise exception 'El backend siempre ve todo el evento.' using errcode = '22023';
  end if;
  if coalesce(v_target.level, 4) <= 2 and p_visibility <> 'completa' then
    raise exception 'Un productor ve todo el evento. Para limitar lo que ve, dale un cargo de coordinación o técnico.' using errcode = '22023';
  end if;
  perform public._check_reports_to(p_event, p_profile, v_target.level, p_reports_to);
  v_area := public._area_by_name(p_event, p_area);
  if p_visibility = 'area' and v_area is null then
    raise exception 'Para ver solo su área, primero dile cuál es su área.' using errcode = '22023';
  end if;

  update event_members set area_id = v_area, reports_to = p_reports_to, visibility = p_visibility
   where event_id = p_event and profile_id = p_profile;

  perform public._log(p_event, 'command_set',
    format('%s definió el mando de %s: área %s, reporta a %s, ve %s.',
           public._actor_name(v_me), public._actor_name(p_profile),
           coalesce((select name from areas where id = v_area), 'sin área'),
           coalesce(public._actor_name(p_reports_to), 'el mando central'),
           public._visibility_label(p_visibility)),
    1, 'member', p_profile, jsonb_build_object('area_id', v_area, 'reports_to', p_reports_to, 'visibility', p_visibility), false, v_me);
end $$;

-- Invitar: ahora también con área, mando y visibilidad. El productor de campo puede invitar a sus submandos.
drop function if exists public.invite_to_event(uuid, text, text, text, event_role, smallint);
create or replace function public.invite_to_event(
  p_event uuid, p_email text, p_full_name text, p_title text, p_role event_role, p_level smallint default null,
  p_area text default null, p_reports_to uuid default null, p_visibility text default null
) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_me uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user uuid;
  v_inv uuid;
  v_event_name text;
  v_is_backend boolean := public.is_event_backend(p_event);
  v_area uuid;
  v_boss uuid := p_reports_to;
  v_visibility text := p_visibility;
begin
  if p_event is null or not (v_is_backend or (p_role = 'producer' and public._can_command(p_event, p_level))) then
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

  -- Lo que ve: si no se dice, sale del nivel. Productores, todo; coordinación, su área; técnicos, lo suyo.
  if p_role = 'viewer' then
    v_visibility := null; v_boss := null;
  else
    if v_visibility is null then
      v_visibility := case when p_level <= 2 then 'completa' when p_level = 3 then 'area' else 'propia' end;
    end if;
    if v_visibility not in ('completa', 'area', 'propia') then
      raise exception 'Elige qué ve esta persona.' using errcode = '22023';
    end if;
    if p_level <= 2 and v_visibility <> 'completa' then
      raise exception 'Un productor ve todo el evento. Para limitar lo que ve, dale un cargo de coordinación o técnico.' using errcode = '22023';
    end if;
    if v_boss is null and not v_is_backend then v_boss := v_me; end if;   -- quien invita a su submando es su mando
    perform public._check_reports_to(p_event, null, p_level, v_boss);
    v_area := public._area_by_name(p_event, p_area);
    if v_visibility = 'area' and v_area is null then v_visibility := 'propia'; end if;  -- sin área todavía: ve solo lo suyo
  end if;

  if exists (select 1 from invitations where event_id = p_event and email = v_email and revoked_at is null) then
    raise exception 'Esa persona ya tiene una invitación a este evento.' using errcode = '23505';
  end if;

  select id into v_user from auth.users where lower(email) = v_email limit 1;
  if v_user is not null and exists (select 1 from event_members where event_id = p_event and profile_id = v_user) then
    raise exception 'Esa persona ya es parte del equipo.' using errcode = '23505';
  end if;

  insert into invitations (event_id, email, full_name, role, title, level, invited_by, accepted_at, accepted_by, area_id, reports_to, visibility)
  values (p_event, v_email, trim(p_full_name), p_role, trim(p_title), p_level, v_me,
          case when v_user is not null then now() end, v_user, v_area, v_boss, v_visibility)
  returning id into v_inv;

  if v_user is not null then
    insert into event_members (event_id, profile_id, role, title, level, invited_by, area_id, reports_to, visibility)
    values (p_event, v_user, p_role, trim(p_title), p_level, v_me, v_area, v_boss, coalesce(v_visibility, 'completa'));
  end if;

  select name into v_event_name from events where id = p_event;
  perform public._log(p_event, 'member_invited',
    format('%s invitó a %s como %s.', public._actor_name(v_me), trim(p_full_name), trim(p_title)),
    1, 'invitation', v_inv,
    jsonb_build_object('role', p_role, 'level', p_level, 'area_id', v_area, 'reports_to', v_boss, 'visibility', v_visibility), false, v_me);

  return jsonb_build_object('invitation_id', v_inv, 'joined', v_user is not null, 'event_name', v_event_name);
end $$;

-- Retirar una invitación: el backend, o quien la hizo.
create or replace function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_event uuid; v_by uuid;
begin
  select event_id, invited_by into v_event, v_by from invitations where id = p_invitation;
  if v_event is null or not (public.is_event_backend(v_event) or (v_by = auth.uid() and public.sees_all(v_event))) then
    raise exception 'Solo el productor general del evento puede retirar invitaciones.' using errcode = '42501';
  end if;
  update invitations set revoked_at = now()
   where id = p_invitation and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'Esa invitación ya fue aceptada o retirada.' using errcode = '22023';
  end if;
end $$;

-- Al entrar con su código, la persona se une con el área, el mando y la visibilidad que le dieron.
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
    insert into profiles (id, full_name) values (v_me, v_inv.full_name)
    on conflict (id) do update set full_name = excluded.full_name
      where profiles.full_name = split_part(v_email, '@', 1);

    insert into event_members (event_id, profile_id, role, title, level, invited_by, area_id, reports_to, visibility)
    values (v_inv.event_id, v_me, v_inv.role, v_inv.title, v_inv.level, v_inv.invited_by, v_inv.area_id,
            -- si su mando ya no está en el equipo, queda bajo el mando central
            (select m.profile_id from event_members m where m.event_id = v_inv.event_id and m.profile_id = v_inv.reports_to and m.role <> 'viewer'),
            coalesce(v_inv.visibility, 'completa'))
    on conflict (event_id, profile_id) do nothing;

    update invitations set accepted_at = now(), accepted_by = v_me where id = v_inv.id;
    perform public._log(v_inv.event_id, 'member_joined',
      format('%s activó su mando como %s.', public._actor_name(v_me), v_inv.title),
      1, 'invitation', v_inv.id, '{}'::jsonb, false, v_me);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- La cadena de mando que ve la pantalla. Quien ve todo, ve a todo el equipo. El submando ve su propia fila,
-- a su mando y a quienes tiene a cargo. El cliente no ve nada.
create or replace function public.command_chain(p_event uuid)
returns table (profile_id uuid, full_name text, title text, role event_role, level smallint, area_id uuid, area_name text,
               reports_to uuid, reports_to_name text, visibility text, subordinates int, active boolean)
language sql stable security definer set search_path = public as $$
  select m.profile_id, p.full_name, m.title, m.role, m.level, m.area_id, a.name, m.reports_to, b.full_name, m.visibility,
         (select count(*) from event_members s where s.event_id = m.event_id and s.reports_to = m.profile_id)::int,
         m.welcomed_at is not null
  from event_members m
  join profiles p on p.id = m.profile_id
  left join areas a on a.id = m.area_id
  left join profiles b on b.id = m.reports_to
  where m.event_id = p_event and m.role <> 'viewer'
    and (public.sees_all(p_event)
         or (public.is_event_team(p_event)
             and (m.profile_id = auth.uid() or m.reports_to = auth.uid()
                  or m.profile_id = (select me.reports_to from event_members me where me.event_id = p_event and me.profile_id = auth.uid()))))
  order by coalesce(m.level, 9), p.full_name
$$;

-- ---------------------------------------------------------------------------
-- 4 · Marcas del evento y modalidad
-- ---------------------------------------------------------------------------

alter table event_brands enable row level security;
-- Las marcas las ve todo miembro del evento: es su evento. Se escriben solo con las funciones de abajo.
drop policy if exists event_brands_read on event_brands;
create policy event_brands_read on event_brands for select to authenticated using (public.is_event_member(event_id));

create or replace function public.add_event_brand(p_event uuid, p_kind text, p_name text, p_file_path text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_name text := nullif(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  v_path text := nullif(trim(coalesce(p_file_path, '')), '');
  v_id uuid;
begin
  perform public._require_team(p_event);
  if not public.is_event_backend(p_event) then
    raise exception 'Las marcas del evento las carga el backend.' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('cliente', 'agencia', 'productora') then
    raise exception 'Elige si la marca es del cliente, de la agencia o de la productora.' using errcode = '22023';
  end if;
  if v_name is null or length(v_name) > 80 then
    raise exception 'Escribe el nombre de la marca.' using errcode = '22023';
  end if;
  if v_path is not null and v_path not like p_event::text || '/marcas/%' then
    raise exception 'El logo no pertenece a este evento.' using errcode = '22023';
  end if;

  select id into v_id from event_brands where event_id = p_event and kind = p_kind and lower(name) = lower(v_name);
  if v_id is null then
    insert into event_brands (event_id, kind, name, file_path, sort_order, created_by)
    values (p_event, p_kind, v_name, v_path,
            coalesce((select max(sort_order) from event_brands where event_id = p_event), 0) + 1, v_me)
    returning id into v_id;
  else
    update event_brands set name = v_name, file_path = coalesce(v_path, file_path) where id = v_id;
  end if;

  perform public._log(p_event, 'brand_updated',
    format('%s cargó la marca «%s» (%s).', public._actor_name(v_me), v_name, p_kind),
    1, 'brand', v_id, jsonb_build_object('kind', p_kind, 'logo', v_path is not null), false, v_me);
  return v_id;
end $$;

create or replace function public.remove_event_brand(p_brand uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v event_brands;
begin
  select * into v from event_brands where id = p_brand;
  if not found or not public.is_event_backend(v.event_id) then
    raise exception 'Las marcas del evento las carga el backend.' using errcode = '42501';
  end if;
  perform public._require_team(v.event_id);
  delete from event_brands where id = v.id;
  perform public._log(v.event_id, 'brand_updated',
    format('%s quitó la marca «%s».', public._actor_name(v_me), v.name),
    1, 'brand', v.id, jsonb_build_object('kind', v.kind, 'removed', true), false, v_me);
end $$;

-- Directo, de agencia o tercerizado. Si hay agencia, se guarda su nombre.
create or replace function public.set_event_modality(p_event uuid, p_modality text, p_agency text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_agency text := nullif(trim(coalesce(p_agency, '')), '');
begin
  perform public._require_team(p_event);
  if not public.is_event_backend(p_event) then
    raise exception 'La modalidad del evento la define el backend.' using errcode = '42501';
  end if;
  if p_modality is null or p_modality not in ('directo', 'agencia', 'tercerizado') then
    raise exception 'Elige la modalidad del evento.' using errcode = '22023';
  end if;
  if length(coalesce(v_agency, '')) > 80 then
    raise exception 'El nombre de la agencia es muy largo.' using errcode = '22023';
  end if;
  update events set modality = p_modality, agency_name = case when p_modality = 'directo' then null else v_agency end
   where id = p_event;
  perform public._log(p_event, 'note',
    format('%s marcó el evento como %s%s.', public._actor_name(v_me),
           case p_modality when 'directo' then 'directo con el cliente' when 'agencia' then 'evento de agencia' else 'tercerización' end,
           case when p_modality <> 'directo' and v_agency is not null then ' (' || v_agency || ')' else '' end),
    1, 'event', p_event, jsonb_build_object('modality', p_modality, 'agency', v_agency), false, v_me);
end $$;

-- Logos: <evento>/marcas/. Los sube el backend (PNG, JPG o WebP); los ve todo miembro del evento.
create or replace function public.can_upload_brand_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_event uuid;
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 2) <> 'marcas' or p_name !~* '\.(png|jpe?g|webp)$' then
    return false;
  end if;
  v_event := split_part(p_name, '/', 1)::uuid;
  return public.is_event_backend(v_event) and coalesce((select status from events where id = v_event) <> 'closed', false);
end $$;

create or replace function public.can_read_brand_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 2) <> 'marcas' then
    return false;
  end if;
  return public.is_event_member(split_part(p_name, '/', 1)::uuid);
end $$;

-- La subida general de evidencias no sirve para la carpeta de marcas: ahí solo entra el backend.
create or replace function public.can_upload_evidence_file(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_event uuid;
begin
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 2) in ('', 'marcas') then
    return false;
  end if;
  v_event := split_part(p_name, '/', 1)::uuid;
  return public.is_event_team(v_event)
     and coalesce((select status from events where id = v_event) <> 'closed', false);
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Cambios de emergencia
-- ---------------------------------------------------------------------------

alter table emergency_changes enable row level security;
-- Los ve quien ve todo el evento, y cada quien los que reportó. Solo se agregan.
drop policy if exists emergency_changes_read on emergency_changes;
create policy emergency_changes_read on emergency_changes for select to authenticated
  using (public.sees_all(event_id) or (created_by = auth.uid() and public.is_event_team(event_id)));

create or replace function public._forbid_emergency_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'Los cambios de emergencia no se editan ni se borran.' using errcode = '42501';
end $$;
drop trigger if exists emergency_changes_no_update on emergency_changes;
create trigger emergency_changes_no_update before update or delete on emergency_changes
  for each row execute function public._forbid_emergency_mutation();

-- Reportar un cambio de emergencia. La ventana la calcula el servidor con la hora del evento:
-- más de 48 h = con tiempo; hasta 48 h; hasta 24 h; a 2 h o menos (o con el evento en marcha) = último minuto.
create or replace function public.report_emergency_change(p_event uuid, p_kind text, p_title text, p_detail text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_title text := nullif(regexp_replace(trim(coalesce(p_title, '')), '\s+', ' ', 'g'), '');
  v_detail text := nullif(trim(coalesce(p_detail, '')), '');
  v_hours numeric;
  v_window text;
  v_label text;
  v_level int;
  v_id uuid;
begin
  perform public._require_team(p_event);
  if public._my_level(p_event) > 3 then
    raise exception 'Los cambios de emergencia los reporta producción o coordinación.' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('persona', 'proveedor', 'horario', 'locacion', 'otro') then
    raise exception 'Elige qué cambia.' using errcode = '22023';
  end if;
  if v_title is null or length(v_title) > 160 then
    raise exception 'Cuenta en una línea qué cambia.' using errcode = '22023';
  end if;
  if length(coalesce(v_detail, '')) > 1000 then
    raise exception 'El detalle es muy largo.' using errcode = '22023';
  end if;

  select round(extract(epoch from (starts_at - now())) / 3600.0, 1) into v_hours from events where id = p_event;
  v_window := case when v_hours is null or v_hours > 48 then 'con_tiempo'
                   when v_hours > 24 then '48h' when v_hours > 2 then '24h' else 'ultimo_minuto' end;
  v_label := case v_window when 'con_tiempo' then 'con tiempo' when '48h' then '48 h antes'
                           when '24h' then '24 h antes' else 'último minuto' end;
  v_level := case v_window when '48h' then 1 when '24h' then 2 when 'ultimo_minuto' then 3 end;

  insert into emergency_changes (event_id, kind, time_window, title, detail, hours_before, created_by)
  values (p_event, p_kind, v_window, v_title, v_detail, v_hours, v_me)
  returning id into v_id;

  if v_level is not null then
    perform public._raise_alert(p_event, v_level, null, format('Cambio de emergencia · %s', v_label),
      v_title, 'emergency_change', v_id, v_me);
  end if;
  perform public._log(p_event, 'emergency_change',
    format('%s reportó un cambio de emergencia (%s): %s', public._actor_name(v_me), v_label, v_title),
    coalesce(v_level, 1), 'emergency_change', v_id,
    jsonb_build_object('kind', p_kind, 'window', v_window, 'hours_before', v_hours), false, v_me);
  return jsonb_build_object('id', v_id, 'window', v_window);
end $$;

-- ---------------------------------------------------------------------------
-- 6 · Lista de ingreso y responsable por defecto
-- ---------------------------------------------------------------------------

-- La lista que pide el local: quién viene, con qué documento y qué cargo. Lleva datos personales:
-- solo niveles 1 y 2 con visibilidad completa.
create or replace function public.access_list(p_event uuid)
returns table (full_name text, doc_type text, doc_number text, role text, doc_state text)
language plpgsql stable security definer set search_path = public as $$
declare v_day date := public._event_day(p_event);
begin
  if not exists (select 1 from event_members m where m.event_id = p_event and m.profile_id = auth.uid()
                 and m.role <> 'viewer' and coalesce(m.level, 4) <= 2 and (m.role = 'backend' or m.visibility = 'completa')) then
    raise exception 'La lista de ingreso la exporta el productor general o el productor de campo.' using errcode = '42501';
  end if;
  return query
    select p.full_name, p.doc_type, p.doc_number, ep.role, public._person_doc_state(p, v_day)
    from event_people ep join people p on p.id = ep.person_id
    where ep.event_id = p_event
    order by ep.role, p.full_name;
end $$;

-- El responsable de un documento es quien lo sube, salvo que ya se haya asignado a otra persona.
create or replace function public._requirements_default_owner() returns trigger
language plpgsql as $$
begin
  if new.status = 'done' and new.owner_id is null and new.done_by is not null then
    new.owner_id := new.done_by;
  end if;
  return new;
end $$;
drop trigger if exists event_requirements_default_owner on event_requirements;
create trigger event_requirements_default_owner before update on event_requirements
  for each row execute function public._requirements_default_owner();

-- ---------------------------------------------------------------------------
-- 7 · Permisos
-- ---------------------------------------------------------------------------

grant select on event_brands, emergency_changes to authenticated;
grant all on event_brands, emergency_changes to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public._route_items_scope_guard()', 'public._change_requests_scope_guard()', 'public._area_by_name(uuid, text)',
    'public._can_command(uuid, int)', 'public._check_reports_to(uuid, uuid, int, uuid)', 'public._visibility_label(text)',
    'public._forbid_emergency_mutation()', 'public._requirements_default_owner()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.sees_all(uuid)', 'public.can_see_item(uuid, uuid, uuid, boolean, boolean)', 'public.can_see_item_id(uuid)',
    'public.can_see_scoped(uuid, boolean, uuid, uuid)',
    'public.set_member_command(uuid, uuid, text, uuid, text)',
    'public.invite_to_event(uuid, text, text, text, event_role, smallint, text, uuid, text)',
    'public.revoke_invitation(uuid)', 'public.claim_invitations()', 'public.command_chain(uuid)',
    'public.add_event_brand(uuid, text, text, text)', 'public.remove_event_brand(uuid)',
    'public.set_event_modality(uuid, text, text)', 'public.can_upload_brand_file(text)', 'public.can_read_brand_file(text)',
    'public.report_emergency_change(uuid, text, text, text)', 'public.access_list(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists marcas_files_insert on storage.objects;
    create policy marcas_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'evidences' and public.can_upload_brand_file(name));
    drop policy if exists marcas_files_read on storage.objects;
    create policy marcas_files_read on storage.objects for select to authenticated
      using (bucket_id = 'evidences' and public.can_read_brand_file(name));
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table event_brands; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table emergency_changes; exception when duplicate_object then null; end;
  end if;
end $$;


-- ===================== 20261212000019_minuto_a_minuto_y_experiencia.sql =====================
-- MANDO · Migración 19 · Minuto a minuto, origen de los cambios, momentos wow y People Experience
-- (decisiones 65 a 69).
--
--   1. Cada cambio de la hoja de ruta lleva su origen: cliente, producción o eventualidad.
--   2. Cada cambio aplicado crea un «nuevo minuto a minuto»: una versión guardada, que no se edita.
--   3. Momento wow y Eventualidad: se capturan de un toque y quedan marcados para el cierre.
--   4. People Experience: los números del evento para explicar el resultado con datos.
--   5. Brief: hasta 10 000 letras, con sinopsis y documento adjunto.
-- Toda tabla nueva tiene seguridad por fila y su prueba en tests/db. La bitácora sigue sin poder editarse.

alter type log_kind add value if not exists 'route_version';
alter type log_kind add value if not exists 'moment_marked';

-- ---------------------------------------------------------------------------
-- 1 · Origen de los cambios y versiones del minuto a minuto
-- ---------------------------------------------------------------------------

alter table change_requests add column if not exists origin text check (origin in ('cliente', 'produccion', 'eventualidad'));

create table if not exists route_versions (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references events(id) on delete cascade,
  version           int not null check (version >= 2),      -- la 1 es el plan publicado
  origin            text check (origin in ('cliente', 'produccion', 'eventualidad')),
  reason            text,
  change_request_id uuid references change_requests(id),
  snapshot          jsonb not null,                          -- la hoja de ruta tal como quedó
  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now(),
  unique (event_id, version)
);

alter table route_versions enable row level security;
-- La versión guarda la hoja de ruta completa: la lee quien ve todo el evento.
drop policy if exists route_versions_read on route_versions;
create policy route_versions_read on route_versions for select to authenticated using (public.sees_all(event_id));

create or replace function public._origin_label(p_origin text) returns text
language sql immutable as $$
  select case p_origin when 'cliente' then 'pedido del cliente' when 'produccion' then 'producción'
                       when 'eventualidad' then 'eventualidad' else 'sin clasificar' end
$$;

-- Una versión solo cambia en su origen, cuando alguien clasifica el cambio después. Nunca se borra.
create or replace function public._route_versions_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' or new.snapshot is distinct from old.snapshot or new.version is distinct from old.version
     or new.event_id is distinct from old.event_id or new.created_at is distinct from old.created_at then
    raise exception 'Las versiones del minuto a minuto no se editan ni se borran.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists route_versions_guard on route_versions;
create trigger route_versions_guard before update or delete on route_versions
  for each row execute function public._route_versions_guard();

-- Al aplicarse un cambio, se guarda cómo quedó la hoja de ruta y se anota en la bitácora.
create or replace function public._change_requests_version() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_version int; v_id uuid;
begin
  if new.applied_at is null or old.applied_at is not null then return new; end if;
  v_version := coalesce((select max(version) from route_versions where event_id = new.event_id), 1) + 1;
  insert into route_versions (event_id, version, origin, reason, change_request_id, snapshot, created_by)
  values (new.event_id, v_version, new.origin, new.reason, new.id,
          (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', i.id, 'title', i.title, 'start', i.current_start, 'end', i.current_end,
                    'area', a.name, 'milestone', i.is_milestone, 'status', i.status)
                    order by i.current_start, i.sort_order), '[]'::jsonb)
           from route_items i left join areas a on a.id = i.area_id
           where i.event_id = new.event_id and i.status <> 'cancelled'),
          auth.uid())
  returning id into v_id;
  perform public._log(new.event_id, 'route_version',
    format('Nuevo minuto a minuto: versión %s. Origen: %s.', v_version, public._origin_label(new.origin)),
    null, 'route_version', v_id, jsonb_build_object('version', v_version, 'origin', new.origin), false, auth.uid());
  return new;
end $$;
drop trigger if exists change_requests_version on change_requests;
create trigger change_requests_version after update of applied_at on change_requests
  for each row execute function public._change_requests_version();

-- Clasificar un cambio: lo hace quien lo pidió, o producción (niveles 1 y 2). Sirve antes y después de aplicarlo.
create or replace function public.set_change_origin(p_request uuid, p_origin text) returns void
language plpgsql security definer set search_path = public as $$
declare v_req change_requests;
begin
  select * into v_req from change_requests where id = p_request for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._require_team(v_req.event_id);
  if v_req.requested_by <> auth.uid() and public._my_level(v_req.event_id) > 2 then
    raise exception 'El origen lo marca quien pidió el cambio o producción.' using errcode = '42501';
  end if;
  if p_origin is null or p_origin not in ('cliente', 'produccion', 'eventualidad') then
    raise exception 'Elige de dónde viene el cambio: cliente, producción o eventualidad.' using errcode = '22023';
  end if;
  update change_requests set origin = p_origin where id = p_request;
  update route_versions set origin = p_origin where change_request_id = p_request;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Momento wow y Eventualidad
-- ---------------------------------------------------------------------------

alter table evidences add column if not exists tag text check (tag in ('wow', 'eventualidad'));
create index if not exists evidences_tag_idx on evidences (event_id, tag) where tag is not null;

-- Un toque: foto (o una línea) marcada como momento wow o como eventualidad. El momento wow lo ve el cliente;
-- la eventualidad se queda con el equipo.
create or replace function public.mark_moment(
  p_event uuid, p_tag text, p_note text default null, p_file_path text default null,
  p_sha256 text default null, p_captured_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_path text := nullif(trim(coalesce(p_file_path, '')), '');
  v_id uuid;
begin
  perform public._require_team(p_event);
  if p_tag is null or p_tag not in ('wow', 'eventualidad') then
    raise exception 'Elige momento wow o eventualidad.' using errcode = '22023';
  end if;
  if p_tag = 'eventualidad' and v_note is null then
    raise exception 'Cuenta en una línea qué pasó.' using errcode = '22023';
  end if;
  if p_tag = 'wow' and v_path is null and v_note is null then
    raise exception 'Toma la foto del momento.' using errcode = '22023';
  end if;
  if length(coalesce(v_note, '')) > 500 then
    raise exception 'La nota es muy larga.' using errcode = '22023';
  end if;

  v_id := public.add_evidence(
    p_event => p_event, p_kind => (case when v_path is null then 'note' else 'photo' end)::evidence_kind,
    p_file_path => v_path, p_note => v_note, p_sha256 => p_sha256, p_captured_at => p_captured_at,
    p_visible => p_tag = 'wow');
  update evidences set tag = p_tag where id = v_id;

  perform public._log(p_event, 'moment_marked',
    format('%s marcó %s%s', public._actor_name(v_me),
           case p_tag when 'wow' then 'un momento wow' else 'una eventualidad' end, coalesce(': ' || v_note, '.')),
    case when p_tag = 'eventualidad' then 2 end, 'evidence', v_id, jsonb_build_object('tag', p_tag), p_tag = 'wow', v_me);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · People Experience: los números del evento
-- ---------------------------------------------------------------------------

-- Solo números, sin nombres. Los lee producción (niveles 1 y 2). `p_tolerance_min`: cuántos minutos de
-- demora todavía cuentan como «a tiempo».
create or replace function public.people_experience(p_event uuid, p_tolerance_min int default 10) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from event_members m where m.event_id = p_event and m.profile_id = auth.uid()
                 and m.role <> 'viewer' and coalesce(m.level, 4) <= 2) then
    raise exception 'El análisis del evento lo ve el productor general o el productor de campo.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'changes', (select coalesce(jsonb_object_agg(o, n), '{}'::jsonb)
                from (select coalesce(origin, 'sin_clasificar') as o, count(*) as n from change_requests
                      where event_id = p_event and applied_at is not null group by 1) t),
    'versions', (select coalesce(max(version), 1) from route_versions where event_id = p_event),
    'emergencies', (select coalesce(jsonb_object_agg(w, n), '{}'::jsonb)
                    from (select time_window as w, count(*) as n from emergency_changes where event_id = p_event group by 1) t),
    'wow', (select count(*) from evidences where event_id = p_event and tag = 'wow'),
    'eventualidades', (select count(*) from evidences where event_id = p_event and tag = 'eventualidad'),
    'items_total', (select count(*) from route_items where event_id = p_event and status <> 'cancelled'),
    'items_done', (select count(*) from route_items where event_id = p_event and status = 'done'),
    'items_started', (select count(*) from route_items where event_id = p_event and status <> 'cancelled' and actual_start is not null),
    'items_on_time', (select count(*) from route_items where event_id = p_event and status <> 'cancelled' and actual_start is not null
                      and actual_start <= planned_start + make_interval(mins => greatest(coalesce(p_tolerance_min, 10), 0))),
    'alerts_total', (select count(*) from alerts where event_id = p_event),
    'alerts_resolved', (select count(*) from alerts where event_id = p_event and status = 'resolved'),
    'mandos', (select count(*) from event_members where event_id = p_event and role <> 'viewer'),
    'field_people', (select count(*) from event_people where event_id = p_event),
    'client_stars', (select round(avg(stars), 1) from event_feedback where event_id = p_event and kind = 'satisfaction'),
    'learnings', (select count(*) from event_feedback where event_id = p_event and kind = 'learnings')
  );
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Brief: 10 000 letras, sinopsis y documento
-- ---------------------------------------------------------------------------

alter table event_briefs drop constraint if exists event_briefs_summary_check;
alter table event_briefs add constraint event_briefs_summary_check check (length(trim(summary)) between 1 and 10000);
alter table event_briefs add column if not exists synopsis text check (synopsis is null or length(synopsis) <= 600);
alter table event_briefs add column if not exists document_path text;
alter table event_briefs add column if not exists document_name text;

drop function if exists public.set_brief(uuid, text, text, text);
create or replace function public.set_brief(
  p_event uuid, p_summary text, p_objective text default null, p_attendees text default null,
  p_synopsis text default null, p_document_path text default null, p_document_name text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_summary text := nullif(trim(coalesce(p_summary, '')), '');
  v_synopsis text := nullif(trim(coalesce(p_synopsis, '')), '');
  v_path text := nullif(trim(coalesce(p_document_path, '')), '');
  v_version int;
begin
  perform public._require_team(p_event);
  if not public.is_event_backend(p_event) then
    raise exception 'El brief lo carga el backend.' using errcode = '42501';
  end if;
  if v_summary is null then
    raise exception 'Escribe el brief del evento.' using errcode = '22023';
  end if;
  if length(v_summary) > 10000 then
    raise exception 'El brief pasa de 10 000 letras. Resúmelo.' using errcode = '22023';
  end if;
  if length(coalesce(v_synopsis, '')) > 600 then
    raise exception 'La sinopsis pasa de 600 letras.' using errcode = '22023';
  end if;
  if v_path is not null and v_path not like p_event::text || '/brief/%' then
    raise exception 'El documento no pertenece a este evento.' using errcode = '22023';
  end if;
  insert into event_briefs (event_id, summary, objective, attendees, synopsis, document_path, document_name, updated_by)
  values (p_event, v_summary, nullif(trim(coalesce(p_objective, '')), ''), nullif(trim(coalesce(p_attendees, '')), ''),
          v_synopsis, v_path, case when v_path is not null then nullif(trim(coalesce(p_document_name, '')), '') end, v_me)
  on conflict (event_id) do update
    set version = event_briefs.version + 1, summary = excluded.summary, objective = excluded.objective,
        attendees = excluded.attendees, synopsis = excluded.synopsis,
        -- el documento se conserva si no se adjunta uno nuevo
        document_path = coalesce(excluded.document_path, event_briefs.document_path),
        document_name = case when excluded.document_path is not null then excluded.document_name else event_briefs.document_name end,
        updated_by = v_me, updated_at = now()
  returning version into v_version;
  perform public._log(p_event, 'brief_updated',
    format('%s %s el brief (versión %s).', public._actor_name(v_me),
           case when v_version = 1 then 'cargó' else 'corrigió' end, v_version),
    1, 'brief', p_event, jsonb_build_object('version', v_version, 'document', v_path is not null), false, v_me);
  return v_version;
end $$;

-- El documento del brief lo lee todo el equipo: es lo primero que cada persona tiene que conocer.
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
     and exists (select 1 from event_briefs b where b.event_id = v_event and b.document_path = p_name);
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Permisos
-- ---------------------------------------------------------------------------

grant all on route_versions to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public._origin_label(text)', 'public._route_versions_guard()', 'public._change_requests_version()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.set_change_origin(uuid, text)',
    'public.mark_moment(uuid, text, text, text, text, timestamptz)',
    'public.people_experience(uuid, int)',
    'public.set_brief(uuid, text, text, text, text, text, text)',
    'public.can_read_brief_file(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists brief_files_read on storage.objects;
    create policy brief_files_read on storage.objects for select to authenticated
      using (bucket_id = 'evidences' and public.can_read_brief_file(name));
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table route_versions; exception when duplicate_object then null; end;
  end if;
end $$;


-- ===================== 20261213000020_expediente_fortaleza.sql =====================
-- MANDO · Expediente como fortaleza (decisiones 74 a 77)
--
-- 1 · Tope de los documentos: lo que se pide antes del evento vence, como máximo, 48 horas antes de la hora clave.
-- 2 · Declaración jurada: quien sube un documento declara que es veraz y queda registrado con su hora.
-- 3 · Línea legal: con responsable asignado, solo esa persona sube el documento y solo el backend lo cambia o lo quita.
-- 4 · Presión: MANDO anota en la bitácora cuando a un documento le quedan 15, 7, 3 y 2 días, y cuando vence.
--
-- Es seguro ejecutarla más de una vez.

alter table event_requirements add column if not exists sworn_at timestamptz;      -- cuándo se declaró que el documento es veraz
alter table event_requirements add column if not exists pressure_mark int;         -- último umbral de presión anotado (días); 0 = vencido

-- ---------------------------------------------------------------------------
-- 1 · Tope: 48 horas antes de la hora clave (la plantilla del evento puede traer otro número)
-- ---------------------------------------------------------------------------

create or replace function public._requirement_cap(p_event uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select starts_at - make_interval(hours => coalesce(nullif(template ->> 'tope_documentos_horas', '')::int, 48))
  from events where id = p_event
$$;

create or replace function public._seed_event_requirements(p_event uuid, p_template jsonb, p_key_time timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cap timestamptz := p_key_time - make_interval(hours => coalesce(nullif(p_template ->> 'tope_documentos_horas', '')::int, 48));
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
              -- lo que se pide antes del evento nunca vence después del tope
              when coalesce((d.value ->> 'plazo_dias')::int, 0) <= 0
                then least(p_key_time + make_interval(days => coalesce((d.value ->> 'plazo_dias')::int, 0)), v_cap)
              else p_key_time + make_interval(days => (d.value ->> 'plazo_dias')::int) end,
         d.ordinality
  from jsonb_array_elements(p_template -> 'documentos') with ordinality d
  where coalesce(trim(d.value ->> 'titulo'), '') <> '' and coalesce(d.value ->> 'clave', '') <> ''
  on conflict do nothing;
end $$;

-- Documentos pendientes de eventos ya creados: los que vencían entre el tope y la hora clave pasan al tope.
update event_requirements r
  set due_at = public._requirement_cap(r.event_id)
  from events e
  where e.id = r.event_id and r.status = 'pending' and e.starts_at is not null and e.status <> 'closed'
    and r.due_at > public._requirement_cap(r.event_id) and r.due_at <= e.starts_at;

-- ---------------------------------------------------------------------------
-- 2 y 3 · Subir con declaración jurada; con responsable asignado, solo esa persona
-- ---------------------------------------------------------------------------

drop function if exists public.complete_requirement(uuid, text, text, text, text);
create or replace function public.complete_requirement(
  p_requirement uuid, p_file_path text default null, p_file_name text default null,
  p_sha256 text default null, p_note text default null, p_sworn boolean default false
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
  if v.owner_id is not null and v.owner_id <> v_me then
    raise exception 'Este documento está a cargo de %. Solo esa persona lo sube; el backend puede cambiar al responsable.',
      public._actor_name(v.owner_id) using errcode = '42501';
  end if;
  if v_path is null and v_note is null then
    raise exception 'Sube el archivo o escribe el dato.' using errcode = '22023';
  end if;
  if v_path is not null and v_path not like v.event_id::text || '/expediente/%' then
    raise exception 'El archivo no pertenece al expediente de este evento.' using errcode = '22023';
  end if;
  if not coalesce(p_sworn, false) then
    raise exception 'Falta tu declaración jurada: confirma que el documento es veraz y está verificado.' using errcode = '22023';
  end if;

  update event_requirements
    set status = 'done', file_path = coalesce(v_path, file_path), file_name = case when v_path is null then file_name else nullif(trim(p_file_name), '') end,
        sha256 = case when v_path is null then sha256 else p_sha256 end, note = coalesce(v_note, note),
        done_by = v_me, done_at = now(), sworn_at = now()
    where id = v.id;

  perform public._log(v.event_id, 'requirement_updated',
    format('%s subió «%s» al expediente y lo visó bajo declaración jurada.', public._actor_name(v_me), v.title),
    1, 'requirement', v.id, jsonb_build_object('status', 'done', 'sha256', p_sha256, 'sworn', true), false, v_me);
  perform public._resolve_requirement_alerts(v, 'El documento ya está en el expediente.');
end $$;

-- Responsable y plazo. Niveles 1 y 2 asignan; una vez asignado, solo el backend lo cambia o lo quita.
create or replace function public.plan_requirement(p_requirement uuid, p_owner uuid, p_due_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v event_requirements;
  e events;
  v_cap timestamptz;
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
  -- La línea legal no se quiebra: el responsable ya asignado solo lo cambia el backend.
  if v.owner_id is not null and v.owner_id is distinct from p_owner and not public.is_event_backend(v.event_id) then
    raise exception 'Este documento ya tiene responsable (%). Solo el backend puede cambiarlo o quitarlo.',
      public._actor_name(v.owner_id) using errcode = '42501';
  end if;
  -- Tope: lo que se pide antes del evento vence, como máximo, 48 horas antes.
  select * into e from events where id = v.event_id;
  v_cap := public._requirement_cap(v.event_id);
  -- Si se eligió el mismo día del tope, vale la hora del tope.
  if p_due_at is not null and v_cap is not null and p_due_at > v_cap
     and (p_due_at at time zone e.timezone)::date = (v_cap at time zone e.timezone)::date then
    p_due_at := v_cap;
  end if;
  if p_due_at is not null and v_cap is not null and p_due_at is distinct from v.due_at
     and p_due_at > v_cap and (v.due_at is null or v.due_at <= e.starts_at) then
    raise exception 'El plazo tope de los documentos es 48 horas antes del evento: hasta el %.',
      to_char(v_cap at time zone e.timezone, 'DD/MM HH24:MI') using errcode = '22023';
  end if;

  update event_requirements
    set owner_id = p_owner, due_at = p_due_at,
        pressure_mark = case when p_due_at is distinct from v.due_at then null else pressure_mark end
    where id = v.id;
  perform public._log(v.event_id, 'requirement_updated',
    case when v.owner_id is not null and v.owner_id is distinct from p_owner
      then format('%s cambió al responsable de «%s»: era %s y ahora es %s.', public._actor_name(v_me), v.title,
                  public._actor_name(v.owner_id), case when p_owner is null then 'quien lo suba' else public._actor_name(p_owner) end)
      else format('%s dejó «%s» a cargo de %s%s.', public._actor_name(v_me), v.title,
                  case when p_owner is null then 'quien lo suba' else public._actor_name(p_owner) end,
                  case when p_due_at is null then '' else format(', con plazo hasta el %s', to_char(p_due_at at time zone e.timezone, 'DD/MM')) end)
    end,
    1, 'requirement', v.id, jsonb_build_object('owner', p_owner, 'previous_owner', v.owner_id, 'due_at', p_due_at), false, v_me);
end $$;

create or replace function public.add_requirement(
  p_event uuid, p_title text, p_category text, p_due_at timestamptz default null, p_mandatory boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  e events;
  v_cap timestamptz;
begin
  if public._my_level(p_event) > 2 then
    raise exception 'Esto lo decide el productor general o el productor de campo.' using errcode = '42501';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Escribe el nombre del documento.' using errcode = '22023';
  end if;
  select * into e from events where id = p_event;
  v_cap := public._requirement_cap(p_event);
  if p_due_at is not null and v_cap is not null and p_due_at > v_cap
     and (p_due_at at time zone e.timezone)::date = (v_cap at time zone e.timezone)::date then
    p_due_at := v_cap;
  end if;
  if p_due_at is not null and v_cap is not null and p_due_at > v_cap and p_due_at <= coalesce(e.ends_at, e.starts_at) then
    raise exception 'El plazo tope de los documentos es 48 horas antes del evento: hasta el %.',
      to_char(v_cap at time zone e.timezone, 'DD/MM HH24:MI') using errcode = '22023';
  end if;
  insert into event_requirements (event_id, category, title, mandatory, due_at, sort_order)
  values (p_event, coalesce(nullif(p_category, ''), 'administracion'), trim(p_title), coalesce(p_mandatory, false),
          coalesce(p_due_at, v_cap), -- sin fecha, vale el tope
          coalesce((select max(sort_order) from event_requirements where event_id = p_event), 0) + 1)
  returning id into v_id;
  perform public._log(p_event, 'requirement_updated',
    format('%s agregó «%s» al expediente.', public._actor_name(v_me), trim(p_title)),
    1, 'requirement', v_id, '{}'::jsonb, false, v_me);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Presión en la bitácora: 15, 7, 3 y 2 días, y al vencer. Una sola anotación por umbral.
-- ---------------------------------------------------------------------------

create or replace function public._log_requirement_pressure(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  e events;
  v_now timestamptz := now();
  v_steps int[];
  v_left numeric;
  v_mark int;
  v_count int := 0;
  r event_requirements;
begin
  select * into e from events where id = p_event;
  if not found or e.status = 'closed' then
    return 0;
  end if;
  select coalesce(array_agg(x::int order by x::int desc), array[15, 7, 3, 2]) into v_steps
    from jsonb_array_elements_text(case when jsonb_typeof(e.template -> 'presion_dias') = 'array' then e.template -> 'presion_dias' else '[]'::jsonb end) x;
  if v_steps is null or cardinality(v_steps) = 0 then
    v_steps := array[15, 7, 3, 2];
  end if;

  for r in select * from event_requirements where event_id = p_event and status = 'pending' and due_at is not null for update loop
    v_left := extract(epoch from (r.due_at - v_now)) / 86400;
    if v_left < 0 then
      v_mark := 0;
    else
      select min(s) into v_mark from unnest(v_steps) s where v_left <= s;
    end if;
    if v_mark is null or (r.pressure_mark is not null and r.pressure_mark <= v_mark) then
      continue;
    end if;
    update event_requirements set pressure_mark = v_mark where id = r.id;
    perform public._log(p_event, 'requirement_updated',
      format('Presión: %s%s%s',
        case when v_mark = 0 then format('«%s» pasó su plazo del %s y sigue sin subirse.', r.title, to_char(r.due_at at time zone e.timezone, 'DD/MM'))
             when ceil(v_left) <= 1 then format('a «%s» le queda menos de 1 día de plazo.', r.title)
             else format('a «%s» le quedan %s días de plazo.', r.title, ceil(v_left)::int) end,
        case when r.mandatory then ' Es no negociable.' else '' end,
        case when r.owner_id is null then ' Aún no tiene responsable.' else format(' Responsable: %s.', public._actor_name(r.owner_id)) end),
      case when v_mark = 0 then 3 else 2 end, 'requirement', r.id,
      jsonb_build_object('pressure', v_mark, 'due_at', r.due_at), false, null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.evaluate_clock_rules(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_team(p_event);
  perform public._log_requirement_pressure(p_event);
  return public._evaluate_clock_rules(p_event) + public._evaluate_requirement_rules(p_event);
end $$;

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
    perform public._log_requirement_pressure(e.id);
    v_total := v_total + public._evaluate_requirement_rules(e.id);
  end loop;
  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'public._requirement_cap(uuid)', 'public._log_requirement_pressure(uuid)',
    'public._seed_event_requirements(uuid, jsonb, timestamptz)', 'public.run_clock_rules_all()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.complete_requirement(uuid, text, text, text, text, boolean)',
    'public.plan_requirement(uuid, uuid, timestamptz)',
    'public.add_requirement(uuid, text, text, timestamptz, boolean)',
    'public.evaluate_clock_rules(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Último minuto (decisión 80): lo que llega a última hora queda en la bitácora, con su comprobante
-- ---------------------------------------------------------------------------

alter table evidences drop constraint if exists evidences_tag_check;
alter table evidences add constraint evidences_tag_check check (tag in ('wow', 'eventualidad', 'ultimo_minuto'));

-- `p_kind` es la clave del tipo (config/ultimo-minuto.json) y `p_label` su nombre para la bitácora.
create or replace function public.last_minute(
  p_event uuid, p_kind text, p_label text, p_note text, p_file_path text default null,
  p_sha256 text default null, p_captured_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_path text := nullif(trim(coalesce(p_file_path, '')), '');
  v_label text := nullif(trim(coalesce(p_label, '')), '');
  v_id uuid;
begin
  perform public._require_team(p_event);
  if p_kind is null or p_kind !~ '^[a-z][a-z0-9-]{1,30}$' or v_label is null or length(v_label) > 60 then
    raise exception 'Elige qué quieres ingresar de último minuto.' using errcode = '22023';
  end if;
  if v_note is null then
    raise exception 'Cuenta en una línea qué llegó de último minuto.' using errcode = '22023';
  end if;
  if length(v_note) > 500 then
    raise exception 'La nota es muy larga.' using errcode = '22023';
  end if;

  v_id := public.add_evidence(
    p_event => p_event,
    p_kind => (case when v_path is null then 'note' when v_path ~* '\.(jpe?g|png|webp|heic|heif|gif)$' then 'photo' else 'document' end)::evidence_kind,
    p_file_path => v_path, p_note => format('%s: %s', v_label, v_note), p_sha256 => p_sha256, p_captured_at => p_captured_at,
    p_visible => false);
  update evidences set tag = 'ultimo_minuto' where id = v_id;

  perform public._log(p_event, 'moment_marked',
    format('Último minuto · %s: %s (%s%s)', v_label, v_note, public._actor_name(v_me),
           case when v_path is null then '' else ', con comprobante' end),
    2, 'evidence', v_id, jsonb_build_object('tag', 'ultimo_minuto', 'kind', p_kind, 'with_file', v_path is not null), false, v_me);
  return v_id;
end $$;

revoke execute on function public.last_minute(uuid, text, text, text, text, text, timestamptz) from public, anon;
grant execute on function public.last_minute(uuid, text, text, text, text, text, timestamptz) to authenticated, service_role;


-- ===================== 20261214000021_tipos_personalizados.sql =====================
-- MANDO · Migración 21 · Tipos de evento personalizados guardados (decisión 84).
--
-- El productor general arma un evento personalizado (nombre + componentes de config/personalizado.json)
-- y lo guarda para reusarlo. Se guarda en su organización: lo ven y lo usan solo los administradores
-- de esa organización (quienes crean eventos). Se escribe solo con las funciones de abajo.

create table if not exists custom_event_types (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null check (length(trim(name)) between 3 and 60),
  modules         text[] not null check (cardinality(modules) between 1 and 60),
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists custom_event_types_name_idx on custom_event_types (organization_id, lower(name));

alter table custom_event_types enable row level security;
drop policy if exists custom_event_types_read on custom_event_types;
create policy custom_event_types_read on custom_event_types for select to authenticated
  using (public.is_org_admin(organization_id));

-- Guarda (o actualiza, si ya hay uno con el mismo nombre) un tipo personalizado.
create or replace function public.save_custom_event_type(p_org uuid, p_name text, p_modules text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_name text := nullif(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  v_modules text[];
  v_id uuid;
begin
  if v_me is null or not public.is_org_admin(p_org) then
    raise exception 'Solo el productor general guarda tipos de evento.' using errcode = '42501';
  end if;
  if v_name is null or length(v_name) < 3 or length(v_name) > 60 then
    raise exception 'Ponle un nombre de 3 a 60 letras a tu tipo de evento.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct m order by m), '{}') into v_modules
  from unnest(coalesce(p_modules, '{}')) m
  where m ~ '^[a-z0-9-]{1,40}$';
  if cardinality(v_modules) = 0 or cardinality(v_modules) > 60 then
    raise exception 'Marca al menos un componente.' using errcode = '22023';
  end if;

  select id into v_id from custom_event_types where organization_id = p_org and lower(name) = lower(v_name);
  if v_id is null then
    insert into custom_event_types (organization_id, name, modules, created_by)
    values (p_org, v_name, v_modules, v_me) returning id into v_id;
  else
    update custom_event_types set name = v_name, modules = v_modules, updated_at = now() where id = v_id;
  end if;
  return v_id;
end $$;

-- Borra un tipo guardado. Los eventos ya creados con él no cambian: llevan su propia copia.
create or replace function public.delete_custom_event_type(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from custom_event_types where id = p_id;
  if v_org is null or not public.is_org_admin(v_org) then
    raise exception 'Solo el productor general borra tipos de evento.' using errcode = '42501';
  end if;
  delete from custom_event_types where id = p_id;
end $$;

grant select on custom_event_types to authenticated;
grant all on custom_event_types to service_role;
revoke execute on function public.save_custom_event_type(uuid, text, text[]) from public, anon;
revoke execute on function public.delete_custom_event_type(uuid) from public, anon;
grant execute on function public.save_custom_event_type(uuid, text, text[]) to authenticated, service_role;
grant execute on function public.delete_custom_event_type(uuid) to authenticated, service_role;


-- ===================== 20261215000022_brief_con_ia.sql =====================
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


-- ===================== 20261216000023_red_flag_con_documento.sql =====================
-- MANDO · Red flag de documento: se reconoce con un plazo y se resuelve adjuntando (decisión 93).
--
-- 1. «Reconocer» pide cuánto tiempo necesita la persona: queda en la bitácora a qué hora se comprometió.
-- 2. Una alerta de documento no se «marca resuelta» con una palabra: se resuelve solo cuando el documento
--    entra al expediente bajo declaración jurada (complete_requirement ya la cierra sola).
-- 3. La IA de MANDO revisa el documento adjuntado y da el pase. Si está vencido, no corresponde o no se lee, la bitácora lo dice
--    y el documento vuelve a pendiente: la red flag se vuelve a encender.
--
-- Nada se borra: la bitácora guarda el compromiso, el documento y la revisión.

-- ---------------------------------------------------------------------------
-- 1 · Reconocer con plazo
-- ---------------------------------------------------------------------------

create or replace function public.ack_alert_with_time(p_alert uuid, p_minutes int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  a alerts;
  e events;
  v_eta timestamptz;
  v_again boolean;
begin
  select * into a from alerts where id = p_alert for update;
  if not found then raise exception 'La alerta no existe.'; end if;
  perform public._require_team(a.event_id);
  if a.status = 'resolved' then raise exception 'La alerta ya está resuelta.'; end if;
  if p_minutes is null or p_minutes < 15 or p_minutes > 1440 then
    raise exception 'Elige entre 15 minutos y 24 horas.' using errcode = '22023';
  end if;
  select * into e from events where id = a.event_id;
  v_eta := now() + make_interval(mins => p_minutes);
  v_again := a.status = 'acknowledged';
  update alerts set status = 'acknowledged' where id = p_alert;
  perform public._log(a.event_id, 'alert_acknowledged',
    format('%s %s: %s. Se compromete a resolverlo antes de las %s (%s).',
      public._actor_name(auth.uid()),
      case when v_again then 'pide más tiempo' else 'reconoce el pendiente' end,
      a.title,
      to_char(v_eta at time zone e.timezone, 'HH24:MI'),
      case when p_minutes < 60 then format('%s min', p_minutes)
           when p_minutes % 60 = 0 then format('%s h', p_minutes / 60)
           else format('%s h %s min', p_minutes / 60, p_minutes % 60) end),
    a.level, 'alert', p_alert, jsonb_build_object('eta', v_eta, 'minutes', p_minutes, 'extension', v_again),
    a.visible_to_viewer, auth.uid());
  return v_eta;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Las alertas de documento se resuelven con el documento
-- ---------------------------------------------------------------------------

create or replace function public.resolve_alert(p_alert uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a alerts;
begin
  select * into a from alerts where id = p_alert for update;
  if not found then raise exception 'La alerta no existe.'; end if;
  perform public._require_team(a.event_id);
  if a.status = 'resolved' then raise exception 'La alerta ya está resuelta.'; end if;
  if a.entity_type = 'requirement' then
    raise exception 'Esta alerta se resuelve adjuntando el documento al expediente.' using errcode = '22023';
  end if;
  update alerts set status = 'resolved', resolved_by = auth.uid(), resolved_at = now() where id = p_alert;
  perform public._log(a.event_id, 'alert_resolved',
    format('Resuelta: %s%s', a.title, coalesce('. ' || nullif(trim(p_note), ''), '')),
    a.level, 'alert', p_alert, '{}'::jsonb, a.visible_to_viewer, auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Revisión de la IA sobre el documento adjuntado
-- ---------------------------------------------------------------------------

create or replace function public.record_document_review(
  p_requirement uuid, p_verdict text, p_summary text, p_expires_on date default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v event_requirements;
  v_summary text := left(nullif(trim(coalesce(p_summary, '')), ''), 400);
  v_reject boolean;
  v_label text;
begin
  select * into v from event_requirements where id = p_requirement for update;
  if not found then
    raise exception 'No tienes permiso para operar este evento.' using errcode = '42501';
  end if;
  perform public._require_team(v.event_id);
  if p_verdict not in ('vigente', 'sin_fecha', 'vencido', 'no_corresponde', 'ilegible') then
    raise exception 'Resultado de revisión desconocido.' using errcode = '22023';
  end if;
  if v.status <> 'done' or v.file_path is null then
    raise exception 'Primero adjunta el documento.' using errcode = '22023';
  end if;
  -- Solo se revisa lo que se acaba de subir: no sirve para reabrir documentos viejos de otros.
  if v.done_at < now() - interval '30 minutes' then
    raise exception 'La revisión se hace al adjuntar el documento.' using errcode = '22023';
  end if;

  v_reject := p_verdict in ('vencido', 'no_corresponde', 'ilegible');
  v_label := case p_verdict
    when 'vigente' then 'pase concedido, vigente' || coalesce(format(' hasta el %s', to_char(p_expires_on, 'DD/MM/YYYY')), '')
    when 'sin_fecha' then 'pase concedido, no muestra fecha de vencimiento'
    when 'vencido' then 'VENCIDO' || coalesce(format(' desde el %s', to_char(p_expires_on, 'DD/MM/YYYY')), '')
    when 'no_corresponde' then 'NO CORRESPONDE a lo que se pide'
    else 'NO SE LEE BIEN, hay que volver a tomar la foto' end;

  perform public._log(v.event_id, 'requirement_updated',
    format('Revisión de la IA de MANDO sobre «%s»: %s.%s%s', v.title, v_label,
      coalesce(' ' || v_summary, ''),
      case when v_reject then ' El documento vuelve a pendiente.' else '' end),
    case when v_reject then 3 else 1 end, 'requirement', v.id,
    jsonb_build_object('ai_review', p_verdict, 'expires_on', p_expires_on, 'file', v.file_name), false, auth.uid());

  if v_reject then
    update event_requirements
      set status = 'pending', done_by = null, done_at = null, sworn_at = null,
          note = left(format('Rechazado por la IA: %s', v_label), 500)
      where id = v.id;
    perform public._evaluate_requirement_rules(v.event_id);
  end if;
  return p_verdict;
end $$;

revoke execute on function public.ack_alert_with_time(uuid, int) from public, anon;
revoke execute on function public.record_document_review(uuid, text, text, date) from public, anon;
grant execute on function public.ack_alert_with_time(uuid, int) to authenticated;
grant execute on function public.record_document_review(uuid, text, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4 · Modo diseño: el backend pausa candados y alertas automáticas para recorrer el evento
-- ---------------------------------------------------------------------------
-- Mientras se diseña y se prueba, el productor general necesita avanzar con casillas en blanco: ver el timeline,
-- marcar inicios y seguir opinando. Con el modo diseño encendido no se encienden alertas automáticas (red flags,
-- vencidos, retrasos) y la planificación no bloquea. Se apaga con «Listo, activa» y todo vuelve a vigilar.
-- Encender y apagar queda en la bitácora.

alter table events add column if not exists design_mode boolean not null default false;

create or replace function public._raise_alert(
  p_event uuid, p_level int, p_rule text, p_title text, p_detail text,
  p_entity_type text, p_entity_id uuid, p_actor uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_existing alerts;
  v_id uuid;
  v_visible boolean := public._level_visible(p_event, p_level);
begin
  -- Modo diseño: las reglas automáticas no encienden alertas. Las que reporta una persona, sí.
  if p_rule is not null and coalesce((select design_mode from events where id = p_event), false) then
    return null;
  end if;
  if p_rule is not null and p_entity_id is not null then
    select * into v_existing from alerts
    where event_id = p_event and rule_key = p_rule and entity_id = p_entity_id and status <> 'resolved'
    order by raised_at desc limit 1
    for update;
    if found then
      if p_level > v_existing.level then
        update alerts
          set level = p_level, title = p_title, detail = p_detail,
              visible_to_viewer = v_existing.visible_to_viewer or v_visible
          where id = v_existing.id;
        perform public._log(p_event, 'alert_raised',
          format('Alerta sube a %s: %s', public._level_name(p_event, p_level), p_title),
          p_level, 'alert', v_existing.id,
          jsonb_build_object('rule', p_rule, 'from_level', v_existing.level, 'to_level', p_level),
          v_existing.visible_to_viewer or v_visible, p_actor);
      end if;
      return v_existing.id;
    end if;
  end if;

  insert into alerts (event_id, level, rule_key, title, detail, entity_type, entity_id, visible_to_viewer, raised_by)
  values (p_event, p_level, p_rule, p_title, p_detail, p_entity_type, p_entity_id, v_visible, p_actor)
  returning id into v_id;

  perform public._log(p_event, 'alert_raised',
    format('%s: %s', public._level_name(p_event, p_level), p_title),
    p_level, 'alert', v_id, jsonb_build_object('rule', p_rule), v_visible, p_actor);
  return v_id;
end $$;
revoke execute on function public._raise_alert(uuid, int, text, text, text, text, uuid, uuid) from public, anon, authenticated;

-- La planificación no bloquea el inicio de las piezas clave mientras el evento está en modo diseño.
create or replace function public._planning_missing(p_event uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when coalesce((select design_mode from events where id = p_event), false) then null
    when (select planning_gate from events where id = p_event) then (
      select string_agg((case e ->> 'key' when 'legal' then 'Legal' when 'personal' then 'Personal' when 'tecnico' then 'Técnico' when 'presupuesto' then 'Presupuesto' else 'Aprobaciones' end) || ': ' || (select string_agg(m, ', ') from jsonb_array_elements_text(e -> 'missing') m), '; ')
      from jsonb_array_elements(public._planning_status(p_event)) e where not (e ->> 'ready')::boolean)
    else public._approvals_missing(p_event) end
$$;

create or replace function public.planning_status(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e events;
begin
  if not public.is_event_member(p_event) then
    raise exception 'No tienes permiso para ver este evento.' using errcode = '42501';
  end if;
  select * into e from events where id = p_event;
  return jsonb_build_object('gate', e.planning_gate and not e.design_mode, 'design_mode', e.design_mode,
    'elements', public._planning_status(p_event));
end $$;

create or replace function public.set_design_mode(p_event uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare e events;
begin
  if not public.is_event_backend(p_event) then
    raise exception 'El modo diseño lo enciende y lo apaga el backend.' using errcode = '42501';
  end if;
  select * into e from events where id = p_event for update;
  if e.design_mode = coalesce(p_on, false) then
    return;
  end if;
  update events set design_mode = coalesce(p_on, false) where id = p_event;
  perform public._log(p_event, 'note',
    case when p_on
      then format('%s encendió el modo diseño: alertas automáticas en pausa y planificación sin candado.', public._actor_name(auth.uid()))
      else format('%s apagó el modo diseño: «Listo, activa». MANDO vuelve a vigilar plazos y documentos.', public._actor_name(auth.uid())) end,
    1, 'event', p_event, jsonb_build_object('design_mode', coalesce(p_on, false)), false, auth.uid());
  -- Al activar, se revisa de inmediato lo que esté vencido.
  if not p_on then
    perform public._evaluate_clock_rules(p_event);
    perform public._evaluate_requirement_rules(p_event);
  end if;
end $$;
revoke execute on function public.set_design_mode(uuid, boolean) from public, anon;
grant execute on function public.set_design_mode(uuid, boolean) to authenticated;


-- ===================== 20261217000024_alertas_con_evidencia.sql =====================
-- MANDO · Alertas por audio y levantadas solo con evidencia (decisión 94).
--
-- 1. Una alerta se levanta (resuelve) solo si tiene una evidencia adjunta: por ejemplo, la captura del WhatsApp
--    del cliente que dice «avanza nomás, regularizo después». Sin evidencia, no pasa.
-- 2. Quien la levanta responde por lo que informa: la bitácora lo dice con su nombre (palabra de honor).
-- 3. Las alertas de documento siguen resolviéndose adjuntando el documento al expediente (decisión 93).
--
-- Nada se borra: la evidencia queda en el cubo privado con su huella y la bitácora guarda quién la subió.

create or replace function public.resolve_alert(p_alert uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  a alerts;
  v_evidence uuid;
begin
  select * into a from alerts where id = p_alert for update;
  if not found then raise exception 'La alerta no existe.'; end if;
  perform public._require_team(a.event_id);
  if a.status = 'resolved' then raise exception 'La alerta ya está resuelta.'; end if;
  if a.entity_type = 'requirement' then
    raise exception 'Esta alerta se resuelve adjuntando el documento al expediente.' using errcode = '22023';
  end if;
  select id into v_evidence from evidences
    where alert_id = p_alert and file_path is not null
    order by received_at desc limit 1;
  if v_evidence is null then
    raise exception 'Para levantar la alerta adjunta una evidencia, por ejemplo la captura del mensaje del cliente.' using errcode = '22023';
  end if;
  update alerts set status = 'resolved', resolved_by = auth.uid(), resolved_at = now() where id = p_alert;
  perform public._log(a.event_id, 'alert_resolved',
    format('Levantada con evidencia: %s%s. %s responde por lo que informa.',
      a.title, coalesce('. ' || nullif(trim(p_note), ''), ''), public._actor_name(auth.uid())),
    a.level, 'alert', p_alert, jsonb_build_object('evidence', v_evidence, 'honor', true), a.visible_to_viewer, auth.uid());
end $$;


-- ===================== 20261218000025_mando_de_marca.sql =====================
-- MANDO · Mando de marca y pedidos especiales (decisión 95).
--
-- 1. Cada organización que usa MANDO firma su propio mando: «MANDO Momentum», «MANDO Circus».
--    Guarda el nombre que acompaña a MANDO, de qué grupo viene (McCann Erickson) y su logo.
-- 2. Cada mando tiene sus pedidos especiales: lo que esa agencia quiere distinto (por ejemplo, priorizar
--    ciertas palabras). Se registran, se cotizan y se activan; los que se cobran quedan marcados.
--
-- El logo va al cubo privado en org/<organización>/logo/<archivo>. Solo lo sube quien administra la
-- organización, y lo ve quien ve la organización.

alter table organizations add column if not exists brand_name  text;
alter table organizations add column if not exists parent_name text;
alter table organizations add column if not exists logo_path   text;

do $$
begin
  alter table organizations add constraint organizations_brand_name_len check (brand_name is null or length(brand_name) between 1 and 40);
exception when duplicate_object then null;
end $$;
do $$
begin
  alter table organizations add constraint organizations_parent_name_len check (parent_name is null or length(parent_name) between 1 and 80);
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 1 · La marca del mando
-- ---------------------------------------------------------------------------

create or replace function public.org_logo_path_ok(p_org uuid, p_name text) returns boolean
language sql immutable as $$
  select split_part(p_name, '/', 1) = 'org'
     and split_part(p_name, '/', 2) = p_org::text
     and split_part(p_name, '/', 3) = 'logo'
     and p_name ~* '\.(png|jpe?g|webp)$'
$$;

create or replace function public.set_org_brand(p_org uuid, p_brand_name text, p_parent_name text default null,
                                                p_logo_path text default null, p_clear_logo boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_brand text := nullif(regexp_replace(trim(coalesce(p_brand_name, '')), '\s+', ' ', 'g'), '');
  v_parent text := nullif(regexp_replace(trim(coalesce(p_parent_name, '')), '\s+', ' ', 'g'), '');
begin
  if not public.is_org_admin(p_org) then
    raise exception 'La marca del mando la cambia quien administra la organización.' using errcode = '42501';
  end if;
  if v_brand is not null and length(v_brand) > 40 then
    raise exception 'El nombre que acompaña a MANDO es muy largo (máximo 40 letras).' using errcode = '22023';
  end if;
  if v_parent is not null and length(v_parent) > 80 then
    raise exception 'El nombre del grupo es muy largo.' using errcode = '22023';
  end if;
  if p_logo_path is not null and not public.org_logo_path_ok(p_org, p_logo_path) then
    raise exception 'El logo tiene que ser PNG, JPG o WebP.' using errcode = '22023';
  end if;
  update organizations
     set brand_name = v_brand,
         parent_name = v_parent,
         logo_path = case when p_clear_logo then null else coalesce(p_logo_path, logo_path) end
   where id = p_org;
end $$;

create or replace function public.can_upload_org_logo(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_org text := split_part(p_name, '/', 2);
begin
  if split_part(p_name, '/', 1) <> 'org'
     or v_org !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.org_logo_path_ok(v_org::uuid, p_name) and public.is_org_admin(v_org::uuid);
end $$;

create or replace function public.can_read_org_logo(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_org text := split_part(p_name, '/', 2);
begin
  if split_part(p_name, '/', 1) <> 'org' or split_part(p_name, '/', 3) <> 'logo'
     or v_org !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.can_see_org(v_org::uuid);
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Pedidos especiales de cada mando
-- ---------------------------------------------------------------------------

create table if not exists organization_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title           text not null check (length(title) between 3 and 160),
  detail          text check (detail is null or length(detail) <= 2000),
  status          text not null default 'pedido'
                  check (status in ('pedido', 'cotizado', 'aprobado', 'activo', 'descartado')),
  billable        boolean not null default true,      -- una actualización a pedido se cobra
  quote_note      text check (quote_note is null or length(quote_note) <= 300),
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_by      uuid references profiles(id),
  updated_at      timestamptz not null default now()
);
create index if not exists organization_requests_org on organization_requests (organization_id, created_at desc);

alter table organization_requests enable row level security;
drop policy if exists organization_requests_read on organization_requests;
create policy organization_requests_read on organization_requests for select to authenticated
  using (public.is_org_admin(organization_id));
-- Sin políticas de insert, update ni delete: todo pasa por las funciones de abajo. Nada se borra.

create or replace function public.request_customization(p_org uuid, p_title text, p_detail text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_title text := nullif(regexp_replace(trim(coalesce(p_title, '')), '\s+', ' ', 'g'), '');
  v_detail text := nullif(trim(coalesce(p_detail, '')), '');
  v_id uuid;
begin
  if not public.is_org_admin(p_org) then
    raise exception 'Los pedidos especiales los hace quien administra la organización.' using errcode = '42501';
  end if;
  if v_title is null or length(v_title) < 3 or length(v_title) > 160 then
    raise exception 'Cuenta en una línea qué quieres distinto.' using errcode = '22023';
  end if;
  if length(coalesce(v_detail, '')) > 2000 then
    raise exception 'El detalle es muy largo.' using errcode = '22023';
  end if;
  insert into organization_requests (organization_id, title, detail, created_by, updated_by)
  values (p_org, v_title, v_detail, auth.uid(), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.set_customization_status(p_request uuid, p_status text, p_billable boolean default null,
                                                           p_quote_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r organization_requests;
begin
  select * into r from organization_requests where id = p_request for update;
  if not found then raise exception 'El pedido no existe.'; end if;
  if not public.is_org_admin(r.organization_id) then
    raise exception 'Solo quien administra la organización cambia el estado de un pedido.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('pedido', 'cotizado', 'aprobado', 'activo', 'descartado') then
    raise exception 'Elige un estado válido.' using errcode = '22023';
  end if;
  if length(coalesce(p_quote_note, '')) > 300 then
    raise exception 'La nota de cotización es muy larga.' using errcode = '22023';
  end if;
  update organization_requests
     set status = p_status,
         billable = coalesce(p_billable, billable),
         quote_note = coalesce(nullif(trim(coalesce(p_quote_note, '')), ''), quote_note),
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_request;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · Permisos
-- ---------------------------------------------------------------------------

grant select on organization_requests to authenticated;
grant all on organization_requests to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public.set_org_brand(uuid, text, text, text, boolean)', 'public.can_upload_org_logo(text)', 'public.can_read_org_logo(text)',
    'public.request_customization(uuid, text, text)', 'public.set_customization_status(uuid, text, boolean, text)',
    'public.org_logo_path_ok(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists org_logo_insert on storage.objects;
    create policy org_logo_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'evidences' and public.can_upload_org_logo(name));
    drop policy if exists org_logo_read on storage.objects;
    create policy org_logo_read on storage.objects for select to authenticated
      using (bucket_id = 'evidences' and public.can_read_org_logo(name));
  end if;
end $$;


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
   '{"provider":"email","providers":["email"]}', '{"full_name":"Backend de ejemplo"}', now(), now(), '', '', '', ''),
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
  ('00000000-0000-0000-0000-0000000000a2', 'Backend de ejemplo'),
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

-- Los tres usuarios de ejemplo ya vieron la bienvenida (welcomed_at): entran directo al evento.
insert into event_members (event_id, profile_id, role, title, level, welcomed_at) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'producer', 'Productor de campo', 2, now()),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2', 'backend',  'Productor general', 1, now()),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a3', 'viewer',   'Cliente', null, now());

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
      "cuando": "En un momento crítico, lo encontrado no coincide con lo prometido. Si es parcial, usa `nivel_parcial`.",
      "parametros": {
        "nivel_parcial": 2
      }
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
    },
    {
      "clave": "documento_por_vencer",
      "nivel": 2,
      "cuando": "A un documento pendiente del expediente le faltan `dias_antes` días o menos para su plazo.",
      "parametros": {
        "dias_antes": 2
      }
    },
    {
      "clave": "documento_vencido",
      "nivel": 3,
      "cuando": "Un documento pendiente del expediente ya pasó su plazo.",
      "parametros": {}
    },
    {
      "clave": "documento_no_negociable_vencido",
      "nivel": 4,
      "cuando": "Un documento no negociable sigue pendiente después de su plazo y el evento ya llegó a su hora clave.",
      "parametros": {}
    }
  ]
}$crit$::jsonb
where id = '00000000-0000-0000-0000-0000000000e1';

-- No negociables e hitos estrella del evento de ejemplo (en un evento nuevo salen de la plantilla del tipo).
insert into event_criteria (event_id, kind, title, sort_order) values
  ('00000000-0000-0000-0000-0000000000e1', 'no_negociable', 'Energía de respaldo para sonido y luces', 1),
  ('00000000-0000-0000-0000-0000000000e1', 'no_negociable', 'Capacidad del local respetada', 2),
  ('00000000-0000-0000-0000-0000000000e1', 'no_negociable', 'Hora de apertura de puertas', 3),
  ('00000000-0000-0000-0000-0000000000e1', 'hito_estrella', 'Entrada del show en el segundo exacto', 1),
  ('00000000-0000-0000-0000-0000000000e1', 'hito_estrella', 'Momento de impacto registrado en video', 2),
  ('00000000-0000-0000-0000-0000000000e1', 'hito_estrella', 'Valoración alta de técnicos y proveedores', 3)
on conflict do nothing;

-- Expediente del evento de ejemplo (en un evento nuevo sale de config/expediente.json según su tipo).
insert into event_requirements (event_id, key, category, title, mandatory, due_at, sort_order)
select '00000000-0000-0000-0000-0000000000e1', v.key, v.category, v.title, v.mandatory,
       (select starts_at from events where id = '00000000-0000-0000-0000-0000000000e1') + make_interval(days => v.days), v.n
from (values
  ('sctr', 'seguridad', 'SCTR o seguro de vida del equipo', true, -3, 1),
  ('epp', 'seguridad', 'EPP: equipos de protección personal', true, -3, 2),
  ('carta-locacion', 'permisos', 'Carta o autorización de la locación', true, -3, 3),
  ('contratos', 'proveedores', 'Contratos con proveedores', false, -5, 4),
  ('plano', 'logistica', 'Plano de la locación', false, -3, 5),
  ('facturas', 'administracion', 'Facturas (PDF y XML de SUNAT)', false, 2, 6),
  ('cobranza', 'administracion', 'Documento de cobranza (conformidad del servicio)', false, 3, 7),
  ('informe-eventualidades', 'eventualidades', 'Informe de eventualidades con fotos', false, 1, 8)
) as v(key, category, title, mandatory, days, n)
on conflict do nothing;
