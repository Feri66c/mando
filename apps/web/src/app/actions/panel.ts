"use server";

// Acciones del panel del productor general: crear un evento desde su tipo, invitar con cargo y tomar el mando.
// Los permisos los decide la base de datos (create_event_from_template, invite_to_event, mark_welcomed).

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isVisibility } from "@mando/core/command";
import { DEFAULT_CARGOS, getTemplate, invitationMessage, parseTemplate, validateTemplate } from "@mando/core/event-types";
import { headers } from "next/headers";
import { withDocuments } from "@mando/core/requirements";
import { CUSTOM_KIND, checkCustom, composeCustomTemplate } from "@mando/core/custom-event";
import { formatDate, pickZone, zonedDateTimeToIso } from "@mando/core/time";
import { MAX_COPIES, copyMailto, copyNotice, parseCopyList } from "@mando/core/invite-copy";
import { canSendMail, mandoMailbox, sendMail } from "@/lib/mail";
import { DEFAULT_CRITICALITY } from "@mando/core/default-config";

export type PanelState = { ok: boolean; error: string | null; message?: string | null; copyMailto?: string | null };

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
  const kind = text(formData, "tipo");
  let full;
  let saveAs: { name: string; modules: string[] } | null = null;
  if (kind === CUSTOM_KIND) {
    // Evento personalizado: el nombre del tipo y los componentes marcados arman la plantilla.
    const typeName = text(formData, "nombre_tipo");
    const keys = formData.getAll("componente").map(String);
    const problem = checkCustom(typeName, keys);
    if (problem) return { ok: false, error: problem };
    full = composeCustomTemplate(typeName, keys);
    if (formData.get("guardar_tipo") === "1") saveAs = { name: typeName, modules: full.modulos };
  } else {
    const found = getTemplate(kind);
    if (!found) return { ok: false, error: "Elige el tipo de evento." };
    full = withDocuments(found); // la plantilla viaja con su lista de documentos del expediente
  }
  const template = full;
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
      p_template: template,
      p_criticality: DEFAULT_CRITICALITY,
      p_brief: text(formData, "brief") || null,
    });
    if (error) throw error;
    eventId = data as string;
    if (saveAs) {
      // Guardar el tipo no detiene el evento: si falla, el evento ya existe igual.
      await supabase.rpc("save_custom_event_type", { p_org: org, p_name: saveAs.name, p_modules: saveAs.modules });
    }
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
  redirect(`/panel/${eventId}?creado=1`);
}

/** Borra un tipo personalizado guardado. Los eventos ya creados con él no cambian. */
export async function deleteCustomType(_prev: PanelState, formData: FormData): Promise<PanelState> {
  const id = text(formData, "tipo_guardado");
  if (!UUID.test(id)) return { ok: false, error: "Tipo desconocido." };
  try {
    const supabase = await db();
    const { error } = await supabase.rpc("delete_custom_event_type", { p_id: id });
    if (error) throw error;
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
  refresh();
  return { ok: true, error: null, message: "Tipo borrado." };
}

/** Invita a una persona con su cargo. El cargo elegido define su rol y su nivel en la jerarquía. */
/** Nombre de quien está usando MANDO, para firmar los avisos. */
async function myName(supabase: Awaited<ReturnType<typeof db>>): Promise<string | undefined> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return undefined;
  const { data } = await supabase.from("profiles").select("full_name").eq("id", auth.user.id).maybeSingle();
  return data?.full_name ? String(data.full_name) : undefined;
}

/** La invitación sale directo del buzón de MANDO; el buzón recibe copia oculta como acuse. */
async function mailInvitation(opts: { email: string; name: string; title: string; eventName: string; inviter?: string }): Promise<boolean> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const message = invitationMessage({
    name: opts.name,
    inviter: opts.inviter ?? "El equipo de producción",
    eventName: opts.eventName,
    cargo: opts.title,
    link: `${proto}://${host}/ingresar?correo=${encodeURIComponent(opts.email)}`,
  });
  return sendMail({
    to: [opts.email],
    bcc: [mandoMailbox()],
    subject: `Te invitaron a ${opts.eventName} en MANDO`,
    text: `${message}\n\nMANDO · control de eventos en vivo`,
  });
}

