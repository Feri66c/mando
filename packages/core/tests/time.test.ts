import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEZONE, ZONE_OPTIONS, formatDate, formatEventRange, formatTime, pickZone, zoneLabel } from "@mando/core/time";

// Regla 10: se guarda en UTC y se muestra en la zona del evento.
describe("horas en la zona del evento", () => {
  it("muestra en hora de Lima un instante guardado en UTC", () => {
    expect(formatTime("2026-12-12T23:30:00Z", "America/Lima")).toBe("18:30");
  });

  it("usa formato de 24 horas", () => {
    expect(formatTime("2026-12-13T03:00:00Z", "America/Lima")).toBe("22:00");
  });

  it("cambia la hora si el evento es en otra zona", () => {
    expect(formatTime("2026-12-12T23:30:00Z", "America/Bogota")).toBe("18:30");
    expect(formatTime("2026-12-12T23:30:00Z", "Europe/Madrid")).toBe("00:30");
  });

  it("si la zona es inválida, usa Lima", () => {
    expect(formatTime("2026-12-12T23:30:00Z", "Marte/Base")).toBe("18:30");
    expect(zoneLabel(null)).toBe("Lima");
  });

  it("las zonas para elegir existen, no se repiten y se leen con nombre propio", () => {
    expect(ZONE_OPTIONS.length).toBeGreaterThan(2);
    expect(new Set(ZONE_OPTIONS.map((z) => z.zona)).size).toBe(ZONE_OPTIONS.length);
    for (const z of ZONE_OPTIONS) expect(() => new Intl.DateTimeFormat("es-PE", { timeZone: z.zona })).not.toThrow();
    expect(zoneLabel("America/Bogota")).toBe("Colombia");
    expect(zoneLabel("America/Argentina/Buenos_Aires")).toBe("Argentina");
    expect(zoneLabel("Asia/Tokyo")).toBe("Tokyo");
    expect(pickZone("America/Bogota")).toBe("America/Bogota");
    expect(pickZone("Marte/Base")).toBe(DEFAULT_TIMEZONE);
    expect(pickZone(null)).toBe(DEFAULT_TIMEZONE);
  });

  it("la fecha también respeta la zona (medianoche UTC sigue siendo el día anterior en Lima)", () => {
    expect(formatDate("2026-12-13T02:00:00Z", "America/Lima")).toMatch(/12/);
  });

  it("arma el rango del evento de ejemplo", () => {
    const text = formatEventRange("2026-12-12T13:00:00Z", "2026-12-13T06:00:00Z", "America/Lima");
    expect(text).toMatch(/12/);
    expect(text).toMatch(/08:00 – 01:00$/);
  });

  it("sin fecha dice que está por definir", () => {
    expect(formatEventRange(null, null, "America/Lima")).toBe("Fecha por definir");
  });
});

describe("hora escrita en la zona del evento → UTC", () => {
  it("19:30 en Lima el día de la prueba de sonido", async () => {
    const { wallTimeToIso } = await import("@mando/core/time");
    expect(wallTimeToIso("19:30", "2026-12-12T19:00:00Z", "America/Lima")).toBe("2026-12-13T00:30:00.000Z");
  });
  it("después de medianoche se entiende como el día siguiente", async () => {
    const { wallTimeToIso } = await import("@mando/core/time");
    // Desmontaje 23:30 Lima (04:30Z del 13) movido a 00:30 → 05:30Z del 13
    expect(wallTimeToIso("00:30", "2026-12-13T04:30:00Z", "America/Lima")).toBe("2026-12-13T05:30:00.000Z");
  });
  it("en Madrid usa su propia diferencia horaria", async () => {
    const { wallTimeToIso } = await import("@mando/core/time");
    expect(wallTimeToIso("20:00", "2026-12-12T10:00:00Z", "Europe/Madrid")).toBe("2026-12-12T19:00:00.000Z");
  });
  it("rechaza horas inválidas", async () => {
    const { wallTimeToIso } = await import("@mando/core/time");
    expect(wallTimeToIso("25:00", "2026-12-12T10:00:00Z", "America/Lima")).toBeNull();
    expect(wallTimeToIso("hola", "2026-12-12T10:00:00Z", "America/Lima")).toBeNull();
  });
});

import { zonedDateTimeToIso } from "@mando/core/time";

describe("fecha y hora del formulario a UTC", () => {
  it("10:00 del 6 de diciembre en Lima son las 15:00 UTC", () => {
    expect(zonedDateTimeToIso("2026-12-06", "10:00", "America/Lima")).toBe("2026-12-06T15:00:00.000Z");
  });
  it("una hora de la noche en Lima cae en el día siguiente en UTC", () => {
    expect(zonedDateTimeToIso("2026-12-06", "21:30", "America/Lima")).toBe("2026-12-07T02:30:00.000Z");
  });
  it("respeta otras zonas y el horario de verano", () => {
    expect(zonedDateTimeToIso("2026-07-01", "09:00", "Europe/Madrid")).toBe("2026-07-01T07:00:00.000Z");
  });
  it("rechaza fechas u horas imposibles", () => {
    expect(zonedDateTimeToIso("2026-02-31", "10:00", "America/Lima")).toBeNull();
    expect(zonedDateTimeToIso("2026-12-06", "25:00", "America/Lima")).toBeNull();
    expect(zonedDateTimeToIso("mañana", "10:00", "America/Lima")).toBeNull();
  });
});
