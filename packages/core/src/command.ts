// Cadena de mando (decisiones 59 a 64): qué ve cada persona, el árbol de mandos, modalidad y marcas del evento,
// cambios de emergencia y la lista de ingreso. Lo ajustable vive en config/cadena-de-mando.json.
import config from "../../../config/cadena-de-mando.json";

export type Visibility = "completa" | "area" | "propia";
export type Modality = "directo" | "agencia" | "tercerizado";
export type BrandKind = "cliente" | "agencia" | "productora";
export type EmergencyKind = "persona" | "proveedor" | "horario" | "locacion" | "otro";
export type EmergencyWindow = "con_tiempo" | "48h" | "24h" | "ultimo_minuto";

type Option<K extends string> = { clave: K; nombre: string; detalle?: string };

export const VISIBILITIES = config.visibilidades as Option<Visibility>[];
export const MODALITIES = config.modalidades as { clave: Modality; nombre: string; etiqueta: string | null }[];
export const BRAND_KINDS = config.tipos_de_marca as Option<BrandKind>[];
export const SUGGESTED_AREAS: readonly string[] = config.areas_sugeridas;
export const EMERGENCY_KINDS = config.cambios_de_emergencia.tipos as Option<EmergencyKind>[];
export const EMERGENCY_WINDOWS = config.cambios_de_emergencia.ventanas as Option<EmergencyWindow>[];

const nameOf = <K extends string>(list: readonly Option<K>[], key: string, fallback: string) => list.find((o) => o.clave === key)?.nombre ?? fallback;

export const visibilityLabel = (key: string | null) => nameOf(VISIBILITIES, key ?? "", "Todo el evento");
export const brandKindLabel = (key: string) => nameOf(BRAND_KINDS, key, "Marca");
export const emergencyKindLabel = (key: string) => nameOf(EMERGENCY_KINDS, key, "Cambio");
export const emergencyWindowLabel = (key: string) => nameOf(EMERGENCY_WINDOWS, key, "Con tiempo");
export const isVisibility = (value: string): value is Visibility => VISIBILITIES.some((v) => v.clave === value);
export const isModality = (value: string): value is Modality => MODALITIES.some((m) => m.clave === value);

/** Lo que se muestra junto al nombre del evento: «Tercerización · Circus». Directo no lleva etiqueta. */
export function modalityBadge(modality: string | null, agency: string | null): string | null {
  const tag = MODALITIES.find((m) => m.clave === modality)?.etiqueta ?? null;
  if (!tag) return null;
  return agency ? `${tag} · ${agency}` : tag;
}

/** Lo que una persona recibe si no se dice otra cosa: productores, todo; coordinación, su área; técnicos, lo suyo. */
export function defaultVisibility(level: number | null, hasArea: boolean): Visibility {
  if (level === null || level <= 2) return "completa";
  return level === 3 && hasArea ? "area" : "propia";
}

/** ¿Ve todo el evento? El backend siempre; el resto, según su visibilidad. El cliente nunca pasa por aquí. */
export function seesAll(role: string, visibility: string | null): boolean {
  return role === "backend" || (role === "producer" && (visibility ?? "completa") === "completa");
}

export type ChainMember = {
  profileId: string;
  fullName: string;
  title: string | null;
  role: string;
  level: number | null;
  areaId: string | null;
  areaName: string | null;
  reportsTo: string | null;
  reportsToName: string | null;
  visibility: Visibility;
  subordinates: number;
  active: boolean;
};

export type ChainNode = ChainMember & { depth: number; team: number };

/**
 * Ordena la cadena como un árbol: cada mando seguido de los suyos. `depth` es cuántos mandos tiene encima;
 * `team` es toda la gente que cuelga de esa persona, no solo la directa. Quien reporta a alguien que no está
 * en la lista (o a nadie) cuelga del mando central.
 */
export function commandTree(members: ChainMember[]): ChainNode[] {
  const ids = new Set(members.map((m) => m.profileId));
  const byBoss = new Map<string | null, ChainMember[]>();
  for (const m of members) {
    const boss = m.reportsTo && ids.has(m.reportsTo) && m.reportsTo !== m.profileId ? m.reportsTo : null;
    byBoss.set(boss, [...(byBoss.get(boss) ?? []), m]);
  }
  const order = (a: ChainMember, b: ChainMember) => (a.level ?? 9) - (b.level ?? 9) || a.fullName.localeCompare(b.fullName, "es");
  const out: ChainNode[] = [];
  const seen = new Set<string>();
  const walk = (boss: string | null, depth: number): number => {
    let total = 0;
    for (const m of (byBoss.get(boss) ?? []).sort(order)) {
      if (seen.has(m.profileId)) continue;
      seen.add(m.profileId);
      const node: ChainNode = { ...m, depth, team: 0 };
      out.push(node);
      node.team = walk(m.profileId, depth + 1);
      total += 1 + node.team;
    }
    return total;
  };
  walk(null, 0);
  for (const m of [...members].sort(order)) if (!seen.has(m.profileId)) out.push({ ...m, depth: 0, team: 0 }); // por si quedó un círculo
  return out;
}

