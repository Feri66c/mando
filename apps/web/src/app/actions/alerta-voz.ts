"use server";

// Alertas por audio (decisión 94): en la calle no se llena un formulario. La persona manda audios
// («¿Qué pasa?», «Detalle»), la IA de MANDO contesta al estilo WhatsApp y llena la ficha.
// Para levantar una alerta se pide una evidencia (la captura del mensaje del cliente): sin evidencia no pasa.

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { aiReady, askJson } from "@/lib/ai";
import { checkAudio, transcribe } from "@/lib/transcribe";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 2000;
const MAX_IMAGE = 8 * 1024 * 1024;

export type ChatLine = { from: "yo" | "mando"; text: string };
export type AlertDraft = {
  title: string;
  detail: string;
  level: number;
  routeItemId: string | null;
  backup: string;
};
export type InterpretResult = { ok: true; reply: string; draft: AlertDraft } | { ok: false; error: string };
export type TranscribeResult = { ok: true; text: string } | { ok: false; error: string };
export type LiftResult = { ok: true; message: string } | { ok: false; error: string };

function clean(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "";
  return m.replace(/^.*?ERROR:\s*/, "") || "Algo falló. Intenta de nuevo.";
}

/** Solo el equipo del evento (productores y backend) usa estas acciones. Devuelve el nombre de pila. */
async function teamMember(eventId: string): Promise<{ ok: true; firstName: string } | { ok: false; error: string }> {
  if (!UUID.test(eventId)) return { ok: false, error: "Evento desconocido." };
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: "La app aún no está conectada a Supabase." };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Tu sesión terminó. Vuelve a ingresar." };
  const { data: team } = await supabase.rpc("is_event_team", { p_event: eventId });
  if (!team) return { ok: false, error: "Solo el equipo del evento reporta alertas." };
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", auth.user.id).maybeSingle();
  const firstName = String(profile?.full_name ?? "").trim().split(/\s+/)[0] || "equipo";
  return { ok: true, firstName };
}

/** Un audio de WhatsApp a texto, para quien está en el evento. */
export async function transcribeForEvent(eventId: string, formData: FormData): Promise<TranscribeResult> {
  const who = await teamMember(eventId);
  if (!who.ok) return who;
  const file = formData.get("audio");
  if (!(file instanceof File)) return { ok: false, error: "Elige un audio." };
  const problem = checkAudio(file);
  if (problem) return { ok: false, error: problem };
  try {
    return { ok: true, text: (await transcribe(file)).slice(0, MAX_TEXT) };
  } catch (e) {
    return { ok: false, error: clean(e) };
  }
}

/**
 * La IA lee la conversación (audios ya pasados a texto) y devuelve dos cosas:
 * la respuesta al estilo WhatsApp y la ficha de la alerta, lista para revisar y levantar.
 */
