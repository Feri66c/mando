import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isEventRole, type EventRole, type EventStatus, type ItemStatus } from "@/lib/labels";

// Capa de acceso a datos. Todo pasa por el cliente con la sesión del usuario:
// la base de datos decide qué filas devuelve (seguridad por fila), no esta capa.

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
  areaName: string | null;
  currentStart: string;
  currentEnd: string;
  status: ItemStatus;
  isMilestone: boolean;
  visibleToViewer: boolean;
};

/** Devuelve el cliente o manda a la pantalla de configuración si falta conectar Supabase. */
async function requireClient() {
  const supabase = await createClient();
  if (!supabase) redirect("/ingresar");
  return supabase;
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const supabase = await requireClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/ingresar");
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", data.user.id).maybeSingle();
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    fullName: (profile?.full_name as string | undefined) ?? data.user.email ?? "Usuario",
  };
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
export async function getMyEvents(userId: string): Promise<MyEvent[]> {
  const supabase = await requireClient();
  const { data, error } = await supabase
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

export async function getMyEvent(eventId: string, userId: string): Promise<MyEvent | null> {
  const events = await getMyEvents(userId);
  return events.find((e) => e.id === eventId) ?? null;
}

/** Hoja de ruta del evento, tal como la base de datos permite verla a esta persona. */
export async function getRouteItems(eventId: string): Promise<RouteItem[]> {
  const supabase = await requireClient();
  const { data, error } = await supabase
    .from("route_items")
    .select("id, title, current_start, current_end, status, is_milestone, visible_to_viewer, areas (name)")
    .eq("event_id", eventId)
    .order("current_start", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`No se pudo leer la hoja de ruta: ${error.message}`);
  return (data ?? []).map((r) => {
    const area = (Array.isArray(r.areas) ? r.areas[0] : r.areas) as { name: string } | null;
    return {
      id: r.id as string,
      title: r.title as string,
      areaName: area?.name ?? null,
      currentStart: r.current_start as string,
      currentEnd: r.current_end as string,
      status: r.status as ItemStatus,
      isMilestone: Boolean(r.is_milestone),
      visibleToViewer: Boolean(r.visible_to_viewer),
    };
  });
}
