import { describe, expect, it } from "vitest";
import { formatDate, formatEventRange, formatTime, zoneLabel } from "@/lib/time";

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
