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
    }
  ]
}$crit$::jsonb
where id = '00000000-0000-0000-0000-0000000000e1';
