// Regla 10: en la base todo está en UTC; en pantalla se muestra en la zona horaria del evento.

export const DEFAULT_TIMEZONE = "America/Lima";
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

/** Nombre corto de la zona para mostrar junto a las horas: "America/Lima" → "Lima". */
export function zoneLabel(timeZone?: string | null): string {
  const zone = safeZone(timeZone);
  return zone.split("/").pop()!.replace(/_/g, " ");
}
