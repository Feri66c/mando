// Expediente del evento (decisión 25): documentos que hay que subir, con plazo y recordatorio.
// La lista vive en datos (config/expediente.json) y se copia al evento al crearlo.
import config from "../../../config/expediente.json";
import { approvalGroup, approvalGroupsFor } from "./approvals";
import { techItemsFor } from "./planning";
import type { EventTemplate } from "./event-types";

export type RequirementCategory = "seguridad" | "permisos" | "proveedores" | "logistica" | "administracion" | "eventualidades";

export type DocumentSpec = {
  clave: string;
  titulo: string;
  categoria: RequirementCategory;
  /** Días desde la hora clave: negativo es antes, positivo es después. */
  plazo_dias: number;
  no_negociable: boolean;
  tipos: "todos" | string[];
};

type Config = { tope_horas_antes: number; presion_dias: number[]; declaracion_jurada: string; categorias: { clave: RequirementCategory; nombre: string }[]; documentos: DocumentSpec[] };
const CONFIG = config as unknown as Config;

export const REQUIREMENT_CATEGORIES = CONFIG.categorias;
export const DOCUMENT_CATALOG: readonly DocumentSpec[] = CONFIG.documentos;
/** Tope de los documentos previos al evento: horas antes de la hora clave (decisión 74). */
export const REQUIREMENT_CAP_HOURS = CONFIG.tope_horas_antes;
export const PRESSURE_DAYS: readonly number[] = CONFIG.presion_dias;
/** Lo que declara quien sube un documento (decisión 75). */
export const SWORN_STATEMENT = CONFIG.declaracion_jurada;

/** Fecha tope de los documentos: 48 horas antes de la hora clave. */
export function requirementCap(startsAt: string | null): string | null {
  if (!startsAt) return null;
  return new Date(new Date(startsAt).getTime() - REQUIREMENT_CAP_HOURS * 3_600_000).toISOString();
}

/** Cuenta regresiva al tope, en partes. Negativo = ya pasó. */
export function countdown(toIso: string, now: Date): { past: boolean; days: number; hours: number; minutes: number; seconds: number } {
  const ms = new Date(toIso).getTime() - now.getTime();
  const total = Math.floor(Math.abs(ms) / 1000);
  return { past: ms < 0, days: Math.floor(total / 86_400), hours: Math.floor((total % 86_400) / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 };
}

export function categoryName(key: string): string {
  return CONFIG.categorias.find((c) => c.clave === key)?.nombre ?? key;
}

/** Documentos que le tocan a un tipo de evento. */
export function documentsFor(kind: string): DocumentSpec[] {
  return CONFIG.documentos.filter((d) => d.tipos === "todos" || d.tipos.includes(kind));
}

/** La plantilla que se guarda en el evento: la del tipo más su lista de documentos y sus grupos de aprobación. */
export function withDocuments<T extends Pick<EventTemplate, "clave">>(
  template: T,
): T & { documentos: Omit<DocumentSpec, "tipos">[]; aprobaciones: { clave: string; prefijo: string }[]; tecnica: ReturnType<typeof techItemsFor>; planificacion: true; tope_documentos_horas: number; presion_dias: number[] } {
  return {
    ...template,
    // Los 5 elementos: el evento nace con el timeline bloqueado hasta completarlos (config/planificacion.json).
    planificacion: true,
    // El tope de los documentos y los avisos de presión viajan con el evento (config/expediente.json).
    tope_documentos_horas: CONFIG.tope_horas_antes,
    presion_dias: [...CONFIG.presion_dias],
    tecnica: techItemsFor(template.clave),
    // Grupos que el cliente aprueba antes de empezar (config/aprobaciones.json).
    aprobaciones: approvalGroupsFor(template.clave).map((clave) => ({ clave, prefijo: approvalGroup(clave)?.prefijo ?? "X" })),
    documentos: documentsFor(template.clave).map(({ clave, titulo, categoria, plazo_dias, no_negociable }) => ({
      clave,
      titulo,
      categoria,
      plazo_dias,
      no_negociable,
    })),
  };
}

export type RequirementStatus = "pending" | "done" | "not_applicable";
export type DueState = "done" | "not_applicable" | "overdue" | "soon" | "on_track" | "no_date";

/** Cómo va un documento contra su plazo. «soon» = faltan warnDays días o menos. */
export function dueState(req: { status: RequirementStatus; dueAt: string | null }, now: Date, warnDays = 2): { state: DueState; days: number | null } {
  if (req.status === "done") return { state: "done", days: null };
  if (req.status === "not_applicable") return { state: "not_applicable", days: null };
  if (!req.dueAt) return { state: "no_date", days: null };
  const ms = new Date(req.dueAt).getTime() - now.getTime();
  if (ms < 0) return { state: "overdue", days: Math.floor(-ms / 86_400_000) };
  const days = Math.ceil(ms / 86_400_000);
  return { state: days <= warnDays ? "soon" : "on_track", days };
}

/** Frase corta del plazo: «Te quedan 2 días», «Vence hoy», «Venció hace 3 días». */
export function dueLabel(due: { state: DueState; days: number | null }): string {
  switch (due.state) {
    case "done":
      return "Subido";
    case "not_applicable":
      return "No aplica";
    case "no_date":
      return "Sin plazo";
    case "overdue":
      return due.days === 0 ? "Venció hoy" : due.days === 1 ? "Venció ayer" : `Venció hace ${due.days} días`;
    default:
      return due.days === 1 ? "Vence en menos de 1 día" : `Quedan ${due.days} días`;
  }
}

/** El recordatorio para quien debe subir el documento, listo para mandar por WhatsApp. */
export function requirementReminder(opts: { name: string; title: string; eventName: string; due: { state: DueState; days: number | null }; mandatory: boolean }): string {
  const first = opts.name.trim().split(/\s+/)[0] || opts.name;
  const when =
    opts.due.state === "overdue"
      ? "ya pasó su plazo"
      : opts.due.days === null
        ? "sigue pendiente"
        : opts.due.days <= 1
          ? "vence en menos de 1 día"
          : `te quedan ${opts.due.days} días`;
  return (
    `${first}, falta subir «${opts.title}» de ${opts.eventName}: ${when}.` +
    (opts.mandatory ? " Recuerda que es un requisito no negociable." : "") +
    " Súbelo en MANDO, en Más → Expediente."
  );
}

export function validateCatalog(): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const d of CONFIG.documentos) {
    if (keys.has(d.clave)) problems.push(`Documento repetido: ${d.clave}.`);
    keys.add(d.clave);
    if (!CONFIG.categorias.some((c) => c.clave === d.categoria)) problems.push(`Categoría desconocida en ${d.clave}.`);
    if (!Number.isInteger(d.plazo_dias)) problems.push(`Plazo inválido en ${d.clave}.`);
    if (d.plazo_dias <= 0 && d.plazo_dias * 24 > -CONFIG.tope_horas_antes) problems.push(`${d.clave} vence después del tope de ${CONFIG.tope_horas_antes} horas.`);
  }
  if (!(CONFIG.tope_horas_antes > 0)) problems.push("El tope de horas debe ser mayor que cero.");
  if (CONFIG.presion_dias.length === 0 || CONFIG.presion_dias.some((d) => !Number.isInteger(d) || d <= 0)) problems.push("Los días de presión deben ser enteros mayores que cero.");
  if (!CONFIG.declaracion_jurada.trim()) problems.push("Falta el texto de la declaración jurada.");
  return problems;
}
