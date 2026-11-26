import { describe, expect, it } from "vitest";
import { DURATION_STEPS, formatDuration, marginFor, nearestStep, planIssues, validateTimelineConfig, type TimelineItem } from "../src/timeline";

const at = (hhmm: string) => `2027-03-14T${hhmm}:00Z`;
const item = (id: string, title: string, start: string, end: string, estimatedMinutes: number | null = null, isMilestone = false): TimelineItem => ({
  id, title, start: at(start), end: at(end), estimatedMinutes, isMilestone,
});

describe("tiempos del timeline", () => {
  it("la configuración es válida y el control llega a 15 min, 20 min, 2 h y 4 h", () => {
    expect(validateTimelineConfig()).toEqual([]);
    for (const m of [15, 20, 120, 240]) expect(DURATION_STEPS).toContain(m);
  });

  it("escribe las duraciones como se dicen", () => {
    expect(formatDuration(15)).toBe("15 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(90)).toBe("1 h 30 min");
  });

  it("recomienda más margen mientras más larga es la actividad", () => {
    expect(marginFor(30)).toBe(30);
    expect(marginFor(180)).toBe(50);
    expect(marginFor(300)).toBe(120);
  });

  it("el paso más cercano a una duración", () => {
    expect(DURATION_STEPS[nearestStep(60)]).toBe(60);
    expect(DURATION_STEPS[nearestStep(100)]).toBe(90);
  });

  it("avisa cuando el montaje no entra antes del evento", () => {
    const issues = planIssues([item("a", "Montaje", "07:00", "10:00", 240)], at("10:00"));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("evento");
    expect(issues[0]!.message).toBe("Pusiste 4 h para «Montaje» y el evento empieza en 3 h.");
  });

  it("avisa cuando la estimación pasa lo que da la hoja de ruta", () => {
    const issues = planIssues([item("a", "Desmontaje", "18:00", "19:00", 90)], at("10:00"));
    expect(issues.map((i) => i.kind)).toEqual(["plan"]);
    expect(issues[0]!.message).toContain("necesita 1 h 30 min y la hoja de ruta le da 1 h");
  });

  it("pide margen antes de un hito", () => {
    const items = [item("a", "Montaje", "07:00", "10:00"), item("b", "Apertura", "10:00", "10:15", null, true)];
    const tight = planIssues(items, at("10:00"));
    expect(tight.map((i) => i.kind)).toEqual(["margen"]);
    expect(tight[0]!.message).toContain("no queda margen");
    expect(tight[0]!.message).toContain("recomienda 50 min");
    const roomy = planIssues([{ ...items[0]!, estimatedMinutes: 120 }, items[1]!], at("10:00"));
    expect(roomy).toEqual([]);
  });

  it("sin estimaciones ni hitos no hay avisos", () => {
    expect(planIssues([item("a", "Montaje", "07:00", "10:00")], at("10:00"))).toEqual([]);
  });
});
