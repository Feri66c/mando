import { describe, expect, it } from "vitest";
import {
  backoffMs,
  classifyError,
  describeOp,
  dueOps,
  emptyQueue,
  enqueue,
  markFailed,
  markSent,
  pendingMarks,
  retryNow,
  type QueuedOp,
} from "@mando/core/queue";

const T0 = new Date("2026-12-12T15:00:00Z");
const op = (id: string, minute: number, action: "start" | "finish" = "start"): Omit<QueuedOp, "attempts" | "nextAttemptAt" | "status" | "lastError"> => ({
  id,
  eventId: "e1",
  createdAt: new Date(T0.getTime() + minute * 60_000).toISOString(),
  payload: { kind: "mark", itemId: "sonido", itemTitle: "Prueba de sonido", action, occurredAt: new Date(T0.getTime() + minute * 60_000).toISOString() },
});

describe("cola sin señal", () => {
  it("envía en el orden en que se hizo y no repite la misma operación", () => {
    let q = enqueue(emptyQueue, op("b", 2, "finish"));
    q = enqueue(q, op("a", 1));
    q = enqueue(q, op("a", 1));
    expect(dueOps(q, new Date(T0.getTime() + 10 * 60_000)).map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("al enviarse sale de la cola", () => {
    const q = markSent(enqueue(emptyQueue, op("a", 1)), "a");
    expect(q.ops).toHaveLength(0);
  });

  it("sin señal se reintenta con espera creciente; un «no» de la base queda como fallido", () => {
    let q = enqueue(enqueue(emptyQueue, op("a", 0)), op("b", 0, "finish"));
    q = markFailed(q, "a", { message: "TypeError: Network request failed" }, T0);
    q = markFailed(q, "b", { message: "La actividad «Prueba de sonido» ya terminó.", code: "P0001", status: 400 }, T0);
    const [a, b] = q.ops;
    expect(a).toMatchObject({ status: "pending", attempts: 1 });
    expect(new Date(a.nextAttemptAt).getTime() - T0.getTime()).toBe(5_000);
    expect(b).toMatchObject({ status: "failed", lastError: "La actividad «Prueba de sonido» ya terminó." });
    expect(dueOps(q, new Date(T0.getTime() + 4_000))).toHaveLength(0);
    expect(dueOps(retryNow(q, T0), T0).map((o) => o.id)).toEqual(["a"]); // al volver la señal, ya
  });

  it("clasifica los errores", () => {
    expect(classifyError({ message: "Failed to fetch" })).toBe("retry");
    expect(classifyError({ message: "x", status: 503 })).toBe("retry");
    expect(classifyError({ message: "JWT expired", status: 401 })).toBe("retry");
    expect(classifyError({ message: "No tienes permiso para operar este evento.", status: 403, code: "42501" })).toBe("permanent");
  });

  it("la espera crece hasta 5 minutos", () => {
    expect([1, 2, 3, 10].map(backoffMs)).toEqual([5_000, 10_000, 20_000, 300_000]);
  });

  it("describe y muestra las marcas pendientes al instante", () => {
    const q = enqueue(emptyQueue, op("a", 0));
    expect(describeOp(q.ops[0])).toBe("Empezó «Prueba de sonido»");
    expect(pendingMarks(q, "e1").get("sonido")?.[0].action).toBe("start");
  });
});