/** Botón «Enviar por correo» de una invitación pendiente: manda sin abrir Mail ni Outlook. */
export async function sendInvitationEmail(invitationId: string): Promise<PanelState> {
  if (!UUID.test(invitationId)) return { ok: false, error: "Invitación desconocida." };
  if (!canSendMail()) return { ok: false, error: "Falta conectar el correo de MANDO en Vercel." };
  try {
    const supabase = await db();
    // RLS: solo quien puede ver la invitación (backend del evento) la encuentra.
    const { data: inv } = await supabase
      .from("invitations")
      .select("email, full_name, title, event_id, accepted_at, revoked_at")
      .eq("id", invitationId)
      .maybeSingle();
    if (!inv || inv.accepted_at || inv.revoked_at) return { ok: false, error: "Esa invitación ya no está pendiente." };
    const { data: ev } = await supabase.from("events").select("name").eq("id", inv.event_id).maybeSingle();
    const sent = await mailInvitation({
      email: String(inv.email),
      name: String(inv.full_name),
      title: String(inv.title),
      eventName: String(ev?.name ?? "el evento"),
      inviter: await myName(supabase),
    });
    return sent
      ? { ok: true, error: null, message: `Enviado a ${inv.email}.` }
      : { ok: false, error: "No se pudo enviar. Prueba otra vez en un minuto o mándalo por WhatsApp." };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function inviteMember(_prev: PanelState, formData: FormData): Promise<PanelState> {
  const eventId = text(formData, "evento");
  if (!UUID.test(eventId)) return { ok: false, error: "Evento desconocido." };
  const name = text(formData, "nombre");
  const email = text(formData, "correo").toLowerCase();
  if (!name) return { ok: false, error: "Escribe el nombre de la persona." };
  if (/[,;\s]/.test(email))
    return { ok: false, error: "En «Correo» va solo la persona que recibe el mando. A los demás ponlos en «Con copia»." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Escribe un correo válido." };
  const copies = parseCopyList(text(formData, "con_copia"), email);
  if (copies.invalid.length)
    return { ok: false, error: `En «Con copia» esto no es un correo: ${copies.invalid.slice(0, 3).join(", ")}. Sepáralos con coma.` };
  if (copies.emails.length > MAX_COPIES) return { ok: false, error: `Puedes copiar hasta a ${MAX_COPIES} personas.` };

  try {
    const supabase = await db();
    // Los cargos salen de la plantilla guardada en el evento, no del formulario: nadie se inventa un nivel.
    const { data: event } = await supabase.from("events").select("template, name, starts_at, timezone").eq("id", eventId).maybeSingle();
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
    let message = joined
      ? `${name} ya tenía cuenta en MANDO y quedó en el equipo como ${title}.`
      : `Invitación lista para ${name}. Mándale el mensaje de arriba para que active su mando.`;
    let mailto: string | null = null;
    const eventName = String(event?.name ?? "el evento");
    const by = await myName(supabase);
    // Si MANDO tiene su buzón conectado, la invitación sale sola en este momento.
    if (!joined && canSendMail()) {
      const sent = await mailInvitation({ email, name, title, eventName, inviter: by });
      if (sent) message = `Listo: le mandamos la invitación por correo a ${name} (${email}).`;
    }
    if (copies.emails.length) {
      // Los «con copia» solo reciben un aviso: no entran a MANDO ni ven nada del evento.
      const notice = {
        name,
        title,
        eventName,
        eventDate: event?.starts_at ? formatDate(String(event.starts_at), String(event.timezone ?? "America/Lima")) : undefined,
        by,
      };
      const n = copies.emails.length;
      const { subject, body } = copyNotice(notice);
      const sent = canSendMail() && (await sendMail({ to: [mandoMailbox()], bcc: copies.emails, subject, text: body }));
      if (sent) message += ` Avisamos a ${n === 1 ? "1 persona" : `${n} personas`} con copia.`;
      else mailto = copyMailto(copies.emails, notice);
    }
    return { ok: true, error: null, message, copyMailto: mailto };
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
