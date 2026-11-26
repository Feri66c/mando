// Banco de talentos (decisiones 55 a 58): categorías, lectura de listas CSV y exportación.
// Lo ajustable vive en config/banco-talentos.json y config/ficha-casting.json.
import config from "../../../config/banco-talentos.json";
import { DOC_TYPES, FICHA_FIELDS, cleanDocNumber, cleanFicha, docProblem } from "./casting";

export const TALENT_CATEGORIES: readonly string[] = config.categorias;
export const IMPORT_LIMIT: number = config.limite_importacion;

export function categoryLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Sin tildes, en minúsculas y sin signos: para comparar encabezados y nombres. */
export function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lee un CSV: acepta coma, punto y coma o tabulador, comillas dobles y saltos de línea dentro de comillas. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delimiter = count(";") > count(",") ? ";" : count("\t") > count(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

export type TalentRow = { nombre: string; tipo: string; documento: string; telefono: string; categorias: string[]; ficha: Record<string, string> };
export type TalentImport = { rows: TalentRow[]; problems: { fila: number; motivo: string }[]; columns: string[]; unknown: string[] };

const COLUMN_ALIASES = config.columnas as Record<string, string[]>;

function columnKey(header: string): string | null {
  const h = plain(header);
  if (!h) return null;
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) if (aliases.includes(h)) return key;
  const field = FICHA_FIELDS.find((f) => plain(f.nombre) === h || plain(f.clave.replace(/_/g, " ")) === h);
  return field ? `ficha:${field.clave}` : null;
}

function docTypeFrom(raw: string): string {
  const t = plain(raw);
  if (!t) return "dni";
  if (t.startsWith("pas")) return "pasaporte";
  if (t === "ce" || t.includes("extranjer") || t.startsWith("carn")) return "ce";
  return DOC_TYPES.find((d) => d.clave === t)?.clave ?? "dni";
}

/**
 * Convierte la lista de una castinera en filas para el banco. Lo mínimo es el nombre (o nombre y apellido);
 * edad, talla y lo demás entran a la mini ficha si la columna se llama como el campo.
 */
export function readTalentCsv(text: string, defaultCategory = ""): TalentImport {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], problems: [{ fila: 1, motivo: "La lista necesita una fila de títulos y al menos una persona." }], columns: [], unknown: [] };
  const header = table[0];
  const keys = header.map(columnKey);
  const unknown = header.filter((h, i) => h && !keys[i]);
  if (!keys.includes("nombre")) return { rows: [], problems: [{ fila: 1, motivo: "Falta la columna «Nombre»." }], columns: [], unknown };
  const rows: TalentRow[] = [];
  const problems: TalentImport["problems"] = [];
  table.slice(1).forEach((cells, index) => {
    const fila = index + 2;
    const get = (key: string) => {
      const i = keys.indexOf(key);
      return i >= 0 ? (cells[i] ?? "").trim() : "";
    };
    const nombre = [get("nombre"), get("apellido")].filter(Boolean).join(" ").replace(/\s+/g, " ");
    if (!nombre) return problems.push({ fila, motivo: "Falta el nombre." });
    const rawDoc = get("documento");
    // Sin columna de tipo: 8 números es DNI; con letras, pasaporte.
    const tipo = get("tipo") ? docTypeFrom(get("tipo")) : /[a-z]/i.test(rawDoc) ? "pasaporte" : "dni";
    const problem = docProblem(tipo, rawDoc);
    if (problem || (tipo === "dni" && rawDoc && rawDoc.replace(/\D/g, "").length !== 8)) {
      return problems.push({ fila, motivo: `${nombre}: ${problem ?? "DNI: 8 números exactos."}` });
    }
    const fichaRaw: Record<string, string> = {};
    keys.forEach((k, i) => {
      if (k?.startsWith("ficha:")) fichaRaw[k.slice(6)] = (cells[i] ?? "").replace(/\s*(años|cm)\s*$/i, "").trim();
    });
    const categorias = [...get("categorias").split(/[,;/|]/), defaultCategory].map((c) => plain(c)).filter(Boolean);
    rows.push({ nombre, tipo, documento: cleanDocNumber(tipo, rawDoc), telefono: get("telefono"), categorias: [...new Set(categorias)], ficha: cleanFicha(fichaRaw) });
  });
  if (rows.length > IMPORT_LIMIT) return { rows: [], problems: [{ fila: 1, motivo: `La lista tiene más de ${IMPORT_LIMIT} personas. Divídela en partes.` }], columns: [], unknown };
  return { rows, problems, columns: [...new Set(keys.filter((k): k is string => Boolean(k)).map((k) => (k.startsWith("ficha:") ? (FICHA_FIELDS.find((f) => f.clave === k.slice(6))?.nombre ?? k) : k)))], unknown };
}

export type Talent = {
  id: string;
  fullName: string;
  docType: string | null;
  docNumber: string | null;
  phone: string | null;
  photoUrl: string | null;
  categories: string[];
  profile: Record<string, string>;
  defaultRole: string | null;
  consent: boolean;
  events: number;
  inCasting: boolean;
};

function csvCell(value: string): string {
  // Lo que empieza con = + - @ se guarda como texto: una hoja de cálculo no debe ejecutarlo como fórmula.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** El banco como CSV que Excel abre directo (con marca de UTF-8). Una fila por persona. */
export function talentsToCsv(talents: Talent[]): string {
  const header = ["Nombre completo", "Tipo de documento", "Documento", "Teléfono", "Categorías", "Cargo", ...FICHA_FIELDS.map((f) => f.nombre), "Eventos", "Autorizó sus datos"];
  const lines = talents.map((t) =>
    [
      t.fullName,
      DOC_TYPES.find((d) => d.clave === t.docType)?.nombre ?? "",
      t.docNumber ?? "",
      t.phone ?? "",
      t.categories.map(categoryLabel).join(", "),
      t.defaultRole ?? "",
      ...FICHA_FIELDS.map((f) => t.profile[f.clave] ?? ""),
      String(t.events),
      t.consent ? "Sí" : "No",
    ]
      .map(csvCell)
      .join(","),
  );
  return `﻿${[header.map(csvCell).join(","), ...lines].join("\r\n")}\r\n`;
}

/** Filtra el banco por categoría y por texto (nombre, documento o habilidad). */
export function filterTalents(talents: Talent[], category: string, query: string): Talent[] {
  const q = plain(query);
  return talents.filter((t) => {
    if (category && !t.categories.includes(category)) return false;
    if (!q) return true;
    return plain([t.fullName, t.docNumber ?? "", t.defaultRole ?? "", ...t.categories, ...Object.values(t.profile)].join(" ")).includes(q);
  });
}
