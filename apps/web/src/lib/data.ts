import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  fetchAdminOrgs,
  fetchAlerts,
  fetchBudget,
  fetchPeopleBoard,
  fetchPlanning,
  fetchTechItems,
  fetchApprovalGroups,
  fetchApprovals,
  fetchClosing,
  fetchCriteria,
  fetchGuests,
  fetchLocation,
  fetchRequirements,
  fetchMyRating,
  fetchMyFeedback,
  fetchFeedbackBoard,
  fetchScoreInputs,
  fetchCriticality,
  fetchEventTemplate,
  fetchPendingInvitations,
  fetchTeam,
  fetchEvidences,
  fetchLog,
  fetchMomentDetail,
  fetchMoments,
  fetchMyEvents,
  fetchBrief,
  fetchClientNotices,
  fetchPlanningDeadline,
  fetchBriefDoubts,
  fetchProfileName,
  fetchRouteItems,
  type CurrentUser,
  type MyEvent,
  type RouteItem,
} from "@mando/core/data";
import { parseTemplate } from "@mando/core/event-types";
import { MERIT_CONFIG, scoreEvent } from "@mando/core/merits";

// Capa de acceso a datos de la web: las consultas viven en @mando/core/data (las comparte la app móvil);
// aquí solo se obtiene el cliente con la sesión de la cookie y se manda a ingresar si no hay sesión.
export type { Alert, Approval, Budget, CrewPerson, Planning, TechItem, Closing, EventLocation, Requirement, Commitment, Criterion, Guest, CurrentUser, Evidence, Invitation, LogEntry, Moment, MomentCheck, MyEvent, RouteItem, TeamMember } from "@mando/core/data";

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

// ---- Panel del productor general ----

/** Organizaciones donde la persona puede crear eventos. Vacío = no es productor general. */
export const getAdminOrgs = cache(async function getAdminOrgs(userId: string) {
  return fetchAdminOrgs(await requireClient(), userId);
});

export async function getTeam(eventId: string) {
  return fetchTeam(await requireClient(), eventId);
}

export async function getPendingInvitations(eventId: string) {
  return fetchPendingInvitations(await requireClient(), eventId);
}

/** Plantilla del tipo de evento copiada en el evento, ya revisada. */
export async function getEventTemplate(eventId: string) {
  const { template, createdByName } = await fetchEventTemplate(await requireClient(), eventId);
  return { template: parseTemplate(template), createdByName };
}

// ---- Méritos, cierre y citados ----

/** Estrellas del evento: la base da los números y la cuenta se hace con config/meritos.json. */
export const getEventScore = cache(async function getEventScore(eventId: string) {
  const minLevel = MERIT_CONFIG.criterios.find((c) => c.clave === "respuesta")?.nivel_minimo ?? 3;
  const inputs = await fetchScoreInputs(await requireClient(), eventId, minLevel);
  return { score: scoreEvent(inputs), summary: inputs.summary };
});

export async function getCriteria(eventId: string) {
  return fetchCriteria(await requireClient(), eventId);
}

export async function getClosing(eventId: string) {
  return fetchClosing(await requireClient(), eventId);
}

export async function getMyRating(eventId: string, userId: string) {
  return fetchMyRating(await requireClient(), eventId, userId);
}

export async function getGuests(eventId: string) {
  return fetchGuests(await requireClient(), eventId);
}

// ---- Expediente y locación ----

export async function getRequirements(eventId: string) {
  return fetchRequirements(await requireClient(), eventId);
}

export async function getLocation(eventId: string) {
  return fetchLocation(await requireClient(), eventId);
}

// ---- Aprobaciones del cliente ----

export const getApprovals = cache(async function getApprovals(eventId: string) {
  return fetchApprovals(await requireClient(), eventId);
});

export const getApprovalGroups = cache(async function getApprovalGroups(eventId: string) {
  return fetchApprovalGroups(await requireClient(), eventId);
});

// ---- Planificación ----

export const getPlanning = cache(async function getPlanning(eventId: string) {
  return fetchPlanning(await requireClient(), eventId);
});

export async function getPeopleBoard(eventId: string) {
  return fetchPeopleBoard(await requireClient(), eventId);
}

export async function getTechItems(eventId: string) {
  return fetchTechItems(await requireClient(), eventId);
}

export async function getBudget(eventId: string) {
  return fetchBudget(await requireClient(), eventId);
}

/** Organización dueña del evento: las fotos y copias de DNI se guardan por organización. */
export async function getEventOrganization(eventId: string): Promise<string | null> {
  const { data } = await (await requireClient()).from("events").select("organization_id").eq("id", eventId).maybeSingle();
  return (data?.organization_id as string | undefined) ?? null;
}

export async function getMyFeedback(eventId: string, userId: string) {
  return fetchMyFeedback(await requireClient(), eventId, userId);
}

export async function getFeedbackBoard(eventId: string) {
  return fetchFeedbackBoard(await requireClient(), eventId);
}

/** Brief del evento con lo que respondió esta persona (decisión 41). */
export async function getBrief(eventId: string, userId: string) {
  return fetchBrief(await requireClient(), eventId, userId);
}

/** Dudas sobre el brief, para el backend. */
export async function getBriefDoubts(eventId: string) {
  return fetchBriefDoubts(await requireClient(), eventId);
}

/** Avisos al cliente (MANDO Express). */
export async function getClientNotices(eventId: string) {
  return fetchClientNotices(await requireClient(), eventId);
}

export async function getPlanningDeadline(eventId: string) {
  return fetchPlanningDeadline(await requireClient(), eventId);
}
