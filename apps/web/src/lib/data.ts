import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  fetchAlerts,
  fetchCriticality,
  fetchEvidences,
  fetchLog,
  fetchMomentDetail,
  fetchMoments,
  fetchMyEvents,
  fetchProfileName,
  fetchRouteItems,
  type CurrentUser,
  type MyEvent,
  type RouteItem,
} from "@mando/core/data";

// Capa de acceso a datos de la web: las consultas viven en @mando/core/data (las comparte la app móvil);
// aquí solo se obtiene el cliente con la sesión de la cookie y se manda a ingresar si no hay sesión.
export type { Alert, Commitment, CurrentUser, Evidence, LogEntry, Moment, MomentCheck, MyEvent, RouteItem } from "@mando/core/data";

/** Devuelve el cliente o manda a la pantalla de ingreso si falta conectar Supabase. */
async function requireClient() {
  const supabase = await createClient();
  if (!supabase) redirect("/ingresar");
  return supabase;
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const supabase = await requireClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/ingresar");
  const fullName = await fetchProfileName(supabase, data.user.id, data.user.email ?? "Usuario");
  return { id: data.user.id, email: data.user.email ?? null, fullName };
}

/** «Mis eventos»: los eventos donde la persona es miembro, con su rol en cada uno. */
export async function getMyEvents(userId: string): Promise<MyEvent[]> {
  return fetchMyEvents(await requireClient(), userId);
}

export async function getMyEvent(eventId: string, userId: string): Promise<MyEvent | null> {
  const events = await getMyEvents(userId);
  return events.find((e) => e.id === eventId) ?? null;
}

/** Hoja de ruta del evento, tal como la base de datos permite verla a esta persona. */
export async function getRouteItems(eventId: string): Promise<RouteItem[]> {
  return fetchRouteItems(await requireClient(), eventId);
}

export async function getRouteItem(eventId: string, itemId: string): Promise<RouteItem | null> {
  const items = await getRouteItems(eventId);
  return items.find((i) => i.id === itemId) ?? null;
}

/** Evento + rol + escala de criticidad. Devuelve null si la persona no es miembro. Una vez por pedido. */
export const getEventContext = cache(async function getEventContext(eventId: string) {
  const user = await getCurrentUser();
  const event = await getMyEvent(eventId, user.id);
  if (!event) return null;
  const criticality = await fetchCriticality(await requireClient(), eventId);
  return { user, event, criticality, isTeam: event.role !== "viewer" };
});

/** Bitácora, de la más reciente a la más antigua. */
export async function getLog(eventId: string, limit = 100) {
  return fetchLog(await requireClient(), eventId, limit);
}

export const getAlerts = cache(async function getAlerts(eventId: string) {
  return fetchAlerts(await requireClient(), eventId);
});

/** Momentos críticos del evento (solo el equipo los ve; para el cliente la lista llega vacía). */
export async function getMoments(eventId: string) {
  return fetchMoments(await requireClient(), eventId);
}

export async function getMomentDetail(eventId: string, momentId: string) {
  return fetchMomentDetail(await requireClient(), eventId, momentId);
}

/** Evidencias con enlaces firmados de corta duración (los archivos son privados). */
export async function getEvidences(eventId: string, filter: { routeItemId?: string; momentId?: string } = {}) {
  return fetchEvidences(await requireClient(), eventId, filter);
}
