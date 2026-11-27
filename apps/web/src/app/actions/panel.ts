"use server";

// Acciones del panel del productor general: crear un evento desde su tipo, invitar con cargo y tomar el mando.
// Los permisos los decide la base de datos (create_event_from_template, invite_to_event, mark_welcomed).

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isVisibility } from "@mando/core/command";
import { DEFAULT_CARGOS, getTemplate, parseTemplate, validateTemplate } from "@mando/core/event-types";
import { withDocuments } from "@mando/core/requirements";
import { pickZone, zonedDateTimeToIso } from "@mando/core/time";
import { DEFAULT_CRITICALITY } from "@mando/core/default-config";

export type PanelState = { ok: boolean; error: string | null; message?: string | null };

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  if (/row-level security|permission denied/i.test(message)) return "No tienes permiso para hacer eso.";
  if (/fetch failed|network/i.test(message)) return "Sin conexión con el servidor. Revisa la señal e intenta de nuevo.";
  return message || "Algo falló. Intenta de nuevo.";
}

async function db() {
  const supabase = await createClient();
  if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Tu sesión terminó. Vuelve a ingresar.");
  return supabase;
}

/** Crea el evento con las piezas de su tipo y lleva al productor general a armar el equipo. */
export async function createEvent(_prev: PanelState, formData: FormData): Promise<PanelState> {
  const template = getTemplate(text(formData, "tipo"));
  if (!template) return { ok: false, error: "Elige el tipo de evento." };
  const problems = validateTemplate(template);
  if (problems.length > 0) return { ok: false, error: `La plantilla de ${template.nombre} tiene un problema: ${problems[0]}` };

  const name = text(formData, "nombre");
  if (!name) return { ok: false, error: "Escribe el nombre del evento." };
  const org = text(formData, "organizacion");
  if (!UUID.test(org)) return { ok: false, error: "No encontramos tu organización. Vuelve a entrar." };
  const zone = pickZone(text(formData, "zona")); // solo las zonas de config/zonas-horarias.json
  const keyTime = zonedDateTimeToIso(text(formData, "fecha"), text(formData, "hora"), zone);
  if (!keyTime) return { ok: false, error: `Elige la fecha y la hora de: ${template.hora_clave.toLowerCase()}.` };

  let eventId: string;
  try {
    const supabase = await db();
    const { data, error } = await supabase.rpc("create_event_from_template", {
      p_org: org,
      p_name: name,
      p_client: text(formData, "cliente"),
      p_venue: text(formData, "lugar"),
      p_timezone: zone,
      p_key_time: keyTime,
      p_template: withDocuments(template), // la plantilla viaja con su lista de documentos del expediente
      p_criticality: DEFAULT_CRITICALITY,
      p_brief: text(formData, "brief") || null,
    });
    if (error) throw error;
    eventId = data as string;
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
  redirect(`/panel/${eventId}?creado=1`);
}

/** Invita a una persona con su cargo. El cargo elegido define su rol y su nivel en la jerarquía. */
export async function inviteMember(_prev: PanelState, formData: FormData): Promise<PanelState> {
  const eventId = text(formData, "evento");
  if (!UUID.test(eventId)) return { ok: false, error: "Evento desconocido." };
  const name = text(formData, "nombre");
  const email = text(formData, "correo").toLowerCase();
  if (!name) return { ok: false, error: "Escribe el nombre de la persona." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Escribe un correo válido." };

  try {
    const supabase = await db();
    // Los cargos salen de la plantilla guardada en el evento, no del formulario: nadie se inventa un nivel.
    const { data: event } = await supabase.from("events").select("template").eq("id", eventId).maybeSingle();
    const cargos = parseTemplate(event?.template)?.cargos ?? DEFAULT_CARGOS;
    const chosen = cargos[Number(text(formData, "cargo"))];
    if (!chosen) return { ok: false, error: "Elige el cargo de la persona." };
    const title = text(formData, "cargo_propio") || chosen.cargo;

    const { data, error } = await supabase.rpc("invite_to_event", {
      p_event: eventId,
      p_email: email,
      p_full_name: name,
      p_title: title,
      p_role: chosen.rol,
      p_level: chosen.nivel,
      // Cadena de mando (decisión 59): área, a quién reporta y qué ve. El cliente no lleva nada de esto.
      p_area: chosen.rol === "viewer" ? null : text(formData, "area") || null,
      p_reports_to: chosen.rol !== "viewer" && UUID.test(text(formData, "reporta_a")) ? text(formData, "reporta_a") : null,
      p_visibility: chosen.rol !== "viewer" && isVisibility(text(formData, "visibilidad")) ? text(formData, "visibilidad") : null,
    });
    if (error) throw error;
    const joined = (data as { joined?: boolean } | null)?.joined === true;
    refresh();
    return {
      ok: true,
      error: null,
      message: joined
        ? `${name} ya tenía cuenta en MANDO y quedó en el equipo como ${title}.`
        : `Invitación lista para ${name}. Mándale el mensaje de arriba para que active su mando.`,
    };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function revokeInvitation(formData: FormData): Promise<void> {
  const id = text(formData, "invitacion");
  if (!UUID.test(id)) return;
  const supabase = await db();
  await supabase.rpc("revoke_invitation", { p_invitation: id });
  refresh();
}

/** La persona vio la bienvenida y tomó el mando. */
export async function takeControl(eventId: string): Promise<PanelState> {
  if (!UUID.test(eventId)) return { ok: false, error: "Evento desconocido." };
  try {
    const supabase = await db();
    const { error } = await supabase.rpc("mark_welcomed", { p_event: eventId });
    if (error) throw error;
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}
