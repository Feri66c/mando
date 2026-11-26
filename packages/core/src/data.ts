import type { DocState, ElementStatus } from "./planning";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CriticalityConfig } from "./criticality";
import {
  isEventRole,
  type AlertStatus,
  type CommitmentOutcome,
  type EventRole,
  type EventStatus,
  type EvidenceKind,
  type ItemStatus,
  type MomentStatus,
} from "./labels";

// Lecturas compartidas por la web y la app. Cada función recibe el cliente de Supabase con la sesión
// de la persona: la base de datos decide qué filas devuelve (seguridad por fila), no esta capa.
// Las escrituras van siempre por las funciones del servidor (rpc), nunca por update directo.

export type CurrentUser = { id: string; email: string | null; fullName: string };

export type MyEvent = {
  id: string;
  name: string;
  eventType: string | null;
  clientName: string | null;
  venueName: string | null;
  timezone: string;
  startsAt: string | null;
  endsAt: string | null;
  status: EventStatus;
  role: EventRole;
  title: string | null;
  /** Clave de la plantilla del tipo de evento (sampling, feria...) y su tamaño. */
  kind: string | null;
  tier: string | null;
  /** Nivel en la jerarquía: 1 productor general … 4 técnicos y proveedores. El cliente no tiene. */
  level: number | null;
  /** Cuándo vio la bienvenida y tomó el mando. null = todavía no. */
  welcomedAt: string | null;
  /** Cuándo aceptó su cargo. Quien ya tomó el mando, ya aceptó. */
  acceptedAt: string | null;
};

export type RouteItem = {
  id: string;
  title: string;
  areaId: string | null;
  areaName: string | null;
  areaOrder: number;
  plannedStart: string;
  plannedEnd: string;
  currentStart: string;
  currentEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  status: ItemStatus;
  isMilestone: boolean;
  /** Lo que la productora estima que toma, en minutos (decisión 34). */
  estimatedMinutes: number | null;
  visibleToViewer: boolean;
  ownerName: string | null;
  providerName: string | null;
  providerPhone: string | null;
};

/** Nombre para mostrar de la persona con sesión. */
export async function fetchProfileName(client: SupabaseClient, userId: string, fallback: string): Promise<string> {
  const { data } = await client.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return (data?.full_name as string | undefined) ?? fallback;
}

type EventRow = {
  id: string;
  name: string;
  event_type: string | null;
  client_name: string | null;
  venue_name: string | null;
  timezone: string;
  starts_at: string | null;
  ends_at: string | null;
  status: EventStatus;
  kind: string | null;
  tier: string | null;
};

const EVENT_COLUMNS = "id, name, event_type, client_name, venue_name, timezone, starts_at, ends_at, status, kind, tier";

function toMyEvent(e: EventRow, role: EventRole, title: string | null, level: number | null, welcomedAt: string | null, acceptedAt: string | null = null): MyEvent {
  return {
    id: e.id,
    name: e.name,
    eventType: e.event_type,
    clientName: e.client_name,
    venueName: e.venue_name,
    timezone: e.timezone,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    status: e.status,
    role,
    title,
    kind: e.kind,
    tier: e.tier,
    level,
    welcomedAt,
    acceptedAt: acceptedAt ?? welcomedAt,
  };
}

/** «Mis eventos»: los eventos donde la persona es miembro, con su rol en cada uno. */
export async function fetchMyEvents(client: SupabaseClient, userId: string): Promise<MyEvent[]> {
  const { data, error } = await client
    .from("event_members")
    .select(`role, title, level, welcomed_at, accepted_at, events (${EVENT_COLUMNS})`)
    .eq("profile_id", userId);
  if (error) throw new Error(`No se pudieron leer tus eventos: ${error.message}`);

  return (data ?? [])
    .map((row) => {
      const event = (Array.isArray(row.events) ? row.events[0] : row.events) as EventRow | null;
      if (!event || !isEventRole(row.role)) return null;
      return toMyEvent(event, row.role, row.title as string | null, row.level as number | null, row.welcomed_at as string | null, row.accepted_at as string | null);
    })
    .filter((e): e is MyEvent => e !== null)
    .sort((a, b) => (a.startsAt ?? "9999").localeCompare(b.startsAt ?? "9999"));
}

