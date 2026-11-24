import { EVENT_STATUS_LABEL, ITEM_STATUS_LABEL, ROLE_LABEL, type EventRole, type EventStatus, type ItemStatus } from "@/lib/labels";

// Regla 8: todo estado lleva su palabra; el color solo acompaña.

export function RolePill({ role }: { role: EventRole }) {
  const style =
    role === "backend"
      ? "bg-navy-800 text-ink-inverse"
      : role === "producer"
        ? "bg-ice-100 text-navy-800"
        : "border border-line bg-surface-100 text-ink-muted";
  return (
    <span className={`inline-flex items-center rounded-chip px-2 py-0.5 text-xs font-semibold ${style}`}>
      {ROLE_LABEL[role]}
    </span>
  );
}

const EVENT_STATUS_DOT: Record<EventStatus, string> = {
  draft: "bg-ice-300",
  planned: "bg-navy-600",
  live: "bg-critical",
  closed: "bg-ink-muted",
};

export function EventStatusText({ status }: { status: EventStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
      <span aria-hidden className={`size-2 rounded-full ${EVENT_STATUS_DOT[status]}`} />
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
