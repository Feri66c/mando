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
