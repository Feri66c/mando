// Citados (decisión 23): hosts e invitados que no usan MANDO. Recordatorios por WhatsApp o correo y puntualidad.
import { formatDate, formatTime } from "./time";

/** Texto del recordatorio que se manda por WhatsApp o correo. */
export function guestReminder(opts: {
  name: string;
  eventName: string;
  callAt: string;
  timeZone?: string | null;
  venue?: string | null;
  sender: string;
}): string {
  const first = opts.name.trim().split(/\s+/)[0] || opts.name;
  const where = opts.venue?.trim() ? ` en ${opts.venue.trim()}` : "";
  return (
    `Hola, ${first}. Te esperamos para ${opts.eventName}${where} el ${formatDate(opts.callAt, opts.timeZone)} ` +
    `a las ${formatTime(opts.callAt, opts.timeZone)}. Por favor llega a esa hora: empezamos puntuales. ` +
    `¿Nos confirmas? Gracias. ${opts.sender}`
  );
}

/** Enlace de WhatsApp. Con teléfono abre el chat de esa persona; sin teléfono deja elegir el contacto. */
export function whatsappLink(text: string, phone?: string | null): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function mailtoLink(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export type GuestState = "arrived_on_time" | "arrived_late" | "late" | "waiting";

/** Estado de un citado ahora. Tolerancia en minutos: la misma de la puntualidad. */
export function guestState(guest: { callAt: string; arrivedAt: string | null }, now: Date, toleranceMin = 10): { state: GuestState; delayMin: number } {
  const call = new Date(guest.callAt).getTime();
  if (guest.arrivedAt) {
    const delay = Math.round((new Date(guest.arrivedAt).getTime() - call) / 60_000);
    return { state: delay <= toleranceMin ? "arrived_on_time" : "arrived_late", delayMin: delay };
  }
  const delay = Math.round((now.getTime() - call) / 60_000);
  return { state: delay > toleranceMin ? "late" : "waiting", delayMin: delay };
}

export const GUEST_STATE_LABEL: Record<GuestState, string> = {
  arrived_on_time: "Llegó a su hora",
  arrived_late: "Llegó tarde",
  late: "Tarde, sin llegar",
  waiting: "Por llegar",
};
