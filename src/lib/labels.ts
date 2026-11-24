// Textos visibles de la app (español de Perú). El código y la base de datos usan inglés.

export type EventRole = "viewer" | "producer" | "backend";
export type EventStatus = "draft" | "planned" | "live" | "closed";
export type ItemStatus = "pending" | "in_progress" | "done" | "at_risk" | "moved" | "cancelled";

export const ROLE_LABEL: Record<EventRole, string> = {
  viewer: "Cliente",
  producer: "Productor",
  backend: "Torre de control",
};

export const ROLE_DESCRIPTION: Record<EventRole, string> = {
  viewer: "Solo lectura: ves la hoja de ruta y la bitácora en vivo.",
  producer: "Operas el evento: corriges la hoja de ruta y registras evidencias.",
  backend: "Configuras el evento, las reglas, los proveedores y los reportes.",
};

/** Estado del evento. Regla 8: el color nunca va solo, siempre con su palabra. */
export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  draft: "Borrador",
  planned: "Programado",
  live: "En vivo",
  closed: "Cerrado",
};

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  done: "Listo",
  at_risk: "En riesgo",
  moved: "Movido",
  cancelled: "Cancelado",
};

export function isEventRole(value: unknown): value is EventRole {
  return value === "viewer" || value === "producer" || value === "backend";
}
