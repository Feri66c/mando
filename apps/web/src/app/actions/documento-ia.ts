"use server";

// Red flag de documento (decisión 93): reconocer con plazo y revisión de la IA del documento adjuntado.

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { AiUnavailable, aiReady, askJson } from "@/lib/ai";
import { formatDate } from "@mando/core/time";

export type AckState = { ok: boolean; error: string | null; message?: string };
export type ReviewResult = {
  reviewed: boolean;
  verdict?: "vigente" | "sin_fecha" | "vencido" | "no_corresponde" | "ilegible";
  summary?: string;
  expiresOn?: string | null;
  note?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 8 * 1024 * 1024;

function clean(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "";
  return m.replace(/^.*?ERROR:\s*/, "") || "No se pudo guardar.";
}

/** «Lo reconozco»: la persona dice cuánto tiempo necesita y queda en la bitácora. */
export async function ackWithTime(alertId: string, minutes: number): Promise<AckState> {
  if (!UUID.test(alertId)) return { ok: false, error: "Alerta desconocida." };
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: "La app aún no está conectada a Supabase." };
  const { error } = await supabase.rpc("ack_alert_with_time", { p_alert: alertId, p_minutes: Math.round(minutes) });
  if (error) return { ok: false, error: clean(error) };
  refresh();
  const label = minutes < 60 ? `${minutes} minutos` : minutes === 60 ? "1 hora" : `${minutes / 60} horas`;
  return { ok: true, error: null, message: `Reconocido. Tienes ${label}; quedó en la bitácora.` };
}

const VERDICTS = ["vigente", "sin_fecha", "vencido", "no_corresponde", "ilegible"] as const;

/**
 * La IA de MANDO lee el documento recién adjuntado: ¿es lo que se pide?, ¿está vigente para la fecha del evento?
 * Si está vencido o no corresponde, la base lo registra y el documento vuelve a pendiente.
 */
export async function reviewRequirementDocument(requirementId: string): Promise<ReviewResult> {
  if (!UUID.test(requirementId)) return { reviewed: false };
  if (!aiReady()) return { reviewed: false, note: "La revisión con IA no está activa todavía." };
  const supabase = await createClient();
  if (!supabase) return { reviewed: false };
  const { data: req } = await supabase
    .from("event_requirements")
    .select("id, title, file_path, file_name, event_id, status")
    .eq("id", requirementId)
    .maybeSingle();
  if (!req?.file_path || req.status !== "done") return { reviewed: false };
  const path = String(req.file_path);
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const media = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : null;
  if (!media) return { reviewed: false, note: "La IA revisa PDF y fotos; este archivo quedó sin revisión automática." };
  const { data: blob } = await supabase.storage.from("evidences").download(path);
  if (!blob || blob.size > MAX_BYTES) return { reviewed: false, note: "El archivo es muy pesado para la revisión con IA." };
  const { data: ev } = await supabase.from("events").select("name, starts_at, timezone").eq("id", req.event_id).maybeSingle();
  const tz = String(ev?.timezone ?? "America/Lima");
  const today = formatDate(new Date().toISOString(), tz);
  const eventDay = ev?.starts_at ? formatDate(String(ev.starts_at), tz) : "sin fecha";

  try {
    const out = await askJson<{ verdict: (typeof VERDICTS)[number]; expires_on: string | null; summary: string }>({
      system:
        "Eres la IA de MANDO, que administra el expediente legal de eventos en vivo en Perú. Revisas documentos que el equipo adjunta " +
        "bajo declaración jurada. Eres estricto y no inventas: si no ves la fecha, no la supongas. Respondes en español del Perú, frases cortas.",
      prompt:
        `Documento que se pide: «${req.title}». Evento: ${ev?.name ?? ""}, el ${eventDay}. Hoy es ${today}.\n\n` +
        "Revisa el archivo adjunto como lo haría un jefe de producción exigente antes de dar el pase:\n" +
        "- ¿Es de verdad el documento que se pide? (un DNI no sirve como SCTR, una cotización no es una orden de compra).\n" +
        "- ¿Se lee completo? Si es una foto borrosa, cortada, con reflejos o de lejos, es ilegible.\n" +
        "- ¿Está vigente el día del evento? Busca fechas de vencimiento, caducidad, «válido hasta», vigencia de pólizas, " +
        "DNI o carné de extranjería vencidos, certificados con fecha de emisión muy antigua para lo que acreditan. " +
        "La fecha de emisión tiene que ser anterior al evento.\n" +
        "- Si el documento tiene foto de una persona y la foto no se ve o no coincide con el nombre del documento, márcalo como no_corresponde.\n\n" +
        "Decide uno:\n" +
        "- vigente: es el documento que se pide, se lee y su vigencia cubre el día del evento.\n" +
        "- sin_fecha: es el documento que se pide y se lee, pero no muestra fecha de vencimiento.\n" +
        "- vencido: su vigencia termina antes del día del evento.\n" +
        "- no_corresponde: no es el documento que se pide o no es de quien debería ser.\n" +
        "- ilegible: no se puede leer bien; hay que volver a tomar la foto.\n" +
        "En expires_on pon la fecha de vencimiento en formato AAAA-MM-DD si la ves; si no, null. " +
        "En summary, una o dos frases para el productor: qué documento es, a nombre de quién, qué viste de la fecha y, si lo rechazas, qué tiene que hacer.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["verdict", "expires_on", "summary"],
        properties: {
          verdict: { type: "string", enum: [...VERDICTS] },
          expires_on: { anyOf: [{ type: "string" }, { type: "null" }] },
          summary: { type: "string" },
        },
      },
      maxTokens: 800,
      timeoutMs: 60_000,
      attachments: [
        { kind: media === "application/pdf" ? "pdf" : "image", mediaType: media, name: String(req.file_name ?? "documento"), data: Buffer.from(await blob.arrayBuffer()).toString("base64") },
      ],
    });
    const verdict = VERDICTS.includes(out.verdict) ? out.verdict : "ilegible";
    const expiresOn = out.expires_on && /^\d{4}-\d{2}-\d{2}$/.test(out.expires_on) ? out.expires_on : null;
    const summary = String(out.summary ?? "").trim().slice(0, 400);
    const { error } = await supabase.rpc("record_document_review", { p_requirement: req.id, p_verdict: verdict, p_summary: summary, p_expires_on: expiresOn });
    if (error) return { reviewed: false, note: clean(error) };
    refresh();
    return { reviewed: true, verdict, summary, expiresOn };
  } catch (e) {
    if (e instanceof AiUnavailable) return { reviewed: false, note: e.message };
    return { reviewed: false, note: "La IA no pudo revisar el documento esta vez; quedó en el expediente bajo tu declaración jurada." };
  }
}

/** Modo diseño (backend): pausa alertas automáticas y candados; «Listo, activa» lo apaga. */
export async function setDesignMode(eventId: string, on: boolean): Promise<AckState> {
  if (!UUID.test(eventId)) return { ok: false, error: "Evento desconocido." };
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: "La app aún no está conectada a Supabase." };
  const { error } = await supabase.rpc("set_design_mode", { p_event: eventId, p_on: on });
  if (error) return { ok: false, error: clean(error) };
  refresh();
  return { ok: true, error: null, message: on ? "Modo diseño encendido." : "Activado: MANDO vuelve a vigilar." };
}
