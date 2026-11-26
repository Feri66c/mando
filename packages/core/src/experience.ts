// Minuto a minuto, origen de los cambios y People Experience (decisiones 65 a 69).
// El índice explica el resultado del evento con datos. Lo ajustable vive en config/people-experience.json.
import config from "../../../config/people-experience.json";
import { formatDate, formatTime } from "./time";

export type ChangeOrigin = "cliente" | "produccion" | "eventualidad";
export type MomentTag = "wow" | "eventualidad";
export type FactorKey = "puntualidad" | "cumplimiento" | "estabilidad" | "anticipacion" | "respuesta" | "cliente";

export const CHANGE_ORIGINS = config.origenes as { clave: ChangeOrigin; nombre: string }[];
export const EXPERIENCE_FACTORS = config.factores as { clave: FactorKey; nombre: string; peso: number; detalle: string }[];
export const EXPERIENCE_TOLERANCE_MIN: number = config.tolerancia_minutos;
export const BRIEF_MAX_CHARS = 10000;
export const SYNOPSIS_MAX_CHARS = 600;

export const originLabel = (key: string | null | undefined) => CHANGE_ORIGINS.find((o) => o.clave === key)?.nombre ?? "Sin clasificar";

/** Los números que devuelve la base (función people_experience). Solo conteos, sin nombres. */
export type ExperienceData = {
  changes: Record<string, number>;
  versions: number;
  emergencies: Record<string, number>;
  wow: number;
  eventualidades: number;
  itemsTotal: number;
  itemsDone: number;
  itemsStarted: number;
  itemsOnTime: number;
  alertsTotal: number;
  alertsResolved: number;
  mandos: number;
  fieldPeople: number;
  clientStars: number | null;
  learnings: number;
};

export type ExperienceFactor = {
  key: FactorKey;
  name: string;
  detail: string;
  weight: number;
  /** De 0 a 1, o null si todavía no hay datos para medirlo. */
  value: number | null;
  /** El dato en palabras: «7 de 8 a tiempo». */
  fact: string;
};

export type ExperienceResult = { score: number | null; reading: string | null; factors: ExperienceFactor[] };

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const weighted = (counts: Record<string, number>, weights: Record<string, number>, fallback: number) =>
  Object.entries(counts).reduce((sum, [key, n]) => sum + n * (weights[key] ?? fallback), 0);
const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

/** Arma el índice de 0 a 100 y explica cada factor. Los factores sin datos no cuentan. */
export function peopleExperience(d: ExperienceData): ExperienceResult {
  const changes = total(d.changes);
  const emergencies = total(d.emergencies);
  const measured: Record<FactorKey, { value: number | null; fact: string }> = {
    puntualidad: {
      value: d.itemsStarted > 0 ? d.itemsOnTime / d.itemsStarted : null,
      fact: d.itemsStarted > 0 ? `${d.itemsOnTime} de ${d.itemsStarted} empezaron a su hora` : "Aún no empieza ninguna actividad",
    },
    cumplimiento: {
      value: d.itemsTotal > 0 ? d.itemsDone / d.itemsTotal : null,
      fact: d.itemsTotal > 0 ? `${d.itemsDone} de ${d.itemsTotal} terminadas` : "Sin hoja de ruta",
    },
    estabilidad: {
      value: d.itemsTotal > 0 ? 1 - clamp(weighted(d.changes, config.peso_de_cada_cambio, 0.75) / d.itemsTotal) : null,
      fact: changes === 0 ? "El plan no se movió" : `${changes} ${changes === 1 ? "cambio" : "cambios"} al minuto a minuto`,
    },
    anticipacion: {
      value: 1 - clamp(weighted(d.emergencies, config.peso_de_cada_emergencia, 1) / config.tope_de_emergencias),
      fact: emergencies === 0 ? "Sin cambios de emergencia" : `${emergencies} ${emergencies === 1 ? "cambio" : "cambios"} de emergencia`,
    },
    respuesta: {
      value: d.alertsTotal > 0 ? d.alertsResolved / d.alertsTotal : null,
      fact: d.alertsTotal > 0 ? `${d.alertsResolved} de ${d.alertsTotal} alertas resueltas` : "Sin alertas",
    },
    cliente: {
      value: d.clientStars !== null ? clamp(d.clientStars / 5) : null,
      fact: d.clientStars !== null ? `${d.clientStars} de 5 estrellas` : "El cliente aún no deja su ficha",
    },
  };
  const factors = EXPERIENCE_FACTORS.map((f) => ({ key: f.clave, name: f.nombre, detail: f.detalle, weight: f.peso, ...measured[f.clave] }));
  // El índice necesita al menos lo que pasó en la hoja de ruta: sin eso sería un número vacío.
  const hasField = measured.puntualidad.value !== null || measured.cumplimiento.value !== null;
  const counted = factors.filter((f) => f.value !== null);
  const weight = counted.reduce((sum, f) => sum + f.weight, 0);
  const score = hasField && weight > 0 ? Math.round((counted.reduce((sum, f) => sum + (f.value as number) * f.weight, 0) / weight) * 100) : null;
  const reading = score === null ? null : (config.lecturas.find((l) => score >= l.desde)?.nombre ?? null);
  return { score, reading, factors };
}

