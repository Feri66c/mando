"use server";

// Méritos, cierre y citados. Como en la operación, cada acción llama a una función de la base, que valida
// el cargo, escribe la bitácora y decide qué ve el cliente. Aquí solo se leen los formularios.

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { zonedDateTimeToIso } from "@mando/core/time";

export type CierreState = { ok: boolean; error: string | null; message?: string | null };

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  if (/row-level security|permission denied/i.test(message)) return "No tienes permiso para hacer eso en este evento.";
  if (/fetch failed|network/i.test(message)) return "Sin conexión con el servidor. Revisa la señal e intenta de nuevo.";
  return message || "Algo falló. Intenta de nuevo.";
}

async function run(fn: string, args: Record<string, unknown>, message?: string): Promise<CierreState> {
  try {
    const supabase = await createClient();
    if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw new Error("Tu sesión terminó. Vuelve a ingresar.");
    const { error } = await supabase.rpc(fn, args);
    if (error) throw error;
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
  refresh();
  return { ok: true, error: null, message: message ?? null };
}

export async function markCriterionAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const ok = text(fd, "result") === "ok";
  return run("mark_criterion", { p_criterion: text(fd, "criterion_id"), p_ok: ok, p_note: text(fd, "note") || null }, "Marcado.");
}

export async function rateProductionAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const stars = Number(text(fd, "stars"));
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return { ok: false, error: "Elige de 1 a 5 estrellas." };
  return run("rate_production", { p_event: text(fd, "event_id"), p_stars: stars, p_comment: text(fd, "comment") || null }, "Gracias. Tu valoración quedó guardada.");
}

export async function closeEventAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  if (text(fd, "confirm") !== "si") return { ok: false, error: "Marca la casilla para confirmar el cierre." };
  return run("close_event", { p_event: text(fd, "event_id") }, "Evento cerrado.");
}

export async function setPublishUrlAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  return run("set_publish_url", { p_event: text(fd, "event_id"), p_url: text(fd, "url") || null }, "Enlace guardado. El cliente ya lo ve.");
}

export async function addGuestAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const name = text(fd, "nombre");
  if (!name) return { ok: false, error: "Escribe el nombre de la persona citada." };
  const callAt = zonedDateTimeToIso(text(fd, "fecha"), text(fd, "hora"), text(fd, "timezone") || null);
  if (!callAt) return { ok: false, error: "Elige el día y la hora de citación." };
  return run(
    "add_guest",
    {
      p_event: text(fd, "event_id"),
      p_full_name: name,
      p_guest_role: text(fd, "rol") || "Invitado",
      p_call_at: callAt,
      p_phone: text(fd, "telefono") || null,
      p_email: text(fd, "correo") || null,
    },
    `${name} quedó en la lista. Mándale su recordatorio.`,
  );
}

export async function updateGuestAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const action = text(fd, "action");
  const message = action === "arrived" ? "Llegada marcada." : action === "reminded" ? "Recordatorio anotado." : null;
  return run("update_guest", { p_guest: text(fd, "guest_id"), p_action: action }, message ?? undefined);
}

/** Para los enlaces de WhatsApp y correo: anota el recordatorio sin esperar respuesta en pantalla. */
export async function noteReminderAction(guestId: string): Promise<void> {
  await run("update_guest", { p_guest: guestId, p_action: "reminded" });
}

// ---------------------------------------------------------------- Expediente y locación

/** El archivo ya se subió desde el teléfono al cubo privado; aquí solo se registra. */
export async function completeRequirementAction(input: {
  requirementId: string;
  filePath: string | null;
  fileName: string | null;
  sha256: string | null;
  note: string;
}): Promise<CierreState> {
  return run(
    "complete_requirement",
    { p_requirement: input.requirementId, p_file_path: input.filePath, p_file_name: input.fileName, p_sha256: input.sha256, p_note: input.note.trim() || null },
    "Guardado en el expediente.",
  );
}

export async function setRequirementStatusAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const status = text(fd, "status") === "pending" ? "pending" : "not_applicable";
  return run("set_requirement_status", { p_requirement: text(fd, "requirement_id"), p_status: status, p_note: text(fd, "note") || null });
}

export async function planRequirementAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const date = text(fd, "fecha");
  const dueAt = date ? zonedDateTimeToIso(date, "18:00", text(fd, "timezone") || null) : null;
  return run(
    "plan_requirement",
    { p_requirement: text(fd, "requirement_id"), p_owner: text(fd, "owner") || null, p_due_at: dueAt },
    "Responsable y plazo guardados.",
  );
}

export async function addRequirementAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const title = text(fd, "titulo");
  if (!title) return { ok: false, error: "Escribe el nombre del documento." };
  const date = text(fd, "fecha");
  return run(
    "add_requirement",
    {
      p_event: text(fd, "event_id"),
      p_title: title,
      p_category: text(fd, "categoria") || "administracion",
      p_due_at: date ? zonedDateTimeToIso(date, "18:00", text(fd, "timezone") || null) : null,
      p_mandatory: fd.get("no_negociable") === "si",
    },
    `«${title}» quedó en el expediente.`,
  );
}

export async function setLocationAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  return run(
    "set_location",
    {
      p_event: text(fd, "event_id"),
      p_data: {
        meeting_point: text(fd, "punto"),
        map_url: text(fd, "mapa"),
        coordinator: text(fd, "coordina"),
        coordinator_phone: text(fd, "telefono"),
        transport_plate: text(fd, "placa"),
        transport_detail: text(fd, "transporte"),
        antecedents: fd.getAll("antecedente").map((a) => String(a).trim()).filter(Boolean),
        killer_zones: text(fd, "zonas_killer"),
        blind_spots: text(fd, "puntos_ciegos"),
      },
    },
    "Locación guardada. Ya la ve todo el equipo.",
  );
}
