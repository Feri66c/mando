import { describe, expect, it } from "vitest";
import { changesByOrigin, minuteByMinuteText, originLabel, peopleExperience, validateExperienceConfig, type ExperienceData } from "@mando/core/experience";

const base: ExperienceData = {
  changes: {}, versions: 1, emergencies: {}, wow: 0, eventualidades: 0, itemsTotal: 10, itemsDone: 10, itemsStarted: 10, itemsOnTime: 10,
  alertsTotal: 2, alertsResolved: 2, mandos: 4, fieldPeople: 12, clientStars: 5, learnings: 3,
};

describe("People Experience", () => {
  it("la configuración está completa y los pesos suman 100", () => {
    expect(validateExperienceConfig()).toEqual([]);
  });

  it("un evento redondo saca 100", () => {
    const r = peopleExperience(base);
    expect(r.score).toBe(100);
    expect(r.reading).toBe("Experiencia sobresaliente");
    expect(r.factors.map((f) => f.key)).toEqual(["puntualidad", "cumplimiento", "estabilidad", "anticipacion", "respuesta", "cliente"]);
  });

  it("cada tropiezo baja su factor y se explica en palabras", () => {
    const r = peopleExperience({ ...base, itemsOnTime: 5, changes: { produccion: 2, cliente: 4 }, emergencies: { ultimo_minuto: 1, con_tiempo: 5 }, alertsResolved: 1, clientStars: 4 });
    const f = Object.fromEntries(r.factors.map((x) => [x.key, x]));
    expect(f.puntualidad).toMatchObject({ value: 0.5, fact: "5 de 10 empezaron a su hora" });
    expect(f.estabilidad.value).toBeCloseTo(0.7); // 2 de producción + 4 del cliente a 0,25 = 3 sobre 10 actividades
    expect(f.estabilidad.fact).toBe("6 cambios al minuto a minuto");
    expect(f.anticipacion.value).toBeCloseTo(2 / 3); // uno de último minuto sobre un tope de 3; los que llegan con tiempo no pesan
    expect(f.respuesta.value).toBe(0.5);
    expect(f.cliente.value).toBe(0.8);
    // 0,5·30 + 1·20 + 0,7·15 + 0,667·10 + 0,5·10 + 0,8·15 = 69,2
    expect(r.score).toBe(69);
    expect(r.reading).toBe("Experiencia con tropiezos");
  });

  it("un cambio del cliente pesa menos que uno de producción", () => {
    const client = peopleExperience({ ...base, changes: { cliente: 4 } }).score!;
    const production = peopleExperience({ ...base, changes: { produccion: 4 } }).score!;
    expect(client).toBeGreaterThan(production);
  });

  it("lo que no tiene datos no cuenta, y sin hoja de ruta no hay índice", () => {
    const partial = peopleExperience({ ...base, clientStars: null, alertsTotal: 0, alertsResolved: 0 });
    expect(partial.score).toBe(100);
    expect(partial.factors.find((f) => f.key === "cliente")).toMatchObject({ value: null, fact: "El cliente aún no deja su ficha" });
    const empty = peopleExperience({ ...base, itemsTotal: 0, itemsDone: 0, itemsStarted: 0, itemsOnTime: 0 });
    expect(empty.score).toBeNull();
    expect(empty.reading).toBeNull();
  });

  it("ordena los cambios por origen y solo muestra «sin clasificar» si hay", () => {
    expect(changesByOrigin({ produccion: 2 }).map((c) => `${c.name}:${c.count}`)).toEqual(["Pedido del cliente:0", "Producción:2", "Eventualidad:0"]);
    expect(changesByOrigin({ sin_clasificar: 1 }).at(-1)).toEqual({ key: "sin_clasificar", name: "Sin clasificar", count: 1 });
    expect(originLabel("eventualidad")).toBe("Eventualidad");
    expect(originLabel(null)).toBe("Sin clasificar");
  });
});

describe("minuto a minuto en texto", () => {
  it("lo arma en orden, con la hora del evento, y deja fuera lo cancelado", () => {
    const text = minuteByMinuteText({
      eventName: "Convención anual",
      version: 3,
      timeZone: "America/Lima",
      rows: [
        { title: "Show central", start: "2026-12-13T01:00:00Z", end: "2026-12-13T04:00:00Z", milestone: true },
        { title: "Prueba de sonido", start: "2026-12-12T19:00:00Z", end: "2026-12-12T21:00:00Z", area: "Sonido" },
        { title: "Ensayo", start: "2026-12-12T20:00:00Z", end: "2026-12-12T20:30:00Z", status: "cancelled" },
      ],
    });
    const lines = text.split("\n");
    expect(lines[0]).toBe("*Convención anual*");
    expect(lines[1]).toContain("Minuto a minuto · versión 3");
    expect(lines.slice(3)).toEqual(["14:00 – 16:00  Prueba de sonido (Sonido)", "20:00 – 23:00  ◆ Show central"]);
  });

  it("sin actividades lo dice", () => {
    expect(minuteByMinuteText({ eventName: "Evento", version: 1, rows: [] })).toContain("Aún no hay actividades.");
  });
});