/** Cambios aplicados por origen, en el orden de la configuración y con «sin clasificar» al final. */
export function changesByOrigin(changes: Record<string, number>): { key: string; name: string; count: number }[] {
  const rows = CHANGE_ORIGINS.map((o) => ({ key: o.clave as string, name: o.nombre, count: changes[o.clave] ?? 0 }));
  const unclassified = changes.sin_clasificar ?? 0;
  return unclassified > 0 ? [...rows, { key: "sin_clasificar", name: "Sin clasificar", count: unclassified }] : rows;
}

export type MinuteRow = { title: string; start: string; end: string; area?: string | null; milestone?: boolean; status?: string };

/** El minuto a minuto en texto plano, listo para pegar en WhatsApp. */
export function minuteByMinuteText(input: { eventName: string; version: number; rows: MinuteRow[]; timeZone?: string | null; note?: string | null }): string {
  const rows = input.rows.filter((r) => r.status !== "cancelled").sort((a, b) => a.start.localeCompare(b.start));
  const head = [`*${input.eventName}*`, `Minuto a minuto · versión ${input.version}${rows[0] ? ` · ${formatDate(rows[0].start, input.timeZone)}` : ""}`];
  if (input.note) head.push(input.note);
  const lines = rows.map((r) => {
    const time = `${formatTime(r.start, input.timeZone)} – ${formatTime(r.end, input.timeZone)}`;
    return `${time}  ${r.milestone ? "◆ " : ""}${r.title}${r.area ? ` (${r.area})` : ""}`;
  });
  return [...head, "", ...(lines.length > 0 ? lines : ["Aún no hay actividades."])].join("\n");
}

/** Revisa config/people-experience.json: factores, pesos y claves que la base conoce. */
export function validateExperienceConfig(): string[] {
  const problems: string[] = [];
  const keys: FactorKey[] = ["puntualidad", "cumplimiento", "estabilidad", "anticipacion", "respuesta", "cliente"];
  for (const k of keys) if (!EXPERIENCE_FACTORS.some((f) => f.clave === k)) problems.push(`Falta el factor «${k}».`);
  for (const f of EXPERIENCE_FACTORS) {
    if (!keys.includes(f.clave)) problems.push(`El factor «${f.clave}» no existe.`);
    if (!(f.peso > 0)) problems.push(`El factor «${f.clave}» necesita un peso mayor que cero.`);
  }
  if (EXPERIENCE_FACTORS.reduce((s, f) => s + f.peso, 0) !== 100) problems.push("Los pesos tienen que sumar 100.");
  for (const o of ["cliente", "produccion", "eventualidad"]) {
    if (!CHANGE_ORIGINS.some((c) => c.clave === o)) problems.push(`Falta el origen «${o}».`);
    if (!(o in config.peso_de_cada_cambio)) problems.push(`Falta el peso del cambio «${o}».`);
  }
  for (const w of ["con_tiempo", "48h", "24h", "ultimo_minuto"]) if (!(w in config.peso_de_cada_emergencia)) problems.push(`Falta el peso de la ventana «${w}».`);
  if (!(config.tope_de_emergencias > 0)) problems.push("El tope de emergencias tiene que ser mayor que cero.");
  if (!config.lecturas.some((l) => l.desde === 0)) problems.push("Falta la lectura que empieza en 0.");
  return problems;
}
