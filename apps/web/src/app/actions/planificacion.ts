"use server";

// Planificación: personal, lista técnica y presupuesto. Cada acción llama a una función de la base, que valida
// el cargo y escribe la bitácora. Aquí solo se leen los formularios.

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { cleanDocNumber, docProblem, docType } from "@mando/core/casting";
import type { CierreState } from "./cierre";

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  if (/row-level security|permission denied/i.test(message)) return "No tienes permiso para hacer eso en este evento.";
  if (/people_org(anization_id)?_doc/.test(message)) return "Ese documento ya está registrado en otra ficha.";
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

// ---- Personal ----

/** Las fotos ya se subieron desde el teléfono; aquí se guarda la ficha y, si se pidió, se suma al evento. */
export async function savePersonAction(input: {
  eventId: string;
  personId: string | null;
  fullName: string;
  docType: string;
  docNumber: string;
  docExpiresOn: string;
  phone: string;
  role: string;
  photoPath: string | null;
  docPath: string | null;
  assign: boolean;
  /** El cargo no estaba en la lista: se propone al backend para el catálogo. */
  proposeRole?: boolean;
}): Promise<CierreState> {
  if (!input.fullName.trim()) return { ok: false, error: "Escribe el nombre completo." };
  const problem = docProblem(input.docType, input.docNumber);
  if (problem) return { ok: false, error: problem };
  if (input.assign && !input.role.trim()) return { ok: false, error: "Indica qué hace esta persona en el evento." };
  try {
    const supabase = await createClient();
    if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
    const { data, error } = await supabase.rpc("save_person", {
      p_event: input.eventId,
      p_person: input.personId,
      p_full_name: input.fullName,
      p_doc_type: docType(input.docType).clave,
      p_doc_number: cleanDocNumber(input.docType, input.docNumber) || null,
      p_doc_expires_on: /^\d{4}-\d{2}-\d{2}$/.test(input.docExpiresOn) ? input.docExpiresOn : null,
      p_phone: input.phone || null,
      p_default_role: input.role || null,
      p_photo_path: input.photoPath,
      p_doc_path: input.docPath,
    });
    if (error) throw error;
    if (input.assign) {
      const { error: assignError } = await supabase.rpc("assign_person", { p_event: input.eventId, p_person: data as string, p_role: input.role });
      if (assignError) throw assignError;
    }
    // Proponer el cargo nunca frena el registro: si falla, la persona igual queda con su cargo escrito.
    if (input.proposeRole && input.role.trim()) await supabase.rpc("propose_role", { p_event: input.eventId, p_name: input.role });
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
  refresh();
  const name = input.fullName.trim();
  return {
    ok: true,
    error: null,
    message: input.personId
      ? "Ficha actualizada."
      : `${name} ya está en tu base de personas${input.proposeRole ? `. El cargo «${input.role.trim()}» quedó propuesto al backend` : ""}.`,
  };
}

export async function assignPersonAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const assigned = text(fd, "assigned") === "si";
  return run(
    "assign_person",
    { p_event: text(fd, "event_id"), p_person: text(fd, "person_id"), p_role: text(fd, "role") || null, p_assigned: assigned },
    assigned ? "Sumada al evento." : "Quitada del evento.",
  );
}

// ---- Técnico ----

export async function setTechItemAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  return run("set_tech_item", { p_item: text(fd, "item_id"), p_status: text(fd, "status"), p_detail: text(fd, "detail") || null });
}

export async function addTechItemAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const title = text(fd, "titulo");
  if (!title) return { ok: false, error: "Escribe qué equipo es." };
  const plazo = text(fd, "plazo");
  return run(
    "add_tech_item",
    {
      p_event: text(fd, "event_id"),
      p_category: text(fd, "categoria"),
      p_title: title,
      p_detail: text(fd, "detalle") || null,
      p_quantity: Math.max(1, Number(text(fd, "cantidad")) || 1),
      p_mandatory: plazo === "obligatorio",
      p_due_hours: plazo === "24" ? 24 : plazo === "2" ? 2 : null,
    },
    "Agregado a la lista técnica.",
  );
}

