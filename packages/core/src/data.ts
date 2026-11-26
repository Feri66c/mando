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
};

const EVENT_COLUMNS = "id, name, event_type, client_name, venue_name, timezone, starts_at, ends_at, status";

function toMyEvent(e: EventRow, role: EventRole, title: string | null): MyEvent {
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
  };
}

/** «Mis eventos»: los eventos donde la persona es miembro, con su rol en cada uno. */
export async function fetchMyEvents(client: SupabaseClient, userId: string): Promise<MyEvent[]> {
  const { data, error } = await client
    .from("event_members")
    .select(`role, title, events (${EVENT_COLUMNS})`)
    .eq("profile_id", userId);
  if (error) throw new Error(`No se pudieron leer tus eventos: ${error.message}`);

  return (data ?? [])
    .map((row) => {
      const event = (Array.isArray(row.events) ? row.events[0] : row.events) as EventRow | null;
      if (!event || !isEventRole(row.role)) return null;
      return toMyEvent(event, row.role, row.title as string | null);
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
       status, is_milestone, visible_to_viewer,
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
