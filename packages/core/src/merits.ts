// Méritos del evento (decisión 22): estrellas, no negociables y banderas.
// Las reglas viven en datos (config/meritos.json). Aquí solo está la cuenta, que es pura y se prueba sola.
import config from "../../../config/meritos.json";

export type CriterionKey = "puntualidad" | "palabra" | "respuesta" | "wow" | "valoracion";

export type MeritConfig = {
  estrellas_maximas: number;
  criterios: {
    clave: CriterionKey;
    nombre: string;
    peso: number;
    explicacion: string;
    tolerancia_min?: number;
    peso_pieza_clave?: number;
    valor_parcial?: number;
    nivel_minimo?: number;
    minutos_para_resolver?: number;
    valor_tarde?: number;
  }[];
  no_negociables: { explicacion: string; nivel_alerta: number };
};

export const MERIT_CONFIG = config as unknown as MeritConfig;

/** Lo que la base entrega para la cuenta (función event_score_inputs). Son números, sin textos internos. */
export type ScoreInputs = {
  /** Piezas que ya debían empezar (o ya empezaron). start_delay_min es null si debía empezar y no se marcó. */
  items: { is_milestone: boolean; start_delay_min: number | null }[];
  commitments: { met: number; partial: number; unmet: number; unchecked: number };
  /** Alertas desde el nivel mínimo. resolve_min es null si sigue sin resolver. */
  incidents: { level: number; resolve_min: number | null }[];
  mandatories: { ok: number; failed: number; pending: number };
  star_milestones: { ok: number; failed: number; pending: number };
  /** Promedio de 1 a 5, o null si nadie valoró todavía. */
  rating: { average: number | null; count: number };
  red_flags: number;
  started: boolean;
};

export type CriterionScore = {
  key: CriterionKey;
  name: string;
  weight: number;
  explanation: string;
  /** De 0 a 1, o null si todavía no hay datos. */
  score: number | null;
  /** Frase corta con el dato: «4 de 5 piezas a tiempo». */
  detail: string;
};

export type EventScore = {
  /** De 0 a 5 en medios puntos, o null si aún no hay nada que medir. */
  stars: number | null;
  /** true si un no negociable falló: las estrellas quedan en 0. */
  locked: boolean;
  /** De 0 a 100, antes de aplicar el bloqueo. */
  percent: number | null;
  criteria: CriterionScore[];
  redFlags: number;
  mandatories: ScoreInputs["mandatories"];
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function scoreCriterion(c: MeritConfig["criterios"][number], input: ScoreInputs): Pick<CriterionScore, "score" | "detail"> {
  switch (c.clave) {
    case "puntualidad": {
      if (input.items.length === 0) return { score: null, detail: "Todavía no empieza ninguna pieza." };
      const tolerance = c.tolerancia_min ?? 10;
      const heavy = c.peso_pieza_clave ?? 2;
      let total = 0;
      let good = 0;
      let onTime = 0;
      for (const item of input.items) {
        const w = item.is_milestone ? heavy : 1;
        total += w;
        if (item.start_delay_min !== null && item.start_delay_min <= tolerance) {
          good += w;
          onTime += 1;
        }
      }
      return { score: good / total, detail: `${onTime} de ${plural(input.items.length, "pieza", "piezas")} a tiempo.` };
    }
    case "palabra": {
      const { met, partial, unmet } = input.commitments;
      const checked = met + partial + unmet;
      if (checked === 0) return { score: null, detail: "Todavía no se revisa ningún compromiso." };
      return {
        score: (met + partial * (c.valor_parcial ?? 0.5)) / checked,
        detail: `${met} de ${plural(checked, "compromiso cumplido", "compromisos cumplidos")}.`,
      };
    }
    case "respuesta": {
      if (input.incidents.length === 0) {
        return input.started ? { score: 1, detail: "Sin incidentes." } : { score: null, detail: "El evento todavía no empieza." };
      }
      const limit = c.minutos_para_resolver ?? 30;
      let sum = 0;
      let inTime = 0;
      for (const i of input.incidents) {
        if (i.resolve_min === null) continue;
        if (i.resolve_min <= limit) {
          sum += 1;
          inTime += 1;
        } else sum += c.valor_tarde ?? 0.5;
      }
      return {
        score: sum / input.incidents.length,
        detail: `${inTime} de ${plural(input.incidents.length, "incidente resuelto", "incidentes resueltos")} en ${limit} min o menos.`,
      };
    }
    case "wow": {
      const { ok, failed, pending } = input.star_milestones;
      const total = ok + failed + pending;
      if (total === 0 || ok + failed === 0) return { score: null, detail: "Todavía no se marca ningún hito estrella." };
      return { score: ok / total, detail: `${ok} de ${plural(total, "hito estrella logrado", "hitos estrella logrados")}.` };
    }
    case "valoracion": {
      if (input.rating.average === null || input.rating.count === 0) return { score: null, detail: "Todavía nadie valoró la producción." };
      const avg = Math.min(5, Math.max(1, input.rating.average));
      return { score: (avg - 1) / 4, detail: `${avg.toFixed(1).replace(".", ",")} de 5 en ${plural(input.rating.count, "valoración", "valoraciones")}.` };
    }
  }
}

/** Estrellas del evento. Un criterio sin datos no cuenta: su peso se reparte entre los demás. */
export function scoreEvent(input: ScoreInputs, cfg: MeritConfig = MERIT_CONFIG): EventScore {
  const criteria: CriterionScore[] = cfg.criterios.map((c) => ({
    key: c.clave,
    name: c.nombre,
    weight: c.peso,
    explanation: c.explicacion,
    ...scoreCriterion(c, input),
  }));
  const measured = criteria.filter((c) => c.score !== null);
  const weight = measured.reduce((sum, c) => sum + c.weight, 0);
  const ratio = weight > 0 ? measured.reduce((sum, c) => sum + c.weight * (c.score as number), 0) / weight : null;
  const locked = input.mandatories.failed > 0;
  const stars = locked ? 0 : ratio === null ? null : Math.round(ratio * cfg.estrellas_maximas * 2) / 2;
  return {
    stars,
    locked,
    percent: ratio === null ? null : Math.round(ratio * 100),
    criteria,
    redFlags: input.red_flags,
    mandatories: input.mandatories,
  };
}

/** «3,5 de 5 estrellas», para lectores de pantalla y para el acta. */
export function starsLabel(stars: number | null, max = MERIT_CONFIG.estrellas_maximas): string {
  if (stars === null) return "Sin estrellas todavía";
  return `${String(stars).replace(".", ",")} de ${max} estrellas`;
}

/** Revisa que las reglas sean usables. */
export function validateMeritConfig(cfg: MeritConfig): string[] {
  const problems: string[] = [];
  const total = cfg.criterios.reduce((s, c) => s + c.peso, 0);
  if (total !== 100) problems.push(`Los pesos suman ${total}, no 100.`);
  if (new Set(cfg.criterios.map((c) => c.clave)).size !== cfg.criterios.length) problems.push("Hay criterios repetidos.");
  if (cfg.estrellas_maximas <= 0) problems.push("Las estrellas máximas deben ser más de 0.");
  return problems;
}
