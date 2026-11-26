"use server";

// Cadena de mando, marcas del evento y cambios de emergencia (decisiones 59 a 64).
// Cada acción llama a una función de la base, que valida quién puede y escribe la bitácora.

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { emergencyWindowLabel, isModality, isVisibility } from "@mando/core/command";
import type { CierreState } from "./cierre";

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  if (/row-level security|permission denied/i.test(message)) return "No tienes permiso para hacer eso en este evento.";
  if (/fetch failed|network/i.test(message)) return "Sin conexión con el servidor. Revisa la señal e intenta de nuevo.";
  return message || "Algo falló. Intenta de nuevo.";
}

async function call<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createClient();
  if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Tu sesión terminó. Vuelve a ingresar.");
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

async function run(fn: string, args: Record<string, unknown>, message?: string): Promise<CierreState> {
  try {
    await call(fn, args);
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
  refresh();
  return { ok: true, error: null, message: message ?? null };
}

/** Área, mando y visibilidad de una persona del equipo. */
export async function setMemberCommandAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const visibility = text(fd, "visibilidad");
  if (!isVisibility(visibility)) return { ok: false, error: "Elige qué ve esta persona." };
  const boss = text(fd, "reporta_a");
  return run(
    "set_member_command",
    { p_event: text(fd, "event_id"), p_profile: text(fd, "profile_id"), p_area: text(fd, "area") || null, p_reports_to: UUID.test(boss) ? boss : null, p_visibility: visibility },
    "Mando actualizado.",
  );
}

/** El productor suma a su submando: coordinación (nivel 3) o técnico (nivel 4), con su área. */
export async function inviteSubmandoAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const name = text(fd, "nombre");
  const email = text(fd, "correo").toLowerCase();
  const title = text(fd, "cargo");
  const level = Number(text(fd, "nivel"));
  const visibility = text(fd, "visibilidad");
  if (!name) return { ok: false, error: "Escribe el nombre de la persona." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Escribe un correo válido." };
  if (!title) return { ok: false, error: "Escribe su cargo." };
  if (level !== 3 && level !== 4) return { ok: false, error: "Elige su nivel." };
  try {
    const data = await call<{ joined?: boolean } | null>("invite_to_event", {
      p_event: text(fd, "event_id"),
      p_email: email,
      p_full_name: name,
      p_title: title,
      p_role: "producer",
      p_level: level,
      p_area: text(fd, "area") || null,
      p_reports_to: null, // sin decirlo, queda bajo el mando de quien invita
      p_visibility: isVisibility(visibility) ? visibility : null,
    });
    refresh();
    return {
      ok: true,
      error: null,
      message: data?.joined ? `${name} ya tenía cuenta y quedó bajo tu mando como ${title}.` : `Listo. ${name} entra con su correo y el código que MANDO le manda en ese momento.`,
    };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

/** El logo ya se subió al cubo privado; aquí se registra la marca. Sin logo, queda solo el nombre. */
export async function addBrandAction(input: { eventId: string; kind: string; name: string; filePath: string | null }): Promise<CierreState> {
  if (!input.name.trim()) return { ok: false, error: "Escribe el nombre de la marca." };
  return run("add_event_brand", { p_event: input.eventId, p_kind: input.kind, p_name: input.name, p_file_path: input.filePath }, `«${input.name.trim()}» ya aparece en el evento.`);
}

export async function removeBrandAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  return run("remove_event_brand", { p_brand: text(fd, "brand_id") }, "Marca retirada.");
}

export async function setModalityAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const modality = text(fd, "modalidad");
  if (!isModality(modality)) return { ok: false, error: "Elige la modalidad del evento." };
  return run("set_event_modality", { p_event: text(fd, "event_id"), p_modality: modality, p_agency: text(fd, "agencia") || null }, "Modalidad guardada.");
}

export async function reportEmergencyAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const title = text(fd, "titulo");
  if (!title) return { ok: false, error: "Cuenta en una línea qué cambia." };
  try {
    const data = await call<{ window?: string } | null>("report_emergency_change", {
      p_event: text(fd, "event_id"),
      p_kind: text(fd, "tipo"),
      p_title: title,
      p_detail: text(fd, "detalle") || null,
    });
    refresh();
    return { ok: true, error: null, message: `Registrado como «${emergencyWindowLabel(data?.window ?? "")}». Quedó en la bitácora.` };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}
