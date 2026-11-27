// Regla 10: en la base todo está en UTC; en pantalla se muestra en la zona horaria del evento.

import zones from "../../../config/zonas-horarias.json";

export const DEFAULT_TIMEZONE = "America/Lima";

/** Zonas que la torre puede elegir al crear un evento (config/zonas-horarias.json). */
export type ZoneOption = { zona: string; nombre: string };
export const ZONE_OPTIONS: readonly ZoneOption[] = zones.zonas;

/** La zona elegida en el formulario, solo si está en la lista; si no, Lima. */
export function pickZone(value: string | null | undefined): string {
  return ZONE_OPTIONS.some((z) => z.zona === value) ? (value as string) : DEFAULT_TIMEZONE;
}
const LOCALE = "es-PE";

function safeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone }).format(0);
    return timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** "19:30" en la zona del evento (24 horas). */
export function formatTime(iso: string, timeZone?: string | null): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: safeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** "sáb. 12 dic. 2026" en la zona del evento. */
export function formatDate(iso: string, timeZone?: string | null): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: safeZone(timeZone),
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/** Rango del evento: "sáb. 12 dic. 2026 · 08:00 – 01:00". */
export function formatEventRange(startIso: string | null, endIso: string | null, timeZone?: string | null): string {
  if (!startIso) return "Fecha por definir";
  const start = `${formatDate(startIso, timeZone)} · ${formatTime(startIso, timeZone)}`;
  if (!endIso) return start;
  return `${start} – ${formatTime(endIso, timeZone)}`;
}

/** Nombre de la zona para mostrar junto a las horas: "America/Bogota" → "Colombia"; si no está en la lista, su ciudad. */
export function zoneLabel(timeZone?: string | null): string {
  const zone = safeZone(timeZone);
  const known = ZONE_OPTIONS.find((z) => z.zona === zone);
  if (known) return known.nombre;
  return zone.split("/").pop()!.replace(/_/g, " ");
}

/** Fecha "AAAA-MM-DD" de un instante, en la zona del evento. */
export function zonedDate(iso: string, timeZone?: string | null): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  return parts; // en-CA da AAAA-MM-DD
}

/** Diferencia (ms) entre la hora local de la zona y UTC en un instante dado. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - instant;
}

/**
 * Convierte una hora de pared ("19:30") en la zona del evento a un instante UTC (ISO), tomando como
 * referencia el día de otra hora (`nearIso`). Si el resultado queda más de 12 horas antes de la referencia,
 * se entiende que es del día siguiente (p. ej., 00:30 después de las 23:30).
 */
export function wallTimeToIso(hhmm: string, nearIso: string, timeZone?: string | null): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  const zone = safeZone(timeZone);
  const [y, mo, d] = zonedDate(nearIso, zone).split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, Number(m[1]), Number(m[2]));
  let instant = guess - zoneOffsetMs(guess, zone);
  instant = guess - zoneOffsetMs(instant, zone); // segunda pasada por si cruza un cambio de horario
  if (instant < new Date(nearIso).getTime() - 12 * 3600_000) instant += 24 * 3600_000;
  return new Date(instant).toISOString();
}

/** Fecha ("2026-12-06") y hora de pared ("10:00") en la zona del evento → instante UTC (ISO). */
export function zonedDateTimeToIso(date: string, hhmm: string, timeZone?: string | null): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!d || !t || Number(t[1]) > 23 || Number(t[2]) > 59) return null;
  const zone = safeZone(timeZone);
  const guess = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  if (Number.isNaN(guess) || new Date(guess).getUTCDate() !== Number(d[3])) return null; // 31 de febrero, etc.
  let instant = guess - zoneOffsetMs(guess, zone);
  instant = guess - zoneOffsetMs(instant, zone);
  return new Date(instant).toISOString();
}
