// Textos visibles de la app (español de Perú). El código y la base de datos usan inglés.

export type EventRole = "viewer" | "producer" | "backend";
export type EventStatus = "draft" | "planned" | "live" | "closed";
export type ItemStatus = "pending" | "in_progress" | "done" | "at_risk" | "moved" | "cancelled";

export const ROLE_LABEL: Record<EventRole, string> = {
  viewer: "Cliente",
  producer: "Productor",
  backend: "Backend",
};

export const ROLE_DESCRIPTION: Record<EventRole, string> = {
  viewer: "MANDO Express: recibes los avisos de tu evento y apruebas lo que te toca.",
  producer: "Operas el evento: corriges la hoja de ruta y registras evidencias.",
  backend: "Configuras el evento, das instrucciones al productor e informas al cliente.",
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

export type AlertStatus = "open" | "acknowledged" | "resolved";
export type MomentStatus = "scheduled" | "open" | "resolved" | "escalated";
export type CommitmentOutcome = "met" | "partial" | "unmet";
export type EvidenceKind = "photo" | "audio" | "video" | "document" | "note";

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  open: "Abierta",
  acknowledged: "Reconocida",
  resolved: "Resuelta",
};

export const MOMENT_STATUS_LABEL: Record<MomentStatus, string> = {
  scheduled: "Programado",
  open: "Abierto",
  resolved: "Resuelto",
  escalated: "Escalado",
};

export const COMMITMENT_OUTCOME_LABEL: Record<CommitmentOutcome, string> = {
  met: "Cumplido",
  partial: "Parcial",
  unmet: "Incumplido",
};

export const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
  photo: "Foto",
  audio: "Audio",
  video: "Video",
  document: "Documento",
  note: "Nota",
};
