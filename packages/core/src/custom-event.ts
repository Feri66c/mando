// Evento personalizado (decisión 83). El productor general le pone nombre y marca componentes;
// cada componente deriva documentos al Legal, cargos al Personal, ítems al Técnico, grupos a Aprobaciones,
// partidas al Presupuesto y piezas al timeline. El catálogo vive en datos: config/personalizado.json.
import config from "../../../config/personalizado.json";
import type { EventTemplate, TemplateCargo, TemplatePiece, TierKey } from "./event-types";
import { approvalGroup } from "./approvals";
import { withDocuments, type RequirementCategory } from "./requirements";

export const CUSTOM_KIND = "personalizado";

export type CustomDocument = { clave: string; titulo: string; categoria: RequirementCategory; plazo_dias: number; no_negociable: boolean };
export type CustomTech = { categoria: string; titulo: string; obligatorio: boolean; plazo_horas?: number };

export type CustomModule = {
  clave: string;
  nombre: string;
  descripcion: string;
  /** Áreas a las que deriva este componente (config: areas). */
  deriva: string[];
  /** Un componente pesado vuelve el evento «Mayor». */
  pesado: boolean;
  documentos: CustomDocument[];
  tecnica: CustomTech[];
  aprobaciones: string[];
  cargos: TemplateCargo[];
  piezas: TemplatePiece[];
  no_negociables: string[];
  partidas: string[];
};

export type CustomBlock = { clave: string; nombre: string; modulos: CustomModule[] };
export type CustomArea = { clave: string; nombre: string };

type Config = {
  clave: string;
  nombre: string;
  descripcion: string;
  hora_clave: string;
  areas: CustomArea[];
  base: { piezas: TemplatePiece[]; cargos: TemplateCargo[]; no_negociables: string[]; hitos_estrella: string[] };
  bloques: CustomBlock[];
};

const CONFIG = config as unknown as Config;

export const CUSTOM_BLOCKS: readonly CustomBlock[] = CONFIG.bloques;
export const CUSTOM_AREAS: readonly CustomArea[] = CONFIG.areas;
export const CUSTOM_INFO = { nombre: CONFIG.nombre, descripcion: CONFIG.descripcion, hora_clave: CONFIG.hora_clave };
const MODULES: readonly CustomModule[] = CONFIG.bloques.flatMap((b) => b.modulos);

export function customModule(key: string): CustomModule | null {
  return MODULES.find((m) => m.clave === key) ?? null;
}

/** Solo los componentes que existen, sin repetir y en el orden del catálogo. */
export function pickModules(keys: readonly string[]): CustomModule[] {
  const wanted = new Set(keys);
  return MODULES.filter((m) => wanted.has(m.clave));
}

/** Tamaño: un componente pesado o 8 componentes es «Mayor»; 3 o más, «Medio». */
export function customTier(modules: readonly CustomModule[]): TierKey {
  if (modules.some((m) => m.pesado) || modules.length >= 8) return "mayor";
  if (modules.length >= 3) return "medio";
  return "ligero";
}

function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((t) => {
    const k = key(t).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const CUSTOM_NAME_MIN = 3;
export const CUSTOM_NAME_MAX = 60;

/** Revisa lo que el productor general marcó. Devuelve el primer problema o null. */
export function checkCustom(name: string, keys: readonly string[]): string | null {
  const n = name.trim();
  if (n.length < CUSTOM_NAME_MIN) return "Ponle un nombre a tu evento personalizado.";
  if (n.length > CUSTOM_NAME_MAX) return `El nombre del tipo no puede pasar de ${CUSTOM_NAME_MAX} letras.`;
  if (pickModules(keys).length === 0) return "Marca al menos un componente de tu evento personalizado.";
  return null;
}

/** Lo que cada área recibe: cuántos componentes derivan a ella. */
export function areaLoad(modules: readonly CustomModule[]): { area: CustomArea; count: number }[] {
  return CUSTOM_AREAS.map((area) => ({ area, count: modules.filter((m) => m.deriva.includes(area.clave)).length }));
}

/**
 * Arma la plantilla del evento personalizado, lista para crear el evento:
 * la base (piezas, cargos y documentos de todo evento) más lo que trae cada componente marcado.
 */
export function composeCustomTemplate(name: string, keys: readonly string[]) {
  const modules = pickModules(keys);
  const tier = customTier(modules);
  const base: EventTemplate = {
    clave: CONFIG.clave,
    nombre: name.trim(),
    tamano: tier,
    descripcion: modules.map((m) => m.nombre).join(" · "),
    hora_clave: CONFIG.hora_clave,
    datos: modules.slice(0, 6).map((m) => m.nombre),
    piezas: uniqueBy([...CONFIG.base.piezas, ...modules.flatMap((m) => m.piezas)], (p) => p.titulo).sort(
      (a, b) => a.inicio_min - b.inicio_min,
    ),
    no_negociables: uniqueBy([...CONFIG.base.no_negociables, ...modules.flatMap((m) => m.no_negociables)], (t) => t),
    hitos_estrella: [...CONFIG.base.hitos_estrella],
    cargos: uniqueBy([...CONFIG.base.cargos, ...modules.flatMap((m) => m.cargos)], (c) => c.cargo),
  };
  // Lo de todo evento (SCTR, EPP, contratos, facturas…) viene del expediente y de la lista técnica.
  const withBase = withDocuments(base);
  return {
    ...withBase,
    modulos: modules.map((m) => m.clave),
    partidas: uniqueBy(modules.flatMap((m) => m.partidas), (t) => t),
    documentos: uniqueBy([...withBase.documentos, ...modules.flatMap((m) => m.documentos)], (d) => d.clave),
    tecnica: uniqueBy([...withBase.tecnica, ...modules.flatMap((m) => m.tecnica)], (t) => t.titulo),
    aprobaciones: uniqueBy(
      [...withBase.aprobaciones, ...modules.flatMap((m) => m.aprobaciones).map((clave) => ({ clave, prefijo: approvalPrefix(clave) }))],
      (a) => a.clave,
    ),
  };
}

function approvalPrefix(key: string): string {
  return approvalGroup(key)?.prefijo ?? "X";
}

/** Resumen de lo que deriva el armado: para mostrarlo antes de crear. */
export function customSummary(template: ReturnType<typeof composeCustomTemplate>) {
  return {
    documentos: template.documentos.length,
    noNegociables: template.no_negociables.length,
    cargos: template.cargos.length,
    tecnica: template.tecnica.length,
    aprobaciones: template.aprobaciones.length,
    piezas: template.piezas.length,
    partidas: template.partidas.length,
  };
}
