// Cola sin señal (decisión 15): lo que se hace en el teléfono sin conexión se guarda aquí y se envía al volver.
// Este módulo es solo la lógica (qué toca enviar, qué se reintenta, qué se da por perdido); la app guarda
// el estado en el teléfono y hace los envíos. Cada operación lleva su propia referencia (client_ref): si llega
// dos veces al servidor, la segunda no hace nada (migración 4).

export type QueuedMark = { kind: "mark"; itemId: string; itemTitle: string; action: "start" | "finish"; occurredAt: string };
export type QueuedAnswer = { kind: "answer"; checkId: string; question: string; answer: string };
export type QueuedEvidence = {
  kind: "evidence";
  eventId: string;
  evidenceKind: "photo" | "audio" | "video" | "document" | "note";
  /** Copia local del archivo (en la carpeta de la app, para que sobreviva a reinicios). */
  localUri: string | null;
  mime: string | null;
  fileName: string | null;
  sha256: string | null;
  note: string | null;
  capturedAt: string;
  routeItemId: string | null;
  momentId: string | null;
  visible: boolean;
};
export type QueuePayload = QueuedMark | QueuedAnswer | QueuedEvidence;

export type QueuedOp = {
  /** También es la referencia que recibe el servidor (client_ref). */
  id: string;
  eventId: string;
  createdAt: string;
  attempts: number;
  nextAttemptAt: string;
  status: "pending" | "failed";
  lastError: string | null;
  payload: QueuePayload;
};

export type QueueState = { ops: QueuedOp[] };

export const emptyQueue: QueueState = { ops: [] };

export function enqueue(state: QueueState, op: Omit<QueuedOp, "attempts" | "nextAttemptAt" | "status" | "lastError">): QueueState {
  if (state.ops.some((o) => o.id === op.id)) return state;
  return { ops: [...state.ops, { ...op, attempts: 0, nextAttemptAt: op.createdAt, status: "pending", lastError: null }] };
}

/** Lo que toca enviar ahora, en el orden en que se hizo (una marca de Empezó va antes que la de Terminó). */
export function dueOps(state: QueueState, now: Date): QueuedOp[] {
  return state.ops
    .filter((o) => o.status === "pending" && new Date(o.nextAttemptAt) <= now)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function markSent(state: QueueState, id: string): QueueState {
  return { ops: state.ops.filter((o) => o.id !== id) };
}

export type ErrorClass = "retry" | "permanent";

/**
 * ¿Se reintenta o no? Sin conexión, servidor caído, demasiados pedidos o sesión vencida: se reintenta.
 * Un «no» de la base (la actividad ya empezó, no tienes permiso): no tiene sentido reintentar.
 */
export function classifyError(error: { message?: string; status?: number; code?: string } | null | undefined): ErrorClass {
  if (!error) return "retry";
  const status = error.status ?? 0;
  const message = (error.message ?? "").toLowerCase();
  if (/network|fetch failed|failed to fetch|timeout|timed out|aborted|offline|socket/.test(message)) return "retry";
  if (status === 0 || status === 401 || status === 408 || status === 429 || status >= 500) return "retry";
  if (/jwt|token is expired|not authenticated/.test(message)) return "retry";
  return "permanent";
}

/** Espera antes del siguiente intento: 5 s, 10 s, 20 s… hasta 5 minutos. */
export function backoffMs(attempts: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 5 * 60_000);
}

export function markFailed(state: QueueState, id: string, error: { message?: string; status?: number; code?: string }, now: Date): QueueState {
  return {
    ops: state.ops.map((o) => {
      if (o.id !== id) return o;
      const attempts = o.attempts + 1;
      if (classifyError(error) === "permanent") {
        return { ...o, attempts, status: "failed", lastError: error.message ?? "No se pudo guardar." };
      }
      return { ...o, attempts, lastError: error.message ?? null, nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)).toISOString() };
    }),
  };
}

/** Descartar una operación que falló para siempre (la persona la vio y la quitó). */
export function discard(state: QueueState, id: string): QueueState {
  return markSent(state, id);
}

/** Reintentar ya todo lo pendiente (al volver la señal o al tocar «Enviar ahora»). */
export function retryNow(state: QueueState, now: Date): QueueState {
  return { ops: state.ops.map((o) => (o.status === "pending" ? { ...o, nextAttemptAt: now.toISOString() } : o)) };
}

/** Texto corto para la lista de pendientes. */
export function describeOp(op: QueuedOp): string {
  const p = op.payload;
  if (p.kind === "mark") return `${p.action === "start" ? "Empezó" : "Terminó"} «${p.itemTitle}»`;
  if (p.kind === "answer") return `Respuesta: ${p.question}`;
  const word = { photo: "Foto", audio: "Nota de voz", video: "Video", document: "Documento", note: "Nota" }[p.evidenceKind];
  return p.note ? `${word}: ${p.note}` : word;
}

/** Estado local que la pantalla muestra antes de que el servidor confirme (la marca se ve al instante). */
export function pendingMarks(state: QueueState, eventId: string): Map<string, QueuedMark[]> {
  const map = new Map<string, QueuedMark[]>();
  for (const op of state.ops) {
    if (op.eventId !== eventId || op.payload.kind !== "mark") continue;
    map.set(op.payload.itemId, [...(map.get(op.payload.itemId) ?? []), op.payload]);
  }
  return map;
}