/** Cuánta gente tiene cada área, para el resumen del Staff de mando. */
export function areaSummary(members: ChainMember[]): { area: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of members) counts.set(m.areaName ?? "Sin área", (counts.get(m.areaName ?? "Sin área") ?? 0) + 1);
  return [...counts.entries()]
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => Number(a.area === "Sin área") - Number(b.area === "Sin área") || a.area.localeCompare(b.area, "es"));
}

// ---- Lista de ingreso ----

export type AccessRow = { fullName: string; docType: string | null; docNumber: string | null; role: string; docState: string };

const DOC_TYPE_LABEL: Record<string, string> = { dni: "DNI", ce: "Carnet de extranjería", pasaporte: "Pasaporte" };
const DOC_STATE_LABEL: Record<string, string> = { vigente: "Vigente", vencido: "Vencido", sin_vigencia: "Sin fecha de vencimiento", sin_dni: "Falta la copia del documento" };

export function accessCargos(rows: AccessRow[]): string[] {
  return [...new Set(rows.map((r) => r.role))].sort((a, b) => a.localeCompare(b, "es"));
}

export function filterAccess(rows: AccessRow[], cargo: string): AccessRow[] {
  const wanted = cargo.trim().toLowerCase();
  return wanted ? rows.filter((r) => r.role.toLowerCase() === wanted) : rows;
}

/** Lo que empieza con =, +, - o @ se exporta como texto: Excel no lo ejecuta como fórmula. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",;\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** «MANDO · Feria de la Construcción · Participantes», con N.º, nombre, documento, cargo y estado del documento. */
export function accessListCsv(eventName: string, rows: AccessRow[], cargo = ""): string {
  const list = filterAccess(rows, cargo);
  const title = `MANDO · ${eventName} · Participantes${cargo.trim() ? ` · ${cargo.trim()}` : ""}`;
  const lines = [
    [title],
    [`${list.length} ${list.length === 1 ? "persona" : "personas"}`],
    ["N.º", "Nombre completo", "Tipo de documento", "Número de documento", "Cargo", "Documento"],
    ...list.map((r, i) => [String(i + 1), r.fullName, DOC_TYPE_LABEL[r.docType ?? ""] ?? "", r.docNumber ?? "", r.role, DOC_STATE_LABEL[r.docState] ?? ""]),
  ];
  return `﻿${lines.map((cells) => cells.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** Ruta del logo de una marca: <evento>/marcas/<id>.<extensión>. Solo imagen: PNG, JPG o WebP. */
export function brandLogoPath(eventId: string, fileId: string, fileName: string): string | null {
  const ext = /\.(png|jpe?g|webp)$/i.exec(fileName)?.[1]?.toLowerCase();
  return ext ? `${eventId}/marcas/${fileId}.${ext}` : null;
}

/** Revisa config/cadena-de-mando.json: las claves que la base de datos conoce tienen que estar todas. */
export function validateCommandConfig(): string[] {
  const problems: string[] = [];
  const need = (label: string, have: string[], want: string[]) => {
    for (const k of want) if (!have.includes(k)) problems.push(`Falta ${label} «${k}».`);
    for (const k of have) if (!want.includes(k)) problems.push(`${label} «${k}» no existe en la base.`);
  };
  need("la visibilidad", VISIBILITIES.map((v) => v.clave), ["completa", "area", "propia"]);
  need("la modalidad", MODALITIES.map((m) => m.clave), ["directo", "agencia", "tercerizado"]);
  need("el tipo de marca", BRAND_KINDS.map((b) => b.clave), ["cliente", "agencia", "productora"]);
  need("el tipo de cambio", EMERGENCY_KINDS.map((k) => k.clave), ["persona", "proveedor", "horario", "locacion", "otro"]);
  need("la ventana", EMERGENCY_WINDOWS.map((w) => w.clave), ["con_tiempo", "48h", "24h", "ultimo_minuto"]);
  return problems;
}
