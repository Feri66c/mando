import { describe, expect, it } from "vitest";
import { budgetLinesTotal, budgetWarnings, planningProgress, planningReady, techDeadline, techItemsFor, validatePlanningConfig } from "../src/planning";
import { withDocuments } from "../src/requirements";

describe("planificación", () => {
  it("la configuración es coherente", () => {
    expect(validatePlanningConfig()).toEqual([]);
  });

  it("solo con los cinco elementos listos se desbloquea", () => {
    const all = ["legal", "personal", "tecnico", "presupuesto", "aprobaciones"].map((key) => ({ key, ready: true, done: 1, total: 1, missing: [] }));
    expect(planningReady(all)).toBe(true);
    const four = all.map((s) => (s.key === "presupuesto" ? { ...s, ready: false, missing: ["Falta la aprobación del cliente"] } : s));
    expect(planningReady(four)).toBe(false);
    expect(planningProgress(four)).toEqual({ ready: 4, total: 5 });
    expect(planningReady(all.slice(0, 4))).toBe(false);
  });

  it("cada tipo de evento nace con su lista técnica y con el candado puesto", () => {
    const podcast = withDocuments({ clave: "podcast" });
    expect(podcast.planificacion).toBe(true);
    expect(podcast.tecnica.map((t) => t.titulo)).toContain("Cámaras");
    expect(techItemsFor("sampling").some((t) => t.obligatorio)).toBe(true);
    expect(techItemsFor("sampling").find((t) => t.titulo === "Parlante portátil")?.plazo_horas).toBe(24);
  });

  it("lo que no es obligatorio se completa hasta 24 o 2 horas antes", () => {
    expect(techDeadline("2026-12-06T15:00:00Z", 2)?.toISOString()).toBe("2026-12-06T13:00:00.000Z");
    expect(techDeadline("2026-12-06T15:00:00Z", null)).toBeNull();
  });

  it("avisa cuando una partida está por debajo del mercado", () => {
    const lines = [
      { title: "Transporte", conceptKey: "viaje-urbano", quantity: 15, unitCost: 10 },
      { title: "Anfitrionas", conceptKey: "anfitriona", quantity: 4, unitCost: 150 },
      { title: "Varios", conceptKey: null, quantity: 1, unitCost: 1 },
    ];
    const warnings = budgetWarnings(lines);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("15 × S/ 10.00 por viaje");
    expect(budgetLinesTotal(lines)).toBe(751);
  });
});

describe("semáforo del avance", () => {
  const el = (key: string, done: number, total: number) => ({ key, ready: done >= total, done, total, missing: done >= total ? [] : ["falta"] });
  it("va de rojo a amarillo y solo es verde con todo completo", async () => {
    const { planningSemaphore } = await import("../src/planning");
    const keys = ["legal", "personal", "tecnico", "presupuesto", "aprobaciones"];
    expect(planningSemaphore(keys.map((k) => el(k, 0, 2)))).toMatchObject({ percent: 0, color: "rojo" });
    expect(planningSemaphore([el("legal", 2, 2), el("personal", 2, 2), el("tecnico", 1, 2), el("presupuesto", 1, 1), el("aprobaciones", 0, 4)])).toMatchObject({ percent: 55, color: "amarillo" });
    expect(planningSemaphore(keys.map((k) => el(k, 2, 2)))).toEqual({ percent: 100, color: "verde", label: "Verde total · todo completo" });
    // Casi completo nunca marca 100: el verde total es solo con todo listo.
    expect(planningSemaphore([...keys.slice(0, 4).map((k) => el(k, 9, 9)), el("aprobaciones", 199, 200)]).percent).toBeLessThan(100);
  });
});