/** Hoja de ruta del evento, tal como la base de datos permite verla a esta persona. */
export async function fetchRouteItems(client: SupabaseClient, eventId: string): Promise<RouteItem[]> {
  const { data, error } = await client
    .from("route_items")
    .select(
      `id, title, area_id, planned_start, planned_end, current_start, current_end, actual_start, actual_end,
       status, is_milestone, visible_to_viewer, estimated_minutes,
       areas (name, sort_order), owner:profiles!route_items_owner_id_fkey (full_name), providers (name, phone)`,
    )
    .eq("event_id", eventId)
    .order("current_start", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`No se pudo leer la hoja de ruta: ${error.message}`);
  return (data ?? []).map(toRouteItem);
}

function first<T>(value: T | T[] | null | undefined): T | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRouteItem(r: any): RouteItem {
  const area = first(r.areas) as { name: string; sort_order: number } | null;
  const owner = first(r.owner) as { full_name: string | null } | null;
  const provider = first(r.providers) as { name: string; phone: string | null } | null;
  return {
    id: r.id,
    title: r.title,
    areaId: r.area_id ?? null,
    areaName: area?.name ?? null,
    areaOrder: area?.sort_order ?? 999,
    plannedStart: r.planned_start,
    plannedEnd: r.planned_end,
    currentStart: r.current_start,
    currentEnd: r.current_end,
    actualStart: r.actual_start ?? null,
    actualEnd: r.actual_end ?? null,
    status: r.status,
    isMilestone: Boolean(r.is_milestone),
    estimatedMinutes: r.estimated_minutes ?? null,
    visibleToViewer: Boolean(r.visible_to_viewer),
    ownerName: owner?.full_name ?? null,
    providerName: provider?.name ?? null,
    providerPhone: provider?.phone ?? null,
  };
}

/** Escala de criticidad del evento (copia de config/criticidad.json guardada en el evento). */
export async function fetchCriticality(client: SupabaseClient, eventId: string): Promise<CriticalityConfig | null> {
  const { data } = await client.from("events").select("criticality_config").eq("id", eventId).maybeSingle();
  return (data?.criticality_config ?? null) as CriticalityConfig | null;
}

export type LogEntry = {
  id: number;
  at: string;
  kind: string;
  level: number | null;
  summary: string;
  visibleToViewer: boolean;
  actorName: string | null;
};

