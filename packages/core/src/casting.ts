// Mini ficha del casting y tipos de documento (decisiones 51 y 52). Los campos viven en config/ficha-casting.json.
import config from "../../../config/ficha-casting.json";

export type FichaField = {
  clave: string;
  nombre: string;
  tipo: "numero" | "opciones" | "texto";
  unidad?: string;
  min?: number;
  max?: number;
  opciones?: string[];
};
export type DocType = { clave: string; nombre: string; largo_min: number; largo_max: number; solo_numeros: boolean; ayuda: string };

export const FICHA_FIELDS = config.campos as readonly FichaField[];
export const DOC_TYPES = config.documentos as readonly DocType[];

export function docType(key: string | null | undefined): DocType {
  return DOC_TYPES.find((d) => d.clave === key) ?? DOC_TYPES[0];
}

/** Deja el número como lo guarda la base: sin espacios ni guiones, en mayúsculas y, si es DNI, solo números. */
export function cleanDocNumber(type: string, raw: string): string {
  const t = docType(type);
  const base = raw.toUpperCase().replace(t.solo_numeros ? /\D/g : /[^A-Z0-9]/g, "");
  return base.slice(0, t.largo_max);
}

/** Null si está bien (o vacío); si no, el motivo en palabras simples. */
export function docProblem(type: string, raw: string): string | null {
  const t = docType(type);
  const value = cleanDocNumber(type, raw);
  if (value.length === 0) return null;
  if (value.length < t.largo_min) return `${t.nombre}: ${t.ayuda.toLowerCase()}.`;
  return null;
}

/** Solo los campos conocidos y con valor, como textos. Lo demás se descarta. */
export function cleanFicha(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of FICHA_FIELDS) {
    const value = String(raw[f.clave] ?? "").trim();
    if (!value) continue;
    if (f.tipo === "numero") {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) continue;
      out[f.clave] = String(n);
    } else out[f.clave] = value.slice(0, 120);
  }
  return out;
}

/** La ficha lista para mostrar: nombre del campo y valor con su unidad, en el orden de la configuración. */
export function fichaRows(profile: Record<string, string>): { clave: string; nombre: string; valor: string }[] {
  return FICHA_FIELDS.filter((f) => profile[f.clave]).map((f) => ({
    clave: f.clave,
    nombre: f.nombre,
    valor: f.unidad ? `${profile[f.clave]} ${f.unidad}` : profile[f.clave],
  }));
}

export function validateFichaConfig(): string[] {
  const problems: string[] = [];
  const keys = FICHA_FIELDS.map((f) => f.clave);
  if (new Set(keys).size !== keys.length) problems.push("Hay campos repetidos en la ficha.");
  if (keys.length > 30) problems.push("La ficha admite hasta 30 campos.");
  for (const f of FICHA_FIELDS) if (f.tipo === "opciones" && !(f.opciones?.length)) problems.push(`El campo ${f.clave} no tiene opciones.`);
  if (DOC_TYPES[0]?.clave !== "dni") problems.push("El primer documento debe ser el DNI.");
  return problems;
}
