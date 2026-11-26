import { describe, expect, it } from "vitest";
import { MERIT_CONFIG, scoreEvent, starsLabel, validateMeritConfig, type ScoreInputs } from "@mando/core/merits";

const empty: ScoreInputs = {
  items: [],
  commitments: { met: 0, partial: 0, unmet: 0, unchecked: 0 },
  incidents: [],
  mandatories: { ok: 0, failed: 0, pending: 3 },
  star_milestones: { ok: 0, failed: 0, pending: 3 },
  rating: { average: null, count: 0 },
  red_flags: 0,
  started: false,
};

describe("reglas de méritos (config/meritos.json)", () => {
  it("son válidas: los pesos suman 100", () => {
    expect(validateMeritConfig(MERIT_CONFIG)).toEqual([]);
  });
  it("unas reglas con pesos mal sumados se rechazan", () => {
    const broken = { ...MERIT_CONFIG, criterios: MERIT_CONFIG.criterios.slice(0, 2) };
    expect(validateMeritConfig(broken)).toEqual(["Los pesos suman 55, no 100."]);
  });
});

describe("estrellas del evento", () => {
  it("antes de empezar no hay estrellas", () => {
    const s = scoreEvent(empty);
    expect(s.stars).toBeNull();
    expect(s.locked).toBe(false);
    expect(starsLabel(s.stars)).toBe("Sin estrellas todavía");
  });

  it("un evento impecable tiene 5 estrellas", () => {
    const s = scoreEvent({
      ...empty,
      started: true,
      items: [
        { is_milestone: false, start_delay_min: 0 },
        { is_milestone: true, start_delay_min: 8 },
      ],
      commitments: { met: 4, partial: 0, unmet: 0, unchecked: 1 },
      mandatories: { ok: 3, failed: 0, pending: 0 },
      star_milestones: { ok: 3, failed: 0, pending: 0 },
      rating: { average: 5, count: 6 },
    });
    expect(s.stars).toBe(5);
    expect(s.percent).toBe(100);
  });

  it("la pieza clave tarde pesa doble y lo que no tiene datos no cuenta", () => {
    const s = scoreEvent({
      ...empty,
      started: true,
      items: [
        { is_milestone: false, start_delay_min: 0 },
        { is_milestone: false, start_delay_min: 5 },
        { is_milestone: true, start_delay_min: 40 },
      ],
    });
    const punct = s.criteria.find((c) => c.key === "puntualidad")!;
    expect(punct.score).toBe(0.5);
    expect(punct.detail).toBe("2 de 3 piezas a tiempo.");
    // Cuentan puntualidad (30 × 0,5) y respuesta (15 × 1, sin incidentes): 30 de 45 = 67 %.
    expect(s.percent).toBe(67);
    expect(s.stars).toBe(3.5);
    expect(s.criteria.find((c) => c.key === "palabra")!.score).toBeNull();
  });

  it("una pieza que debía empezar y nadie marcó cuenta como tarde", () => {
    const s = scoreEvent({ ...empty, items: [{ is_milestone: false, start_delay_min: null }] });
    expect(s.criteria[0].score).toBe(0);
  });

  it("compromiso parcial vale la mitad; incidente resuelto tarde, la mitad; sin resolver, nada", () => {
    const s = scoreEvent({
      ...empty,
      started: true,
      commitments: { met: 1, partial: 1, unmet: 0, unchecked: 0 },
      incidents: [
        { level: 3, resolve_min: 10 },
        { level: 4, resolve_min: 90 },
        { level: 3, resolve_min: null },
      ],
    });
    expect(s.criteria.find((c) => c.key === "palabra")!.score).toBe(0.75);
    expect(s.criteria.find((c) => c.key === "respuesta")!.score).toBe(0.5);
  });

  it("un no negociable fallado deja el evento en 0 estrellas, aunque todo lo demás salga bien", () => {
    const s = scoreEvent({
      ...empty,
      started: true,
      items: [{ is_milestone: true, start_delay_min: 0 }],
      mandatories: { ok: 2, failed: 1, pending: 0 },
      red_flags: 1,
    });
    expect(s.locked).toBe(true);
    expect(s.stars).toBe(0);
    expect(s.percent).toBe(100);
    expect(s.redFlags).toBe(1);
  });

  it("las estrellas se leen con coma decimal", () => {
    expect(starsLabel(3.5)).toBe("3,5 de 5 estrellas");
  });
});
