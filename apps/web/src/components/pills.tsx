import { EVENT_STATUS_LABEL, ITEM_STATUS_LABEL, ROLE_LABEL, type EventRole, type EventStatus, type ItemStatus } from "@mando/core/labels";

// Regla 8: todo estado lleva su palabra; el color solo acompaña.

/** Cuadro de señal del rol: grande y con filo de luz, para saber de un vistazo con qué mando entras. */
export function RolePill({ role }: { role: EventRole }) {
  const tone = role === "backend" ? "var(--gold-300)" : role === "producer" ? "var(--ice-300)" : "var(--ink-muted)";
  return (
    <span className="senal senal-rol" style={{ "--tono": tone } as React.CSSProperties}>
      {ROLE_LABEL[role]}
    </span>
  );
}

// Programado es verde (listo para salir), en vivo rojo, borrador hielo y cerrado gris.
const EVENT_STATUS_TONE: Record<EventStatus, string> = {
  draft: "var(--ice-300)",
  planned: "var(--ok)",
  live: "var(--critical)",
  closed: "var(--ink-muted)",
};

/** Cuadro de señal del estado: un pulsador que late siempre mientras el evento no esté cerrado. */
export function EventStatusText({ status }: { status: EventStatus }) {
  return (
    <span className="senal" data-vivo={status === "closed" ? undefined : ""} style={{ "--tono": EVENT_STATUS_TONE[status] } as React.CSSProperties}>
      <span aria-hidden className="senal-punto" />
      {EVENT_STATUS_LABEL[status]}
    </span>
  );
}

const ITEM_STATUS_DOT: Record<ItemStatus, string> = {
  pending: "bg-ice-300",
  in_progress: "bg-navy-600",
  done: "bg-ok",
  at_risk: "bg-critical",
  moved: "bg-ice-500",
  cancelled: "bg-ink-muted",
};

export function ItemStatusText({ status }: { status: ItemStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted">
      <span aria-hidden className={`size-2 rounded-full ${ITEM_STATUS_DOT[status]}`} />
      {ITEM_STATUS_LABEL[status]}
    </span>
  );
}
