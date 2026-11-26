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
