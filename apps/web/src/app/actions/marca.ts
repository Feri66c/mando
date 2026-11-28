"use server";

// Mando de marca y pedidos especiales (decisión 95). Cada acción llama a una función de la base,
// que valida que quien llama administre la organización.

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isRequestStatus } from "@mando/core/command";
import type { CierreState } from "./cierre";

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  if (/row-level security|permission denied/i.test(message)) return "No tienes permiso para hacer eso en esta organización.";
  if (/fetch failed|network/i.test(message)) return "Sin conexión con el servidor. Revisa la señal e intenta de nuevo.";
  return message || "Algo falló. Intenta de nuevo.";
}

async function run(fn: string, args: Record<string, unknown>, message: string): Promise<CierreState> {
  try {
    const supabase = await createClient();
    if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new Error("Tu sesión terminó. Vuelve a ingresar.");
    const { error } = await supabase.rpc(fn, args);
    if (error) throw error;
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
  refresh();
  return { ok: true, error: null, message };
}

/** El logo, si hay, ya se subió al cubo privado; aquí se guarda la marca del mando. */
export async function setOrgBrandAction(input: {
  orgId: string;
  brandName: string;
  parentName: string;
  logoPath: string | null;
  clearLogo: boolean;
}): Promise<CierreState> {
  return run(
    "set_org_brand",
    {
      p_org: input.orgId,
      p_brand_name: input.brandName.trim() || null,
      p_parent_name: input.parentName.trim() || null,
      p_logo_path: input.logoPath,
      p_clear_logo: input.clearLogo,
    },
    input.brandName.trim() ? `Listo: ahora es MANDO ${input.brandName.trim()}.` : "Marca guardada.",
  );
}

export async function requestCustomizationAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const title = text(fd, "titulo");
  if (title.length < 3) return { ok: false, error: "Cuenta en una línea qué quieres distinto." };
  return run("request_customization", { p_org: text(fd, "org_id"), p_title: title, p_detail: text(fd, "detalle") || null }, "Pedido registrado.");
}

export async function setCustomizationStatusAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const status = text(fd, "estado");
  if (!isRequestStatus(status)) return { ok: false, error: "Elige un estado." };
  return run(
    "set_customization_status",
    { p_request: text(fd, "request_id"), p_status: status, p_billable: fd.get("cobra") === "si", p_quote_note: text(fd, "nota") || null },
    "Estado actualizado.",
  );
}