/** El documento ya se subió al cubo privado; aquí se registra y el concepto queda confirmado. */
export async function attachTechDocAction(input: { itemId: string; filePath: string; fileName: string }): Promise<CierreState> {
  return run("attach_tech_doc", { p_item: input.itemId, p_path: input.filePath, p_name: input.fileName }, "Documento adjunto.");
}

export async function requestTechNaAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  return run("request_tech_na", { p_item: text(fd, "item_id") }, "«No aplica» enviado al backend para su revisión.");
}

export async function reviewTechNaAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  return run("review_tech_na", { p_item: text(fd, "item_id"), p_applies: text(fd, "aplica") === "si" });
}

// ---- Presupuesto ----

export async function openBudgetExtrasAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  return run("open_budget_extras", { p_event: text(fd, "event_id"), p_open: text(fd, "abrir") !== "no" });
}

export async function requestBudgetExtraAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  return run("request_budget_extra", { p_event: text(fd, "event_id"), p_kind: text(fd, "tipo"), p_note: text(fd, "nota") || null }, "Solicitado al backend.");
}

export async function decideBudgetExtraAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  return run("decide_budget_extra", { p_extra: text(fd, "extra_id"), p_approve: text(fd, "decision") === "aprobar" });
}

// ---- Backend ----

export async function applyDeadlineAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  return run("apply_planning_deadline", { p_event: text(fd, "event_id") }, "Plazo aplicado. Si faltaba algo, se levantó una Red Flag.");
}

export async function setDeadlineAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  return run("set_planning_deadline", { p_event: text(fd, "event_id"), p_hours: Number(text(fd, "horas")) || 0 }, "Plazo guardado.");
}

export async function sendInstructionAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  if (!text(fd, "texto")) return { ok: false, error: "Escribe la instrucción." };
  return run("send_instruction", { p_event: text(fd, "event_id"), p_body: text(fd, "texto") }, "Instrucción enviada al productor.");
}

export async function sendClientNoticeAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  if (!text(fd, "texto")) return { ok: false, error: "Escribe el aviso." };
  return run("send_client_notice", { p_event: text(fd, "event_id"), p_kind: text(fd, "tipo"), p_body: text(fd, "texto") }, "Aviso enviado al cliente.");
}

const money = (value: string) => Number(value.replace(/\s/g, "").replace(",", "."));

export async function setBudgetAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const total = money(text(fd, "total"));
  if (!Number.isFinite(total) || total <= 0) return { ok: false, error: "Escribe el monto del presupuesto." };
  return run("set_budget", { p_event: text(fd, "event_id"), p_total: total, p_breakdown_visible: text(fd, "desglose") === "si" }, "Presupuesto guardado.");
}

export async function addBudgetLineAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const quantity = money(text(fd, "cantidad"));
  const unit = money(text(fd, "costo"));
  if (!text(fd, "titulo") || !(quantity > 0) || !(unit >= 0)) return { ok: false, error: "Completa la partida: qué es, cuántos y cuánto cuesta cada uno." };
  return run(
    "add_budget_line",
    { p_event: text(fd, "event_id"), p_title: text(fd, "titulo"), p_quantity: quantity, p_unit_cost: unit, p_concept_key: text(fd, "concepto") || null },
    "Partida agregada.",
  );
}

export async function removeBudgetLineAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  return run("remove_budget_line", { p_line: text(fd, "line_id") });
}

export async function decideBudgetAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const approve = text(fd, "decision") === "approve";
  const note = text(fd, "note");
  if (!approve && !note) return { ok: false, error: "Cuenta qué hay que cambiar." };
  return run("decide_budget", { p_event: text(fd, "event_id"), p_approve: approve, p_note: note || null }, approve ? "Presupuesto aprobado." : "Cambio pedido.");
}

// ---- Tiempos del timeline ----

/** La productora suelta el control grande: se guarda cuánto estima que toma la actividad. */
export async function setEstimateAction(itemId: string, minutes: number): Promise<CierreState> {
  return run("set_estimate", { p_item: itemId, p_minutes: Math.round(minutes) });
}

// ---- Catálogo de cargos ----

export async function reviewRoleAction(_prev: CierreState, fd: FormData): Promise<CierreState> {
  const approve = text(fd, "decision") === "approve";
  return run("review_role", { p_role: text(fd, "role_id"), p_approve: approve }, approve ? "Aprobado. Ya está en el catálogo de todos." : "No aprobado.");
}
