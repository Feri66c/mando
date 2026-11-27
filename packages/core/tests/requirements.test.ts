import { describe, expect, it } from "vitest";
import { EVENT_TEMPLATES, getTemplate } from "@mando/core/event-types";
import { LAST_MINUTE_KINDS, validateLastMinute } from "@mando/core/evidence";
import { PRESSURE_DAYS, REQUIREMENT_CAP_HOURS, SWORN_STATEMENT, countdown, documentsFor, dueLabel, dueState, requirementCap, requirementReminder, validateCatalog, withDocuments } from "@mando/core/requirements";

describe("expediente (config/expediente.json)", () => {
  it("el catálogo es válido y todo tipo de evento tiene documentos", () => {
    expect(validateCatalog()).toEqual([]);
    for (const t of EVENT_TEMPLATES) expect(documentsFor(t.clave).length).toBeGreaterThan(4);
  });

  it("el tope es 48 horas antes de la hora clave y viaja con la plantilla del evento", () => {
    expect(REQUIREMENT_CAP_HOURS).toBe(48);
    expect(requirementCap("2026-12-06T15:00:00Z")).toBe("2026-12-04T15:00:00.000Z");
    expect(requirementCap(null)).toBeNull();
    const t = withDocuments(getTemplate("sampling")!);
    expect(t.tope_documentos_horas).toBe(48);
    expect(t.presion_dias).toEqual([...PRESSURE_DAYS]);
    // Ningún documento previo al evento vence dentro de las últimas 48 horas.
    for (const tpl of EVENT_TEMPLATES) for (const d of documentsFor(tpl.clave)) if (d.plazo_dias <= 0) expect(d.plazo_dias).toBeLessThanOrEqual(-2);
    expect(SWORN_STATEMENT).toMatch(/bajo juramento/);
  });

  it("la cuenta regresiva separa días, horas, minutos y segundos, y avisa si ya pasó", () => {
    const now = new Date("2026-12-01T00:00:00Z");
    expect(countdown("2026-12-03T01:02:03Z", now)).toEqual({ past: false, days: 2, hours: 1, minutes: 2, seconds: 3 });
    expect(countdown("2026-11-30T23:00:00Z", now)).toEqual({ past: true, days: 0, hours: 1, minutes: 0, seconds: 0 });
  });

  it("los tipos de último minuto son válidos", () => {
    expect(validateLastMinute()).toEqual([]);
    expect(LAST_MINUTE_KINDS.map((k) => k.clave)).toEqual(expect.arrayContaining(["permiso", "personal", "pago"]));
  });

  it("cada tipo recibe lo suyo: el concierto pide permiso municipal; el podcast, uso de imagen y no pide permiso", () => {
    const concert = documentsFor("concierto").map((d) => d.clave);
    const podcast = documentsFor("podcast").map((d) => d.clave);
    expect(concert).toEqual(expect.arrayContaining(["permiso-municipal", "plan-seguridad", "sctr", "facturas"]));
    expect(podcast).toContain("uso-de-imagen");
    expect(podcast).not.toContain("permiso-municipal");
    expect(podcast).toContain("facturas");
  });

  it("la plantilla que se guarda en el evento lleva su lista de documentos", () => {
    const t = withDocuments(getTemplate("sampling")!);
    expect(t.piezas).toHaveLength(5);
    expect(t.documentos.find((d) => d.clave === "permiso-municipal")).toEqual({
      clave: "permiso-municipal",
      titulo: "Permiso municipal",
      categoria: "permisos",
      plazo_dias: -5,
      no_negociable: true,
    });
  });
});

describe("plazos y recordatorios", () => {
  const now = new Date("2026-12-01T15:00:00Z");
  const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();

  it("dice cuánto falta, si vence pronto o si ya venció", () => {
    expect(dueState({ status: "pending", dueAt: inDays(5) }, now)).toEqual({ state: "on_track", days: 5 });
    expect(dueState({ status: "pending", dueAt: inDays(2) }, now)).toEqual({ state: "soon", days: 2 });
    expect(dueState({ status: "pending", dueAt: inDays(-3) }, now)).toEqual({ state: "overdue", days: 3 });
    expect(dueState({ status: "done", dueAt: inDays(-3) }, now).state).toBe("done");
    expect(dueState({ status: "not_applicable", dueAt: inDays(1) }, now).state).toBe("not_applicable");
    expect(dueLabel({ state: "soon", days: 2 })).toBe("Quedan 2 días");
    expect(dueLabel({ state: "overdue", days: 1 })).toBe("Venció ayer");
  });

  it("el recordatorio nombra a la persona, el plazo y que es no negociable", () => {
    expect(
      requirementReminder({ name: "Tatiana Ríos", title: "Permiso municipal", eventName: "Feria Sodimac", due: { state: "soon", days: 2 }, mandatory: true }),
    ).toBe("Tatiana, falta subir «Permiso municipal» de Feria Sodimac: te quedan 2 días. Recuerda que es un requisito no negociable. Súbelo en MANDO, en Más → Expediente.");
  });
});