/** Bitácora, de la más reciente a la más antigua. */
export async function fetchLog(client: SupabaseClient, eventId: string, limit = 100): Promise<LogEntry[]> {
  const { data, error } = await client
    .from("log_entries")
    .select("id, at, kind, level, summary, visible_to_viewer, actor:profiles!log_entries_actor_id_fkey (full_name)")
    .eq("event_id", eventId)
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`No se pudo leer la bitácora: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: Number(r.id),
    at: r.at as string,
    kind: r.kind as string,
    level: (r.level as number | null) ?? null,
    summary: r.summary as string,
    visibleToViewer: Boolean(r.visible_to_viewer),
    actorName: (first(r.actor) as { full_name: string | null } | null)?.full_name ?? null,
  }));
}

export type Alert = {
  id: string;
  level: number;
  ruleKey: string | null;
  title: string;
  detail: string | null;
  status: AlertStatus;
  visibleToViewer: boolean;
  raisedAt: string;
  resolvedAt: string | null;
  entityType: string | null;
  entityId: string | null;
};

export async function fetchAlerts(client: SupabaseClient, eventId: string): Promise<Alert[]> {
  const { data, error } = await client
    .from("alerts")
    .select("id, level, rule_key, title, detail, status, visible_to_viewer, raised_at, resolved_at, entity_type, entity_id")
    .eq("event_id", eventId)
    .order("raised_at", { ascending: false });
  if (error) throw new Error(`No se pudieron leer las alertas: ${error.message}`);
  const order: Record<AlertStatus, number> = { open: 0, acknowledged: 1, resolved: 2 };
  return (data ?? [])
    .map((a) => ({
      id: a.id as string,
      level: a.level as number,
      ruleKey: (a.rule_key as string | null) ?? null,
      title: a.title as string,
      detail: (a.detail as string | null) ?? null,
      status: a.status as AlertStatus,
      visibleToViewer: Boolean(a.visible_to_viewer),
      raisedAt: a.raised_at as string,
      resolvedAt: (a.resolved_at as string | null) ?? null,
      entityType: (a.entity_type as string | null) ?? null,
      entityId: (a.entity_id as string | null) ?? null,
    }))
    .sort((a, b) => order[a.status] - order[b.status] || b.level - a.level || b.raisedAt.localeCompare(a.raisedAt));
}

export type Moment = {
  id: string;
  title: string;
  status: MomentStatus;
  level: number;
  templateKey: string | null;
  routeItemId: string | null;
  routeItemTitle: string | null;
  openedAt: string | null;
  resolvedAt: string | null;
  resolution: string | null;
};

export type MomentCheck = { id: string; question: string; answer: string | null; answeredAt: string | null };
export type Commitment = {
  id: string;
  label: string;
  promised: string;
  found: string | null;
  outcome: CommitmentOutcome | null;
  checkedAt: string | null;
};

const MOMENT_COLUMNS =
  "id, title, status, level, template_key, route_item_id, opened_at, resolved_at, resolution, route_items (title)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMoment(m: any): Moment {
  return {
    id: m.id,
    title: m.title,
    status: m.status,
    level: m.level,
    templateKey: m.template_key ?? null,
    routeItemId: m.route_item_id ?? null,
    routeItemTitle: (first(m.route_items) as { title: string } | null)?.title ?? null,
    openedAt: m.opened_at ?? null,
    resolvedAt: m.resolved_at ?? null,
    resolution: m.resolution ?? null,
  };
}

/** Momentos críticos del evento (solo el equipo los ve; para el cliente la lista llega vacía). */
export async function fetchMoments(client: SupabaseClient, eventId: string): Promise<Moment[]> {
  const { data, error } = await client.from("critical_moments").select(MOMENT_COLUMNS).eq("event_id", eventId);
  if (error) throw new Error(`No se pudieron leer los momentos críticos: ${error.message}`);
  const order: Record<MomentStatus, number> = { open: 0, escalated: 0, scheduled: 1, resolved: 2 };
  return (data ?? []).map(toMoment).sort((a, b) => order[a.status] - order[b.status] || b.level - a.level);
}

export async function fetchMomentDetail(client: SupabaseClient, eventId: string, momentId: string) {
  const { data, error } = await client
    .from("critical_moments")
    .select(`${MOMENT_COLUMNS}, moment_checks (id, question, answer_text, answered_at, sort_order),
             commitments (id, item_label, promised, found, outcome, checked_at)`)
    .eq("event_id", eventId)
    .eq("id", momentId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el momento crítico: ${error.message}`);
  if (!data) return null;
  type CheckRow = { id: string; question: string; answer_text: string | null; answered_at: string | null; sort_order: number };
  type CommitmentRow = { id: string; item_label: string; promised: string; found: string | null; outcome: CommitmentOutcome | null; checked_at: string | null };
  const checks = ((data.moment_checks ?? []) as CheckRow[])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => ({ id: c.id, question: c.question, answer: c.answer_text, answeredAt: c.answered_at }));
  const commitments = ((data.commitments ?? []) as CommitmentRow[])
    .sort((a, b) => a.item_label.localeCompare(b.item_label))
    .map((c) => ({ id: c.id, label: c.item_label, promised: c.promised, found: c.found, outcome: c.outcome, checkedAt: c.checked_at }));
  return { moment: toMoment(data), checks, commitments };
}

export type Evidence = {
  id: string;
  kind: EvidenceKind;
  note: string | null;
  filePath: string | null;
  url: string | null;
  sha256: string | null;
  capturedAt: string;
  receivedAt: string;
  visibleToViewer: boolean;
  routeItemId: string | null;
  momentId: string | null;
};

