import { describe, expect, it } from "vitest";
import { contrast, levelChipColors, levelOf } from "@mando/core/criticality";
import { evidencePath, kindFromMime, safeExtension, sha256Hex } from "@mando/core/evidence";
import { formatLateness, formatShift, minutesLate, nowAndNext } from "@mando/core/route";

const item = (id: string, start: string, end: string, extra: Partial<{ actualStart: string; actualEnd: string; status: string }> = {}) => ({
  id,
  currentStart: start,
  currentEnd: end,
  actualStart: extra.actualStart ?? null,
  actualEnd: extra.actualEnd ?? null,
  status: extra.status ?? "pending",
});

describe("Modo En Vivo: ahora y sigue", () => {
  const items = [
    item("montaje", "2026-12-12T13:00:00Z", "2026-12-12T18:00:00Z"),
    item("sonido", "2026-12-12T19:00:00Z", "2026-12-12T21:00:00Z"),
    item("puertas", "2026-12-12T23:30:00Z", "2026-12-13T01:00:00Z"),
  ];

  it("antes de empezar: no hay «ahora» y «sigue» es la primera", () => {
    const r = nowAndNext(items, new Date("2026-12-12T12:00:00Z"));
    expect(r.current).toBeNull();
    expect(r.next?.id).toBe("montaje");
  });

  it("si llegó la hora y no empezó, «ahora» es esa actividad", () => {
    const r = nowAndNext(items, new Date("2026-12-12T13:05:00Z"));
    expect(r.current?.id).toBe("montaje");
    expect(r.next?.id).toBe("sonido");
  });

  it("la que está en curso manda, aunque otra ya debía empezar", () => {
    const list = [{ ...items[0], actualStart: "2026-12-12T13:10:00Z", status: "in_progress" }, items[1], items[2]];
    const r = nowAndNext(list, new Date("2026-12-12T19:30:00Z"));
    expect(r.current?.id).toBe("montaje");
    expect(r.next?.id).toBe("sonido");
  });

  it("las terminadas no cuentan", () => {
    const list = [{ ...items[0], status: "done", actualStart: "x", actualEnd: "y" }, items[1], items[2]];
    expect(nowAndNext(list, new Date("2026-12-12T18:30:00Z")).next?.id).toBe("sonido");
  });

  it("minutos tarde y su texto", () => {
    expect(minutesLate("2026-12-12T13:00:00Z", "2026-12-12T13:15:00Z", new Date())).toBe(15);
    expect(formatShift(60)).toBe("+60 min");
    expect(formatShift(-15)).toBe("−15 min");
    expect(formatShift(0)).toBe("a tiempo");
  });
});

describe("etiquetas de criticidad en el tema oscuro (decisión 10)", () => {
  const DARK = "#061428";
  it("Red Flag, que es del mismo azul que el fondo, pasa a blanca con texto azul noche", () => {
    expect(levelChipColors("#061428", DARK)).toEqual({ bg: "#ffffff", fg: "#061428", border: "#ffffff" });
  });
  it("en el tema claro Red Flag sigue azul noche con texto blanco", () => {
    expect(levelChipColors("#061428", "#f7f9fc")).toEqual({ bg: "#061428", fg: "#ffffff", border: "#061428" });
  });
  it("todas las etiquetas se leen (contraste AA de 4.5 o más)", () => {
    for (const color of ["#a9cce8", "#c9a227", "#b3402e", "#061428"]) {
      for (const bg of [DARK, "#f7f9fc"]) {
        const chip = levelChipColors(color, bg);
        expect(contrast(chip.bg, chip.fg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it("sin configuración usa los nombres acordados", () => {
    expect(levelOf(null, 4).nombre).toBe("Red Flag");
  });
});

describe("evidencias", () => {
  it("deduce el tipo del archivo", () => {
    expect(kindFromMime("image/jpeg")).toBe("photo");
    expect(kindFromMime("audio/webm")).toBe("audio");
    expect(kindFromMime("video/mp4")).toBe("video");
    expect(kindFromMime("application/pdf")).toBe("document");
  });
  it("arma una ruta segura dentro de la carpeta del evento", () => {
    expect(evidencePath("e1", "abc", "Rider Técnico.PDF")).toBe("e1/abc.pdf");
    expect(safeExtension("../../etc/passwd")).toBe("bin");
    expect(safeExtension("sin-extension")).toBe("bin");
  });
  it("calcula la huella SHA-256", async () => {
    const hash = await sha256Hex(new TextEncoder().encode("MANDO").buffer as ArrayBuffer);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(await sha256Hex(new TextEncoder().encode("MANDO").buffer as ArrayBuffer));
  });
});

describe("formatLateness", () => {
  it("dice tarde, antes o a tiempo", () => {
    expect(formatLateness(12)).toBe("12 min tarde");
    expect(formatLateness(-5)).toBe("5 min antes");
    expect(formatLateness(0)).toBe("a tiempo");
  });
  it("calla cuando la marca es de otro día", () => {
    expect(formatLateness(-23565)).toBeNull();
  });
});