export async function interpretAlert(input: {
  eventId: string;
  chat: ChatLine[];
  levels: { nivel: number; nombre: string; descripcion: string }[];
  items: { id: string; title: string }[];
}): Promise<InterpretResult> {
  const who = await teamMember(input.eventId);
  if (!who.ok) return who;
  const chat = (input.chat ?? []).slice(-12).map((l) => ({ from: l.from === "mando" ? "mando" : "yo", text: String(l.text ?? "").slice(0, MAX_TEXT) }));
  if (!chat.some((l) => l.from === "yo" && l.text.trim())) return { ok: false, error: "No alcancé a escucharte. Graba de nuevo." };
  const levels = (input.levels ?? []).slice(0, 4);
  const items = (input.items ?? []).slice(0, 80);
  const fallbackLevel = levels.find((l) => l.nivel === 2)?.nivel ?? 2;

  if (!aiReady()) {
    const said = chat.filter((l) => l.from === "yo").map((l) => l.text.trim());
    return {
      ok: true,
      reply: `Anotado, ${who.firstName}. Revisa la ficha y levanta la alerta.`,
      draft: { title: said[0]?.slice(0, 120) ?? "", detail: said.slice(1).join(" ").slice(0, 1000), level: fallbackLevel, routeItemId: null, backup: "" },
    };
  }

  try {
    const out = await askJson<{ respuesta: string; titulo: string; detalle: string; nivel: number; actividad: string | null; reemplazo: string | null }>({
      system:
        "Eres la IA de MANDO, la torre de control de eventos en vivo en Perú. El equipo está en la calle y te manda audios cortos, " +
        "como en WhatsApp. Respondes como un jefe de producción cercano y firme: una o dos frases, en español del Perú, " +
        "llamando a la persona por su nombre. No inventas datos que no te dijeron.",
      prompt:
        `Quien reporta: ${who.firstName}.\n\n` +
        `Niveles de alerta del evento:\n${levels.map((l) => `${l.nivel} · ${l.nombre}: ${l.descripcion}`).join("\n")}\n\n` +
        `Actividades de la hoja de ruta (id · título):\n${items.map((i) => `${i.id} · ${i.title}`).join("\n") || "(ninguna)"}\n\n` +
        `Conversación hasta ahora:\n${chat.map((l) => `${l.from === "yo" ? who.firstName : "MANDO"}: ${l.text}`).join("\n")}\n\n` +
        "Llena la ficha de la alerta con lo que se dijo:\n" +
        "- titulo: qué pasa, en pocas palabras (máximo 90 caracteres), sin el nombre de quien reporta.\n" +
        "- detalle: lo que se sabe, ordenado en una o dos frases. Vacío si no hay más.\n" +
        "- nivel: el número que mejor encaja con la descripción de los niveles.\n" +
        "- actividad: el id de la actividad afectada si se nombra claramente; si no, null.\n" +
        "- reemplazo: la persona o el plan B que se propuso (backup); null si nadie lo dijo.\n\n" +
        "Y escribe la respuesta corta para WhatsApp:\n" +
        `- Si es un hito cumplido o algo informativo: felicita («Muy bien, ${who.firstName}, cumpliste. Sigamos avanzando.»).\n` +
        "- Si falta un reemplazo o un plan B, pregúntalo («Ok, te entendimos. ¿A quién sugieres como backup?»).\n" +
        "- Si es un retraso, pregunta por qué sigue y para cuándo se resuelve.\n" +
        "- Si ya está todo claro, confirma y dile que revise la ficha y levante la alerta.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["respuesta", "titulo", "detalle", "nivel", "actividad", "reemplazo"],
        properties: {
          respuesta: { type: "string" },
          titulo: { type: "string" },
          detalle: { type: "string" },
          nivel: { type: "integer" },
          actividad: { type: ["string", "null"] },
          reemplazo: { type: ["string", "null"] },
        },
      },
      maxTokens: 1200,
      timeoutMs: 30_000,
    });
    const level = levels.some((l) => l.nivel === out.nivel) ? out.nivel : fallbackLevel;
    const routeItemId = out.actividad && items.some((i) => i.id === out.actividad) ? out.actividad : null;
    return {
      ok: true,
      reply: String(out.respuesta ?? "").trim().slice(0, 400) || `Anotado, ${who.firstName}.`,
      draft: {
        title: String(out.titulo ?? "").trim().slice(0, 120),
        detail: String(out.detalle ?? "").trim().slice(0, 1000),
        level,
        routeItemId,
        backup: String(out.reemplazo ?? "").trim().slice(0, 160),
      },
    };
  } catch (e) {
    return { ok: false, error: clean(e) };
  }
}

/** Un audio sobre una alerta abierta («¿por qué sigue el retraso?») queda como nota en la alerta y en la bitácora. */
export async function noteOnAlert(alertId: string, text: string): Promise<LiftResult> {
  if (!UUID.test(alertId)) return { ok: false, error: "Alerta desconocida." };
  const said = String(text ?? "").trim().slice(0, MAX_TEXT);
  if (!said) return { ok: false, error: "No alcancé a escucharte. Graba de nuevo." };
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: "La app aún no está conectada a Supabase." };
  const { data: alert } = await supabase.from("alerts").select("event_id").eq("id", alertId).maybeSingle();
  if (!alert) return { ok: false, error: "La alerta no existe." };
  const { error } = await supabase.rpc("add_evidence", {
    p_event: alert.event_id,
    p_kind: "note",
    p_note: `Actualización por audio: ${said}`,
    p_alert: alertId,
    p_visible: false,
  });
  if (error) return { ok: false, error: clean(error) };
  refresh();
  return { ok: true, message: "Anotado en la bitácora." };
}