/** Evidencias con enlaces firmados de corta duración (los archivos son privados). */
export async function fetchEvidences(
  client: SupabaseClient,
  eventId: string,
  filter: { routeItemId?: string; momentId?: string } = {},
): Promise<Evidence[]> {
  let query = client
    .from("evidences")
    .select("id, kind, note, file_path, sha256, captured_at, received_at, visible_to_viewer, route_item_id, moment_id")
    .eq("event_id", eventId)
    .order("received_at", { ascending: false })
    .limit(60);
  if (filter.routeItemId) query = query.eq("route_item_id", filter.routeItemId);
  if (filter.momentId) query = query.eq("moment_id", filter.momentId);
  const { data, error } = await query;
  if (error) throw new Error(`No se pudieron leer las evidencias: ${error.message}`);
  const rows = data ?? [];
  const paths = rows.map((r) => r.file_path as string | null).filter((p): p is string => Boolean(p));
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await client.storage.from("evidences").createSignedUrls(paths, 60 * 60);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as EvidenceKind,
    note: (r.note as string | null) ?? null,
    filePath: (r.file_path as string | null) ?? null,
    url: r.file_path ? (urls.get(r.file_path as string) ?? null) : null,
    sha256: (r.sha256 as string | null) ?? null,
    capturedAt: r.captured_at as string,
    receivedAt: r.received_at as string,
    visibleToViewer: Boolean(r.visible_to_viewer),
    routeItemId: (r.route_item_id as string | null) ?? null,
    momentId: (r.moment_id as string | null) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Panel del productor general: equipo, invitaciones y plantilla del evento
// ---------------------------------------------------------------------------

export type TeamMember = {
  profileId: string;
  fullName: string;
  role: EventRole;
  title: string | null;
  level: number | null;
  welcomedAt: string | null;
};

export type Invitation = {
  id: string;
  email: string;
  fullName: string;
  role: EventRole;
  title: string;
  level: number | null;
  createdAt: string;
};

/** Organizaciones donde la persona es productor general (administra y puede crear eventos). */
export async function fetchAdminOrgs(client: SupabaseClient, userId: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await client
    .from("organization_members")
    .select("organization_id, is_admin, organizations (name)")
    .eq("profile_id", userId)
    .eq("is_admin", true);
  if (error) throw new Error(`No se pudo leer tu organización: ${error.message}`);
  return (data ?? []).map((row) => {
    const org = first(row.organizations) as { name: string } | null;
    return { id: row.organization_id as string, name: org?.name ?? "Organización" };
  });
}

/** Equipo del evento, ordenado por jerarquía. El cliente va al final. */
export async function fetchTeam(client: SupabaseClient, eventId: string): Promise<TeamMember[]> {
  const { data, error } = await client
    .from("event_members")
    .select("profile_id, role, title, level, welcomed_at, profiles!event_members_profile_id_fkey (full_name)")
    .eq("event_id", eventId);
  if (error) throw new Error(`No se pudo leer el equipo: ${error.message}`);
  return (data ?? [])
    .filter((row) => isEventRole(row.role))
    .map((row) => {
      const profile = first(row.profiles) as { full_name: string | null } | null;
      return {
        profileId: row.profile_id as string,
        fullName: profile?.full_name ?? "Sin nombre",
        role: row.role as EventRole,
        title: row.title as string | null,
        level: row.level as number | null,
        welcomedAt: row.welcomed_at as string | null,
      };
    })
    .sort((a, b) => (a.level ?? 9) - (b.level ?? 9) || a.fullName.localeCompare(b.fullName));
}

/** Invitaciones que todavía nadie activó. Solo las ve el productor general. */
export async function fetchPendingInvitations(client: SupabaseClient, eventId: string): Promise<Invitation[]> {
  const { data, error } = await client
    .from("invitations")
    .select("id, email, full_name, role, title, level, created_at")
    .eq("event_id", eventId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`No se pudieron leer las invitaciones: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    email: row.email as string,
    fullName: row.full_name as string,
    role: row.role as EventRole,
    title: row.title as string,
    level: row.level as number | null,
    createdAt: row.created_at as string,
  }));
}

/** Plantilla copiada en el evento y quién lo creó (para la bienvenida). */
export async function fetchEventTemplate(
  client: SupabaseClient,
  eventId: string,
): Promise<{ template: Record<string, unknown> | null; createdByName: string | null }> {
  const { data, error } = await client
    .from("events")
    .select("template, creator:profiles!events_created_by_fkey (full_name)")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el tipo de evento: ${error.message}`);
  const creator = first(data?.creator) as { full_name: string | null } | null;
  const template = data?.template as Record<string, unknown> | null;
  return { template: template && Object.keys(template).length > 0 ? template : null, createdByName: creator?.full_name ?? null };
}

// ---- Méritos, cierre y citados ----

export type Criterion = {
  id: string;
  kind: "no_negociable" | "hito_estrella";
  title: string;
  status: "pending" | "ok" | "failed";
  note: string | null;
  checkedAt: string | null;
};

/** No negociables e hitos estrella del evento, en su orden. */
export async function fetchCriteria(client: SupabaseClient, eventId: string): Promise<Criterion[]> {
  const { data, error } = await client
    .from("event_criteria")
    .select("id, kind, title, status, note, checked_at")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`No se pudieron leer los no negociables: ${error.message}`);
  return (data ?? []).map((c) => ({
    id: c.id as string,
    kind: c.kind as Criterion["kind"],
    title: c.title as string,
    status: c.status as Criterion["status"],
    note: (c.note as string | null) ?? null,
    checkedAt: (c.checked_at as string | null) ?? null,
  }));
}

