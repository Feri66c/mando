"use server";

// «Crear nuevo backend»: un administrador de la organización suma a otra persona con su mismo poder
// (crear eventos, armar equipos, invitar). Los permisos los decide la base (invite_org_admin).

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { mandoMailbox, sendMail } from "@/lib/mail";

export type BackendState = { ok: boolean; error: string | null; message?: string | null; shareText?: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

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
  return { supabase, userId: data.user.id };
}

/** Texto de la invitación: va por correo y se puede copiar para WhatsApp. */
async function backendInviteText(name: string, inviter: string, orgName: string, email: string): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const first = name.trim().split(/\s+/)[0] || name;
  return (
    `Hola, ${first}. ${inviter} te dio el mando de ${orgName} en MANDO como Backend: podrás crear eventos e invitar a tu equipo. ` +
    `Entra a ${proto}://${host}/ingresar?correo=${encodeURIComponent(email)}, escribe tu correo y usa el código de 6 dígitos que te llega.`
  );
}

export async function createBackend(_prev: BackendState, formData: FormData): Promise<BackendState> {
  const org = text(formData, "organizacion");
  const name = text(formData, "nombre");
  const email = text(formData, "correo").toLowerCase();
  if (!UUID.test(org)) return { ok: false, error: "No encontramos tu organización. Vuelve a entrar." };
  if (!name) return { ok: false, error: "Escribe el nombre de la persona." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Escribe un correo válido." };
  try {
    const { supabase, userId } = await db();
    const { data, error } = await supabase.rpc("invite_org_admin", { p_org: org, p_email: email, p_full_name: name });
    if (error) return { ok: false, error: friendly(error) };
    const joined = Boolean((data as { joined?: boolean } | null)?.joined);

    const { data: me } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
    const { data: o } = await supabase.from("organizations").select("name").eq("id", org).maybeSingle();
    const share = await backendInviteText(name, String(me?.full_name ?? "Tu equipo"), String(o?.name ?? "tu productora"), email);
    const sent = await sendMail({ to: [email], bcc: [mandoMailbox()], subject: "Te dieron el mando en MANDO", text: `${share}\n\nMANDO · control de eventos en vivo` });

    refresh();
    const first = name.split(/\s+/)[0];
    const head = joined ? `${first} ya tenía cuenta: desde ahora es Backend.` : `${first} quedó invitado como Backend.`;
    return {
      ok: true,
      error: null,
      message: sent ? `${head} Le mandamos el aviso a ${email}.` : `${head} No se pudo mandar el correo: copia el mensaje y mándaselo por WhatsApp.`,
      shareText: share,
    };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function revokeBackendInvitation(id: string): Promise<BackendState> {
  if (!UUID.test(id)) return { ok: false, error: "Invitación desconocida." };
  try {
    const { supabase } = await db();
    const { error } = await supabase.rpc("revoke_org_invitation", { p_invitation: id });
    if (error) return { ok: false, error: friendly(error) };
    refresh();
    return { ok: true, error: null, message: "Invitación retirada." };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}
