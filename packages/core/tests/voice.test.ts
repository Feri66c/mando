import { describe, expect, it } from "vitest";
import { matchItem, parseClock, parseDuration, parseVoiceCommand } from "@mando/core/voice";

const ITEMS = [
  { id: "montaje", title: "Montaje de escenario", areaName: "Estructuras" },
  { id: "sonido", title: "Prueba de sonido", areaName: "Sonido" },
  { id: "puertas", title: "Apertura de puertas", areaName: "Logística" },
  { id: "show", title: "Show principal", areaName: "Producción" },
  { id: "desmontaje", title: "Desmontaje", areaName: "Estructuras", status: "done" },
];

describe("duraciones dichas", () => {
  it.each([
    ["una hora", 60],
    ["dos horas", 120],
    ["media hora", 30],
    ["hora y media", 90],
    ["dos horas y media", 150],
    ["45 minutos", 45],
    ["cuarenta y cinco minutos", 45],
    ["quince minutos", 15],
    ["un cuarto de hora", 15],
    ["1 hora 20 minutos", 80],
  ])("«%s» son %i minutos", (text, minutes) => {
    expect(parseDuration(text)).toBe(minutes);
  });
  it("sin duración devuelve null", () => {
    expect(parseDuration("empieza el show")).toBeNull();
  });
});

describe("horas dichas", () => {
  it.each([
    ["a las 19:30", "19:30"],
    ["a las 7 y media", "07:30"],
    ["a las 20", "20:00"],
  ])("«%s» → %s", (text, at) => expect(parseClock(text)).toBe(at));
});

describe("qué actividad nombró", () => {
  it("encuentra por título o por área, sin tildes", () => {
    expect(matchItem("dame una hora más en sonido", ITEMS)?.id).toBe("sonido");
    expect(matchItem("la apertura de puertas", ITEMS)?.id).toBe("puertas");
    expect(matchItem("LOGÍSTICA", ITEMS)?.id).toBe("puertas");
  });
  it("no adivina cuando hay empate ni elige actividades terminadas", () => {
    expect(matchItem("estructuras", ITEMS)?.id).toBe("montaje"); // el desmontaje ya terminó
    expect(matchItem("algo que no existe", ITEMS)).toBeNull();
  });
});

describe("la frase completa", () => {
  it("«Dame una hora más en sonido» alarga la prueba de sonido 60 minutos", () => {
    expect(parseVoiceCommand("Dame una hora más en sonido", ITEMS)).toEqual({
      itemId: "sonido",
      itemTitle: "Prueba de sonido",
      kind: "extend",
      minutes: 60,
      at: null,
      summary: "Alargar «Prueba de sonido» 60 min",
    });
  });
  it("atrasar y adelantar mueven la actividad", () => {
    expect(parseVoiceCommand("atrasa la apertura media hora", ITEMS)).toMatchObject({ itemId: "puertas", kind: "move", minutes: 30 });
    expect(parseVoiceCommand("adelanta el show 15 minutos", ITEMS)).toMatchObject({ itemId: "show", kind: "move", minutes: -15 });
  });
  it("acortar resta minutos", () => {
    expect(parseVoiceCommand("acorta el montaje veinte minutos", ITEMS)).toMatchObject({ itemId: "montaje", kind: "extend", minutes: -20 });
  });
  it("una hora concreta mueve a esa hora", () => {
    expect(parseVoiceCommand("pasa la apertura de puertas a las 19:30", ITEMS)).toMatchObject({ kind: "move", minutes: null, at: "19:30" });
  });
  it("sin actividad nombrada usa la de Ahora", () => {
    expect(parseVoiceCommand("dame diez minutos más", ITEMS, "montaje")).toMatchObject({ itemId: "montaje", minutes: 10 });
  });
  it("si no entiende, devuelve null (la app le pregunta a Claude)", () => {
    expect(parseVoiceCommand("el proveedor no llegó", ITEMS, "montaje")).toBeNull();
    expect(parseVoiceCommand("dame una hora más", ITEMS)).toBeNull(); // sin actividad y sin «Ahora»
  });
});