export type EventSummary = {
  items_total: number;
  items_done: number;
  changes: number;
  alerts: number;
  alerts_open: number;
  evidences: number;
  guests: number;
  guests_on_time: number;
};

/** Números para la cuenta de estrellas: los mismos para el equipo y para el cliente. */
export async function fetchScoreInputs(
  client: SupabaseClient,
  eventId: string,
  minLevel = 3,
): Promise<import("./merits").ScoreInputs & { summary: EventSummary }> {
  const { data, error } = await client.rpc("event_score_inputs", { p_event: eventId, p_min_level: minLevel });
  if (error) throw new Error(`No se pudieron leer los méritos del evento: ${error.message}`);
  return data as import("./merits").ScoreInputs & { summary: EventSummary };
}

export type Closing = { closedAt: string | null; publishUrl: string | null };

export async function fetchClosing(client: SupabaseClient, eventId: string): Promise<Closing> {
  const { data, error } = await client.from("events").select("closed_at, publish_url").eq("id", eventId).maybeSingle();
  if (error) throw new Error(`No se pudo leer el cierre del evento: ${error.message}`);
  return { closedAt: (data?.closed_at as string | null) ?? null, publishUrl: (data?.publish_url as string | null) ?? null };
}

/** La valoración que dio esta persona, si ya valoró. */
export async function fetchMyRating(client: SupabaseClient, eventId: string, userId: string): Promise<{ stars: number; comment: string | null } | null> {
  const { data, error } = await client.from("event_ratings").select("stars, comment").eq("event_id", eventId).eq("profile_id", userId).maybeSingle();
  if (error) throw new Error(`No se pudo leer tu valoración: ${error.message}`);
  return data ? { stars: data.stars as number, comment: (data.comment as string | null) ?? null } : null;
}

export type Guest = {
  id: string;
  fullName: string;
  guestRole: string;
  phone: string | null;
  email: string | null;
  callAt: string;
  remindedAt: string | null;
  reminders: number;
  arrivedAt: string | null;
};

/** Citados del evento (hosts e invitados). Solo el equipo los ve. */
export async function fetchGuests(client: SupabaseClient, eventId: string): Promise<Guest[]> {
  const { data, error } = await client
    .from("event_guests")
    .select("id, full_name, guest_role, phone, email, call_at, reminded_at, reminders, arrived_at")
    .eq("event_id", eventId)
    .is("removed_at", null)
    .order("call_at", { ascending: true });
  if (error) throw new Error(`No se pudieron leer los citados: ${error.message}`);
  return (data ?? []).map((g) => ({
    id: g.id as string,
    fullName: g.full_name as string,
    guestRole: g.guest_role as string,
    phone: (g.phone as string | null) ?? null,
    email: (g.email as string | null) ?? null,
    callAt: g.call_at as string,
    remindedAt: (g.reminded_at as string | null) ?? null,
    reminders: Number(g.reminders ?? 0),
    arrivedAt: (g.arrived_at as string | null) ?? null,
  }));
}

// ---- Expediente y locación ----

export type Requirement = {
  id: string;
  key: string | null;
  category: string;
  title: string;
  mandatory: boolean;
  dueAt: string | null;
  status: "pending" | "done" | "not_applicable";
  ownerId: string | null;
  ownerName: string | null;
  fileName: string | null;
  fileUrl: string | null;
  note: string | null;
  doneAt: string | null;
};

