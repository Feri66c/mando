"use server";

// Foto, avatar y modo de pantalla de cada persona (decisión 96).

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { AvatarUnavailable, drawAvatar, isAvatarStyle } from "@/lib/avatar";
import { isDisplayMode } from "@mando/core/data";
import { profileFilePath } from "@mando/core/command";
import type { CierreState } from "./cierre";

import { MODE_COOKIE } from "@/lib/modo";

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  if (/row-level security|permission denied/i.test(message)) return "No tienes permiso para hacer eso.";
  if (/fetch failed|network/i.test(message)) return "Sin conexión con el servidor. Revisa la señal e intenta de nuevo.";
  return message || "Algo falló. Intenta de nuevo.";
}

async function session() {
  const supabase = await createClient();
  if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Tu sesión terminó. Vuelve a ingresar.");
  return { supabase, me: data.user.id };
}

/** La foto ya se subió al cubo privado; aquí se guarda en el perfil. Sirve para la propia o la de alguien del equipo. */
export async function setPhotoAction(input: { profileId: string; path: string | null }): Promise<CierreState> {
  try {
    const { supabase } = await session();
    const { error } = await supabase.rpc("set_profile_photo", { p_profile: input.profileId, p_path: input.path });
    if (error) throw error;
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
  refresh();
  return { ok: true, error: null, message: input.path ? "Foto guardada." : "Foto retirada." };
}

/** Crea el avatar desde la foto de la persona. Tarda entre 20 y 60 segundos. */
export async function createAvatarAction(style: string): Promise<CierreState> {
  try {
    if (!isAvatarStyle(style)) throw new Error("Elige un estilo.");
    const { supabase, me } = await session();
    const { data: profile } = await supabase.from("profiles").select("photo_path").eq("id", me).maybeSingle();
    const photoPath = profile?.photo_path as string | null;
    if (!photoPath) throw new Error("Primero sube tu foto: el avatar se crea a partir de ella.");
    const { data: photo, error: dlError } = await supabase.storage.from("evidences").download(photoPath);
    if (dlError || !photo) throw new Error("No se pudo leer tu foto. Súbela de nuevo.");
    const png = await drawAvatar(photo, photoPath.split("/").pop() ?? "foto.jpg", style);
    const path = profileFilePath(me, crypto.randomUUID(), "avatar.png")!;
    const { error: upError } = await supabase.storage.from("evidences").upload(path, png, { contentType: "image/png", upsert: false });
    if (upError) throw new Error(`No se pudo guardar el avatar: ${upError.message}`);
    const { error } = await supabase.rpc("set_my_avatar", { p_path: path, p_show: true });
    if (error) throw error;
  } catch (e) {
    if (e instanceof AvatarUnavailable) return { ok: false, error: e.message };
    return { ok: false, error: friendly(e) };
  }
  refresh();
  return { ok: true, error: null, message: "¡Listo tu avatar! Ya se muestra en MANDO." };
}

/** Qué se muestra (foto o avatar) y en qué modo se ve MANDO. El modo también queda en una cookie para pintar rápido. */
export async function setLookAction(input: { showAvatar?: boolean; mode?: string }): Promise<CierreState> {
  try {
    const mode = input.mode && isDisplayMode(input.mode) ? input.mode : null;
    if (input.mode && !mode) throw new Error("Elige Neón, Sol o Sobrio.");
    const { supabase } = await session();
    const { error } = await supabase.rpc("set_my_look", { p_show_avatar: input.showAvatar ?? null, p_mode: mode });
    if (error) throw error;
    if (mode) (await cookies()).set(MODE_COOKIE, mode, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
  refresh();
  return { ok: true, error: null, message: "Guardado." };
}