/**
 * Levantar una alerta: la evidencia ya está subida y registrada en la alerta.
 * Si es una imagen, la IA la lee (¿es un mensaje que respalda seguir?) y su lectura queda en la bitácora.
 * La base no deja levantarla sin evidencia, y anota que quien la levanta responde por lo que informa.
 */
export async function liftAlert(alertId: string, explanation: string): Promise<LiftResult> {
  if (!UUID.test(alertId)) return { ok: false, error: "Alerta desconocida." };
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: "La app aún no está conectada a Supabase." };
  const { data: alert } = await supabase.from("alerts").select("id, title, detail, event_id").eq("id", alertId).maybeSingle();
  if (!alert) return { ok: false, error: "La alerta no existe." };
  const { data: ev } = await supabase
    .from("evidences")
    .select("file_path")
    .eq("alert_id", alertId)
    .not("file_path", "is", null)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ev?.file_path) return { ok: false, error: "Adjunta la evidencia: por ejemplo, la captura del mensaje del cliente." };

  let reading = "";
  const path = String(ev.file_path);
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const media = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : null;
  if (aiReady() && media) {
    const { data: blob } = await supabase.storage.from("evidences").download(path);
    if (blob && blob.size <= MAX_IMAGE) {
      try {
        const out = await askJson<{ respalda: boolean; lectura: string }>({
          system:
            "Eres la IA de MANDO. Revisas la evidencia con la que un productor levanta una alerta en un evento en vivo. " +
            "No eres abogado ni auditor: solo filtras. Eres estricto pero justo. Español del Perú, frases cortas.",
          prompt:
            `Alerta: «${alert.title}»${alert.detail ? `. ${alert.detail}` : ""}.\n` +
            `Lo que dice el productor: ${String(explanation ?? "").trim() || "(nada)"}\n\n` +
            "Mira la imagen adjunta. ¿Es una evidencia que respalda seguir adelante? Por ejemplo, la captura de un chat " +
            "donde el cliente o el responsable autoriza («avanza nomás, regularizo después»), una foto de que el problema se resolvió, " +
            "o un comprobante. Una imagen en blanco, borrosa o sin relación con la alerta no respalda nada.\n" +
            "En «lectura» resume en una frase qué muestra (quién dice qué, si se ve). No inventes nombres.",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["respalda", "lectura"],
            properties: { respalda: { type: "boolean" }, lectura: { type: "string" } },
          },
          attachments: [{ kind: "image", mediaType: media, data: Buffer.from(await blob.arrayBuffer()).toString("base64"), name: "evidencia" }],
          maxTokens: 600,
          timeoutMs: 30_000,
        });
        reading = String(out.lectura ?? "").trim().slice(0, 300);
        if (!out.respalda)
          return {
            ok: false,
            error: `La IA de MANDO no acepta esta evidencia: ${reading || "no respalda la alerta"}. Adjunta la captura del mensaje del cliente o una foto que lo muestre.`,
          };
      } catch {
        // Si la IA no responde, la evidencia igual queda registrada y la persona responde por ella.
      }
    }
  }

  const note = [String(explanation ?? "").trim(), reading && `La IA leyó la evidencia: ${reading}`].filter(Boolean).join(". ").slice(0, 800);
  const { error } = await supabase.rpc("resolve_alert", { p_alert: alertId, p_note: note || null });
  if (error) return { ok: false, error: clean(error) };
  refresh();
  return { ok: true, message: reading ? `Alerta levantada. La IA leyó: ${reading}` : "Alerta levantada con evidencia. Quedó en la bitácora." };
}