/** Documentos del expediente, con enlace firmado de corta duración para los que ya tienen archivo. */
export async function fetchRequirements(client: SupabaseClient, eventId: string): Promise<Requirement[]> {
  const { data, error } = await client
    .from("event_requirements")
    .select("id, key, category, title, mandatory, due_at, status, owner_id, file_path, file_name, note, done_at, owner:profiles!event_requirements_owner_id_fkey (full_name)")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`No se pudo leer el expediente: ${error.message}`);
  const rows = data ?? [];
  const paths = rows.map((r) => r.file_path as string | null).filter((p): p is string => Boolean(p));
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await client.storage.from("evidences").createSignedUrls(paths, 60 * 60);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return rows.map((r) => ({
    id: r.id as string,
    key: (r.key as string | null) ?? null,
    category: r.category as string,
    title: r.title as string,
    mandatory: Boolean(r.mandatory),
    dueAt: (r.due_at as string | null) ?? null,
    status: r.status as Requirement["status"],
    ownerId: (r.owner_id as string | null) ?? null,
    ownerName: (first(r.owner) as { full_name: string | null } | null)?.full_name ?? null,
    fileName: (r.file_name as string | null) ?? null,
    fileUrl: r.file_path ? (urls.get(r.file_path as string) ?? null) : null,
    note: (r.note as string | null) ?? null,
    doneAt: (r.done_at as string | null) ?? null,
  }));
}

export type EventLocation = {
  meetingPoint: string | null;
  mapUrl: string | null;
  coordinator: string | null;
  coordinatorPhone: string | null;
  transportPlate: string | null;
  transportDetail: string | null;
  antecedents: string[];
  killerZones: string | null;
  blindSpots: string | null;
  updatedAt: string | null;
};

export const EMPTY_LOCATION: EventLocation = {
  meetingPoint: null,
  mapUrl: null,
  coordinator: null,
  coordinatorPhone: null,
  transportPlate: null,
  transportDetail: null,
  antecedents: [],
  killerZones: null,
  blindSpots: null,
  updatedAt: null,
};

export async function fetchLocation(client: SupabaseClient, eventId: string): Promise<EventLocation> {
  const { data, error } = await client.from("event_locations").select("*").eq("event_id", eventId).maybeSingle();
  if (error) throw new Error(`No se pudo leer la locación: ${error.message}`);
  if (!data) return EMPTY_LOCATION;
  return {
    meetingPoint: data.meeting_point ?? null,
    mapUrl: data.map_url ?? null,
    coordinator: data.coordinator ?? null,
    coordinatorPhone: data.coordinator_phone ?? null,
    transportPlate: data.transport_plate ?? null,
    transportDetail: data.transport_detail ?? null,
    antecedents: Array.isArray(data.antecedents) ? data.antecedents.map(String) : [],
    killerZones: data.killer_zones ?? null,
    blindSpots: data.blind_spots ?? null,
    updatedAt: data.updated_at ?? null,
  };
}

// ---- Aprobaciones del cliente ----

export type Approval = {
  id: string;
  group: string;
  code: string;
  name: string;
  detail: string | null;
  fileUrl: string | null;
  version: number;
  status: "pending" | "approved" | "changes_requested";
  decisionNote: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
};

/** Elementos que el cliente aprueba, con enlace firmado de corta duración para la foto. */
export async function fetchApprovals(client: SupabaseClient, eventId: string): Promise<Approval[]> {
  const { data, error } = await client
    .from("event_approvals")
    .select("id, group_key, code, name, detail, file_path, version, status, decision_note, decided_at, decider:profiles!event_approvals_decided_by_fkey (full_name)")
    .eq("event_id", eventId)
    .is("removed_at", null)
    .order("code", { ascending: true });
  if (error) throw new Error(`No se pudieron leer las aprobaciones: ${error.message}`);
  const rows = data ?? [];
  const paths = rows.map((r) => r.file_path as string | null).filter((p): p is string => Boolean(p));
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await client.storage.from("evidences").createSignedUrls(paths, 60 * 60);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return rows.map((r) => ({
    id: r.id as string,
    group: r.group_key as string,
    code: r.code as string,
    name: r.name as string,
    detail: (r.detail as string | null) ?? null,
    fileUrl: r.file_path ? (urls.get(r.file_path as string) ?? null) : null,
    version: Number(r.version),
    status: r.status as Approval["status"],
    decisionNote: (r.decision_note as string | null) ?? null,
    decidedAt: (r.decided_at as string | null) ?? null,
    decidedByName: (first(r.decider) as { full_name: string | null } | null)?.full_name ?? null,
  }));
}

