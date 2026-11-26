// Cálculos de la hoja de ruta que comparten la web y (en la Etapa 2) la app móvil.

export type TimedItem = {
  id: string;
  currentStart: string;
  currentEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  status: string;
};

const CLOSED = new Set(["done", "cancelled"]);

/**
 * «Ahora» y «Sigue» del Modo En Vivo.
 * Ahora = la actividad en curso más antigua; si no hay ninguna, la primera pendiente cuya hora ya llegó.
 * Sigue = la primera pendiente después de «ahora».
 */
export function nowAndNext<T extends TimedItem>(items: T[], now: Date): { current: T | null; next: T | null } {
  const sorted = [...items].sort((a, b) => a.currentStart.localeCompare(b.currentStart));
  const open = sorted.filter((i) => !CLOSED.has(i.status));
  const inProgress = open.find((i) => i.actualStart && !i.actualEnd) ?? null;
  const due = open.find((i) => !i.actualStart && new Date(i.currentStart) <= now) ?? null;
  const current = inProgress ?? due;
  const next = open.find((i) => i !== current && !i.actualStart && (!current || i.currentStart >= current.currentStart)) ?? null;
  return { current, next };
}

/** Minutos entre la hora vigente y la real (o ahora, si aún no ocurre). Positivo = tarde. */
export function minutesLate(plannedIso: string, actualIso: string | null, now: Date): number {
  const actual = actualIso ? new Date(actualIso) : now;
  return Math.round((actual.getTime() - new Date(plannedIso).getTime()) / 60000);
}

/** "+60 min", "−15 min", "a tiempo". */
export function formatShift(minutes: number): string {
  if (minutes === 0) return "a tiempo";
  return `${minutes > 0 ? "+" : "−"}${Math.abs(minutes)} min`;
}

/** Para el Modo En Vivo: "+12 min tarde", "5 min antes" o "a tiempo". Fuera de ±12 h no dice nada (marca de otro día). */
export function formatLateness(minutes: number): string | null {
  if (Math.abs(minutes) > 12 * 60) return null;
  if (minutes === 0) return "a tiempo";
  return minutes > 0 ? `${minutes} min tarde` : `${Math.abs(minutes)} min antes`;
}
