"use server";

// Acciones de operación del evento (Etapa 1). Cada una llama a una función de la base de datos, que es la
// que valida el rol, aplica el cambio en una transacción, escribe la bitácora y evalúa la criticidad.
// Aquí solo se leen los formularios y se traduce el resultado para la pantalla.

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { templateByKey } from "@/lib/core/templates";

export type ActionState = { ok: boolean; error: string | null; message?: string | null; momentId?: string };
const OK: ActionState = { ok: true, error: null };

export type AffectedItem = {
  item_id: string;
  title: string;
  is_target: boolean;
  is_milestone: boolean;
  visible_to_viewer: boolean;
  planned_start: string;
  old_start: string;
  old_end: string;
  new_start: string;
  new_end: string;
};

export type ChangePreview = ActionState & { requestId: string | null; affected: AffectedItem[] };

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

async function db() {
  const supabase = await createClient();
  if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Tu sesión terminó. Vuelve a ingresar.");
  return supabase;
}

/** Mensaje claro en español. Las funciones de la base ya devuelven sus errores en español. */
function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  if (/row-level security|permission denied/i.test(message)) return "No tienes permiso para hacer eso en este evento.";
  if (/fetch failed|network/i.test(message)) return "Sin conexión con el servidor. Revisa la señal e intenta de nuevo.";
  return message || "Algo falló. Intenta de nuevo.";
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await db();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
}

async function run(fn: string, args: Record<string, unknown>, message?: string): Promise<ActionState> {
  try {
    await rpc(fn, args);
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
  refresh();
  return { ...OK, message: message ?? null };
}

// ---------------------------------------------------------------- Hoja de ruta

/** Pide el cambio y devuelve la vista previa (qué se arrastra). No mueve nada todavía. */
export async function requestChangeAction(_prev: ChangePreview, fd: FormData): Promise<ChangePreview> {
  const empty = { requestId: null, affected: [] };
  const kind = text(fd, "kind") === "move" ? "move" : "extend";
  const minutes = Number(text(fd, "minutes"));
  const sign = text(fd, "sign") === "-" ? -1 : 1;
  const newStart = text(fd, "new_start") || null; // ISO en UTC, lo arma la pantalla con la zona del evento
  if (!newStart && (!Number.isFinite(minutes) || minutes === 0)) {
    return { ok: false, error: "Elige cuántos minutos.", ...empty };
  }
  try {
    const data = (await rpc("request_change", {
      p_item: text(fd, "item_id"),
      p_kind: kind,
      p_delta_minutes: newStart ? null : Math.round(minutes) * sign,
      p_new_start: newStart,
      p_reason: text(fd, "reason") || null,
      p_raw_input: text(fd, "raw_input") || null,
      p_channel: "tap",
    })) as { request_id: string; affected: AffectedItem[] };
    return { ok: true, error: null, requestId: data.request_id, affected: data.affected };
  } catch (e) {
    return { ok: false, error: friendly(e), ...empty };
  }
}

export async function confirmChangeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run("confirm_change", { p_request: text(fd, "request_id") }, "Cambio aplicado. Ya lo ve todo el equipo.");
}

export async function markItemAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const action = text(fd, "action");
  const message = action === "start" ? "Marcado: empezó." : action === "finish" ? "Marcado: terminó." : "Marcado en riesgo.";
  return run("mark_item", { p_item: text(fd, "item_id"), p_action: action }, message);
}

// ---------------------------------------------------------------- Momentos críticos

export async function createMomentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const template = templateByKey(text(fd, "template_key"));
  const title = text(fd, "title") || template?.nombre || "";
  try {
    const supabase = await db();
    const { data, error } = await supabase.rpc("create_moment", {
      p_event: text(fd, "event_id"),
      p_route_item: text(fd, "route_item_id") || null,
      p_template_key: template?.clave ?? null,
      p_title: title,
      p_questions: template?.preguntas ?? [],
    });
    if (error) throw error;
    const momentId = data as string;
    // Compromisos típicos de la plantilla: quedan listos para escribir lo prometido.
    for (const label of template?.compromisos_tipicos ?? []) {
      const promised = text(fd, `promised:${label}`);
      if (promised) {
        const r = await supabase.rpc("add_commitment", { p_moment: momentId, p_label: label, p_promised: promised });
        if (r.error) throw r.error;
      }
    }
    refresh();
    return { ...OK, momentId };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function openMomentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run("open_moment", { p_moment: text(fd, "moment_id") });
}

export async function answerCheckAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run("answer_check", { p_check: text(fd, "check_id"), p_answer: text(fd, "answer") }, "Respuesta guardada.");
}

export async function addCommitmentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run("add_commitment", {
    p_moment: text(fd, "moment_id"),
    p_label: text(fd, "label"),
    p_promised: text(fd, "promised"),
  });
}

export async function checkCommitmentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const outcome = text(fd, "outcome");
  if (!["met", "partial", "unmet"].includes(outcome)) return { ok: false, error: "Marca cumplido, parcial o incumplido." };
  return run("check_commitment", { p_commitment: text(fd, "commitment_id"), p_found: text(fd, "found"), p_outcome: outcome });
}

export async function resolveMomentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run("resolve_moment", { p_moment: text(fd, "moment_id"), p_resolution: text(fd, "resolution") }, "Momento resuelto.");
}

// ---------------------------------------------------------------- Evidencias

/** Registra una evidencia. Si es archivo, el teléfono ya lo subió al cubo privado y calculó su huella. */
export async function addEvidenceAction(input: {
  eventId: string;
  kind: "photo" | "audio" | "video" | "document" | "note";
  filePath?: string | null;
  note?: string | null;
  sha256?: string | null;
  capturedAt?: string | null;
  routeItemId?: string | null;
  momentId?: string | null;
  visible?: boolean;
}): Promise<ActionState> {
  return run(
    "add_evidence",
    {
      p_event: input.eventId,
      p_kind: input.kind,
      p_file_path: input.filePath ?? null,
      p_note: input.note?.trim() || null,
      p_sha256: input.sha256 ?? null,
      p_captured_at: input.capturedAt ?? null,
      p_route_item: input.routeItemId ?? null,
      p_moment: input.momentId ?? null,
      p_alert: null,
      p_visible: input.visible ?? true,
    },
    "Evidencia guardada con hora del servidor.",
  );
}

// ---------------------------------------------------------------- Alertas

export async function raiseAlertAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const level = Number(text(fd, "level"));
  return run(
    "raise_alert",
    {
      p_event: text(fd, "event_id"),
      p_level: Number.isInteger(level) ? level : 2,
      p_title: text(fd, "title"),
      p_detail: text(fd, "detail") || null,
      p_entity_type: text(fd, "route_item_id") ? "route_item" : null,
      p_entity_id: text(fd, "route_item_id") || null,
    },
    "Alerta levantada.",
  );
}

export async function ackAlertAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run("ack_alert", { p_alert: text(fd, "alert_id") });
}

export async function resolveAlertAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run("resolve_alert", { p_alert: text(fd, "alert_id"), p_note: text(fd, "note") || null });
}

/** Reglas por reloj (retrasos, momentos sin resolver, permisos). La pantalla del equipo la llama cada minuto. */
export async function evaluateClockRulesAction(eventId: string): Promise<number> {
  try {
    const n = Number(await rpc("evaluate_clock_rules", { p_event: eventId }));
    if (n > 0) refresh();
    return n;
  } catch {
    return 0; // sin señal o sin permiso: se reintenta en el siguiente minuto
  }
}
