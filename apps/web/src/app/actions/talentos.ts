"use server";

// Banco de talentos (decisiones 55 a 58). Cada acción llama a una función de la base, que valida el cargo
// y escribe la bitácora. Aquí solo se leen los formularios.

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { cleanDocNumber, cleanFicha, docProblem, docType } from "@mando/core/casting";
import { IMPORT_LIMIT, plain, type TalentRow } from "@mando/core/talents";
import type { CierreState } from "./cierre";

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  if (/row-level security|permission denied/i.test(message)) return "No tienes permiso para hacer eso en este evento.";
  if (/people_org(anization_id)?_doc/.test(message)) return "Ese documento ya está registrado en otra ficha.";
  if (/fetch failed|network/i.test(message)) return "Sin conexión con el servidor. Revisa la señal e intenta de nuevo.";
  return message || "Algo falló. Intenta de nuevo.";
}

async function client() {
  const supabase = await createClient();
  if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Tu sesión terminó. Vuelve a ingresar.");
  return supabase;
}

/** La foto ya se subió desde el teléfono. Si el documento ya está en el banco, se actualiza esa ficha. */
export async function saveTalentAction(input: {
  eventId: string;
  fullName: string;
  docType: string;
  docNumber: string;
  categories: string[];
  profile: Record<string, string>;
  phone: string;
  photoPath: string | null;
  consent: boolean;
}): Promise<CierreState> {
  const name = input.fullName.trim();
  if (!name) return { ok: false, error: "Escribe el nombre completo." };
  const problem = docProblem(input.docType, input.docNumber);
  if (problem) return { ok: false, error: problem };
  const type = docType(input.docType).clave;
  const number = cleanDocNumber(type, input.docNumber);
  let known = false;
  try {
    const supabase = await client();
    if (number) {
      const { data } = await supabase.rpc("find_talent", { p_event: input.eventId, p_doc_type: type, p_doc_number: number });
      known = Boolean(data);
    }
    const { error } = await supabase.rpc("save_talent", {
      p_event: input.eventId,
      p_person: null,
      p_full_name: name,
      p_doc_type: type,
      p_doc_number: number || null,
      p_categories: input.categories.map(plain).filter(Boolean),
      p_profile: cleanFicha(input.profile),
      p_phone: input.phone.trim() || null,
      p_photo_path: input.photoPath,
      p_consent: input.consent,
    });
    if (error) throw error;
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
  refresh();
  return { ok: true, error: null, message: known ? `${name} ya estaba en tu banco. Su ficha quedó actualizada.` : `${name} entró a tu banco de talentos.` };
}

export async function addCastingFromTalentAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  try {
    const supabase = await client();
    const { error } = await supabase.rpc("add_casting_from_talent", { p_event: text(fd, "event_id"), p_person: text(fd, "person_id"), p_detail: text(fd, "detail") || null });
    if (error) throw error;
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
  refresh();
  return { ok: true, error: null, message: "Ya está en el casting. El cliente la ve con su foto y su ficha." };
}

export type ImportState = CierreState & { result?: { created: number; updated: number; skipped: { fila: number; motivo: string }[] } };

/** La lista ya se leyó en el teléfono; aquí viaja limpia. La base vuelve a validar cada fila. */
export async function importTalentsAction(input: { eventId: string; rows: TalentRow[]; consent: boolean }): Promise<ImportState> {
  if (input.rows.length === 0) return { ok: false, error: "La lista no tiene personas para ingresar." };
  if (input.rows.length > IMPORT_LIMIT) return { ok: false, error: `La lista tiene más de ${IMPORT_LIMIT} personas. Divídela en partes.` };
  if (!input.consent) return { ok: false, error: "Confirma que estas personas autorizaron guardar sus datos." };
  try {
    const supabase = await client();
    const rows = input.rows.map((r) => ({
      nombre: String(r.nombre ?? "").slice(0, 120),
      tipo: docType(r.tipo).clave,
      documento: String(r.documento ?? "").slice(0, 20),
      telefono: String(r.telefono ?? "").slice(0, 30),
      categorias: (Array.isArray(r.categorias) ? r.categorias : []).map((c) => plain(String(c))).filter(Boolean).slice(0, 12),
      ficha: cleanFicha(r.ficha ?? {}),
    }));
    const { data, error } = await supabase.rpc("import_talents", { p_event: input.eventId, p_rows: rows, p_consent: true });
    if (error) throw error;
    const result = data as NonNullable<ImportState["result"]>;
    refresh();
    return { ok: true, error: null, message: `Listo: ${result.created} nuevas y ${result.updated} actualizadas.`, result };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}