/** Grupos que este evento pide aprobar antes de empezar. */
export async function fetchApprovalGroups(client: SupabaseClient, eventId: string): Promise<string[]> {
  const { data, error } = await client.from("events").select("approval_groups").eq("id", eventId).maybeSingle();
  if (error) throw new Error(`No se pudieron leer las aprobaciones: ${error.message}`);
  return Array.isArray(data?.approval_groups) ? data.approval_groups.map(String) : [];
}

// ---- Planificación: los 5 elementos ----


export type Planning = { gate: boolean; elements: ElementStatus[] };

export async function fetchPlanning(client: SupabaseClient, eventId: string): Promise<Planning> {
  const { data, error } = await client.rpc("planning_status", { p_event: eventId });
  if (error) throw new Error(`No se pudo leer la planificación: ${error.message}`);
  const raw = (data ?? {}) as { gate?: boolean; elements?: ElementStatus[] };
  return { gate: Boolean(raw.gate), elements: Array.isArray(raw.elements) ? raw.elements : [] };
}

export type CrewPerson = {
  id: string;
  fullName: string;
  defaultRole: string | null;
  role: string | null;
  assigned: boolean;
  photoUrl: string | null;
  docState: DocState;
  docNumber: string | null;
  docExpiresOn: string | null;
  docUrl: string | null;
  phone: string | null;
};

/** Personal del evento y, para los niveles 1 y 2, toda la base de personas de la organización. */
export async function fetchPeopleBoard(client: SupabaseClient, eventId: string): Promise<CrewPerson[]> {
  const { data, error } = await client.rpc("event_people_board", { p_event: eventId });
  if (error) throw new Error(`No se pudo leer el personal: ${error.message}`);
  const rows = (data ?? []) as Record<string, unknown>[];
  const paths = rows.flatMap((r) => [r.photo_path, r.doc_path]).filter((p): p is string => typeof p === "string" && p.length > 0);
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await client.storage.from("evidences").createSignedUrls(paths, 60 * 60);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return rows.map((r) => ({
    id: r.person_id as string,
    fullName: r.full_name as string,
    defaultRole: (r.default_role as string | null) ?? null,
    role: (r.role as string | null) ?? null,
    assigned: Boolean(r.assigned),
    photoUrl: r.photo_path ? (urls.get(r.photo_path as string) ?? null) : null,
    docState: r.doc_state as DocState,
    docNumber: (r.doc_number as string | null) ?? null,
    docExpiresOn: (r.doc_expires_on as string | null) ?? null,
    docUrl: r.doc_path ? (urls.get(r.doc_path as string) ?? null) : null,
    phone: (r.phone as string | null) ?? null,
  }));
}

export type TechItem = {
  id: string;
  category: string;
  title: string;
  detail: string | null;
  quantity: number;
  mandatory: boolean;
  dueHours: number | null;
  status: "pending" | "confirmed" | "not_applicable";
};

