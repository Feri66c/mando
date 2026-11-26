// Plantillas de momentos críticos: viven en datos (config/plantillas-momentos.json), no en el código.
import data from "../../../config/plantillas-momentos.json";

export type MomentTemplate = {
  clave: string;
  nombre: string;
  area: string;
  documento_base: string;
  preguntas: string[];
  compromisos_tipicos: string[];
  evidencia_sugerida: string[];
};

export const MOMENT_TEMPLATES: MomentTemplate[] = (data as { plantillas: MomentTemplate[] }).plantillas;

export function templateByKey(key: string | null | undefined): MomentTemplate | null {
  return MOMENT_TEMPLATES.find((t) => t.clave === key) ?? null;
}

/** Plantilla sugerida para el área de una actividad («Sonido» → prueba de sonido). */
export function templateForArea(areaName: string | null | undefined): MomentTemplate | null {
  if (!areaName) return null;
  const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return MOMENT_TEMPLATES.find((t) => norm(t.area) === norm(areaName)) ?? null;
}

export const DOCUMENT_LABEL: Record<string, string> = {
  rider: "rider técnico",
  quote: "cotización",
  contract: "contrato",
  permit: "permiso",
  letter: "carta",
  insurance: "seguro",
  safety: "plan de seguridad",
  other: "documento",
};
