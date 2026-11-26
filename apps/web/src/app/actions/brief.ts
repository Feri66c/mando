"use server";

// Aceptación del cargo y brief del evento (decisiones 40 y 41).
// Los permisos los decide la base de datos: accept_role, set_brief, ack_brief, raise_brief_doubt, answer_brief_doubt.

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type BriefState = { ok: boolean; error: string | null; message?: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  if (/row-level security|permission denied/i.test(message)) return "No tienes permiso para hacer eso.";
  if (/fetch failed|network/i.test(message)) return "Sin conexión con el servidor. Revisa la señal e intenta de nuevo.";
  return message || "Algo falló. Intenta de nuevo.";
}

async function call(fn: string, args: Record<string, unknown>): Promise<BriefState> {
  try {
    const supabase = await createClient();
    if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
    const { error } = await supabase.rpc(fn, args);
    if (error) throw error;
    refresh();
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

/** «Acepto»: la persona asume el cargo para el que la convocaron. */
export async function acceptRole(eventId: string): Promise<BriefState> {
  if (!UUID.test(eventId)) return { ok: false, error: "Evento desconocido." };
  return call("accept_role", { p_event: eventId });
}

/** «Estoy enterado del brief». */
export async function ackBrief(eventId: string): Promise<BriefState> {
  if (!UUID.test(eventId)) return { ok: false, error: "Evento desconocido." };
  return call("ack_brief", { p_event: eventId });
}

/** Una duda sobre el brief: va al backend como alerta. */
export async function raiseBriefDoubt(eventId: string, question: string): Promise<BriefState> {
  if (!UUID.test(eventId)) return { ok: false, error: "Evento desconocido." };
  if (!question.trim()) return { ok: false, error: "Cuenta qué no coincide con lo que sabías." };
  return call("raise_brief_doubt", { p_event: eventId, p_question: question });
}

/** El backend carga o corrige el brief. */
export async function saveBrief(_prev: BriefState, formData: FormData): Promise<BriefState> {
  const eventId = text(formData, "evento");
  if (!UUID.test(eventId)) return { ok: false, error: "Evento desconocido." };
  if (!text(formData, "resumen")) return { ok: false, error: "Escribe el brief del evento." };
  const result = await call("set_brief", {
    p_event: eventId,
    p_summary: text(formData, "resumen"),
    p_objective: text(formData, "objetivo") || null,
    p_attendees: text(formData, "asistentes") || null,
  });
  return result.ok ? { ...result, message: "Brief guardado. El equipo tiene que leerlo de nuevo." } : result;
}

/** El backend responde una duda. */
export async function answerBriefDoubt(_prev: BriefState, formData: FormData): Promise<BriefState> {
  const doubt = text(formData, "duda");
  if (!UUID.test(doubt)) return { ok: false, error: "Duda desconocida." };
  if (!text(formData, "respuesta")) return { ok: false, error: "Escribe la respuesta." };
  return call("answer_brief_doubt", { p_doubt: doubt, p_answer: text(formData, "respuesta") });
}