export async function fetchTechItems(client: SupabaseClient, eventId: string): Promise<TechItem[]> {
  const { data, error } = await client
    .from("event_tech_items")
    .select("id, category, title, detail, quantity, mandatory, due_hours, status")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`No se pudo leer la lista técnica: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    category: r.category as string,
    title: r.title as string,
    detail: (r.detail as string | null) ?? null,
    quantity: Number(r.quantity),
    mandatory: Boolean(r.mandatory),
    dueHours: (r.due_hours as number | null) ?? null,
    status: r.status as TechItem["status"],
  }));
}

export type Budget = {
  total: number;
  currency: string;
  breakdownVisible: boolean;
  status: "sent" | "approved" | "changes_requested";
  decisionNote: string | null;
  decidedAt: string | null;
  lines: { id: string; title: string; conceptKey: string | null; quantity: number; unitCost: number }[];
};

/** El presupuesto tal como la base deja verlo: null si no hay o si a esta persona no le toca ver montos. */
export async function fetchBudget(client: SupabaseClient, eventId: string): Promise<Budget | null> {
  const { data, error } = await client.from("event_budgets").select("total, currency, breakdown_visible, status, decision_note, decided_at").eq("event_id", eventId).maybeSingle();
  if (error) throw new Error(`No se pudo leer el presupuesto: ${error.message}`);
  if (!data) return null;
  const { data: lines } = await client.from("event_budget_lines").select("id, title, concept_key, quantity, unit_cost").eq("event_id", eventId).order("created_at", { ascending: true });
  return {
    total: Number(data.total),
    currency: data.currency as string,
    breakdownVisible: Boolean(data.breakdown_visible),
    status: data.status as Budget["status"],
    decisionNote: (data.decision_note as string | null) ?? null,
    decidedAt: (data.decided_at as string | null) ?? null,
    lines: (lines ?? []).map((l) => ({ id: l.id as string, title: l.title as string, conceptKey: (l.concept_key as string | null) ?? null, quantity: Number(l.quantity), unitCost: Number(l.unit_cost) })),
  };
}

// ---- Encuesta de cierre (decisión 36) ----

export type MyFeedback = { kind: "learnings" | "satisfaction"; stars: number | null; items: string[]; extra: string | null };

export async function fetchMyFeedback(client: SupabaseClient, eventId: string, userId: string): Promise<MyFeedback | null> {
  const { data, error } = await client.from("event_feedback").select("kind, stars, items, extra").eq("event_id", eventId).eq("profile_id", userId).maybeSingle();
  if (error) throw new Error(`No se pudo leer tu encuesta: ${error.message}`);
  if (!data) return null;
  return { kind: data.kind as MyFeedback["kind"], stars: (data.stars as number | null) ?? null, items: (data.items as string[] | null) ?? [], extra: (data.extra as string | null) ?? null };
}

export type FeedbackRow = MyFeedback & { name: string; title: string | null };

/** Lo que dejó cada persona. Solo devuelve filas a los niveles 1 y 2. */
export async function fetchFeedbackBoard(client: SupabaseClient, eventId: string): Promise<FeedbackRow[]> {
  const { data, error } = await client.rpc("event_feedback_board", { p_event: eventId });
  if (error) throw new Error(`No se pudo leer la encuesta de cierre: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({ name: r.name, title: r.title ?? null, kind: r.kind, stars: r.stars ?? null, items: r.items ?? [], extra: r.extra ?? null }));
}


/** Brief del evento (decisión 41): el guion que carga el backend, con lo que respondió esta persona. */
export type EventBrief = {
  version: number;
  summary: string;
  objective: string | null;
  attendees: string | null;
  /** Esta persona ya confirmó que está enterada de la versión vigente. */
  acked: boolean;
  /** Su última duda, si dejó alguna. */
  doubt: { id: string; question: string; status: "open" | "answered"; answer: string | null; corrected: boolean } | null;
};

export async function fetchBrief(client: SupabaseClient, eventId: string, userId: string): Promise<EventBrief | null> {
  const { data: brief } = await client.from("event_briefs").select("version, summary, objective, attendees").eq("event_id", eventId).maybeSingle();
  if (!brief) return null;
  const [{ data: ack }, { data: doubts }] = await Promise.all([
    client.from("brief_acks").select("version").eq("event_id", eventId).eq("profile_id", userId).eq("version", brief.version).maybeSingle(),
    client.from("brief_doubts").select("id, question, status, answer, corrected").eq("event_id", eventId).eq("profile_id", userId).order("created_at", { ascending: false }).limit(1),
  ]);
  const d = doubts?.[0];
  return {
    version: brief.version as number,
    summary: brief.summary as string,
    objective: (brief.objective as string | null) ?? null,
    attendees: (brief.attendees as string | null) ?? null,
    acked: !!ack,
    doubt: d ? { id: d.id as string, question: d.question as string, status: d.status as "open" | "answered", answer: (d.answer as string | null) ?? null, corrected: !!d.corrected } : null,
  };
}

/** Dudas del brief de todo el evento, para el backend. La base solo se las muestra a él. */
export type BriefDoubt = { id: string; who: string; question: string; status: "open" | "answered"; answer: string | null; createdAt: string };

export async function fetchBriefDoubts(client: SupabaseClient, eventId: string): Promise<BriefDoubt[]> {
  const { data } = await client
    .from("brief_doubts")
    .select("id, question, status, answer, created_at, profiles!brief_doubts_profile_id_fkey (full_name)")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => {
    const p = (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles) as { full_name: string | null } | null;
    return { id: r.id as string, who: p?.full_name ?? "Alguien del equipo", question: r.question as string, status: r.status as "open" | "answered", answer: (r.answer as string | null) ?? null, createdAt: r.created_at as string };
  });
}
