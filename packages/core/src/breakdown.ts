// Desglose para cotizar (decisión 89). La IA arma de 100 a 150 ítems por rubro; el productor recorta
// el Excel y lo vuelve a subir para que la IA revise lo que quitó o cambió. Lo ajustable vive en config/desglose.json.
import config from "../../../config/desglose.json";

export type Rubro = { codigo: string; nombre: string; ejemplos: string };
export type BreakdownGroup = { clave: string; nombre: string; rubros: string[] };
export type BreakdownItem = {
  codigo: string;
  rubro: string;
  item: string;
  detalle: string;
  unidad: string;
  cantidad: number;
  dias: number;
  criterio: string;
  origen: "brief" | "estandar";
};

export const RUBROS: readonly Rubro[] = config.rubros;
export const BREAKDOWN_GROUPS: readonly BreakdownGroup[] = config.grupos;
export const BREAKDOWN_RULES: readonly string[] = config.reglas;
export const ITEMS_MIN = config.items_minimo;
export const ITEMS_MAX = config.items_maximo;

const byCode = new Map(RUBROS.map((r) => [r.codigo, r]));

export function rubroName(code: string): string {
  return byCode.get(code)?.nombre ?? code;
}

/** Cuántos ítems pedir a cada grupo para que el total quede entre el mínimo y el máximo. */
export function itemsPerGroup(group: BreakdownGroup): { min: number; max: number } {
  const total = RUBROS.length || 1;
  const share = group.rubros.length / total;
  return { min: Math.round(ITEMS_MIN * share), max: Math.round(ITEMS_MAX * share) };
}

const num = (v: unknown, fallback: number) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : fallback;
};
const str = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Limpia lo que devolvió la IA, ordena por rubro y pone códigos estables (AUD-01, AUD-02…). */
export function assignCodes(raw: Partial<Omit<BreakdownItem, "codigo">>[]): BreakdownItem[] {
  const order = new Map(RUBROS.map((r, i) => [r.codigo, i]));
  const clean = raw
    .map((r) => ({
      rubro: byCode.has(String(r.rubro)) ? String(r.rubro) : "PRD",
      item: str(r.item, 120),
      detalle: str(r.detalle, 300),
      unidad: str(r.unidad, 30) || "unidad",
      cantidad: num(r.cantidad, 1),
      dias: num(r.dias, 1) || 1,
      criterio: str(r.criterio, 300),
      origen: r.origen === "brief" ? ("brief" as const) : ("estandar" as const),
    }))
    .filter((r) => r.item)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (order.get(a.r.rubro)! - order.get(b.r.rubro)!) || a.i - b.i)
    .map(({ r }) => r);
  const seq = new Map<string, number>();
  return clean.map((r) => {
    const n = (seq.get(r.rubro) ?? 0) + 1;
    seq.set(r.rubro, n);
    return { codigo: `${r.rubro}-${String(n).padStart(2, "0")}`, ...r };
  });
}

export type BreakdownDiff = {
  removed: BreakdownItem[];
  changed: { item: BreakdownItem; before: { cantidad: number; dias: number }; after: { cantidad: number; dias: number } }[];
  added: BreakdownItem[];
};

/** Compara el desglose que armó la IA con el Excel que volvió: qué se quitó, qué cambió de cantidad y qué se sumó. */
export function compareBreakdown(base: readonly BreakdownItem[], current: readonly BreakdownItem[]): BreakdownDiff {
  const now = new Map(current.filter((c) => c.codigo).map((c) => [c.codigo, c]));
  const before = new Set(base.map((b) => b.codigo));
  const removed = base.filter((b) => !now.has(b.codigo));
  const changed = base.flatMap((b) => {
    const c = now.get(b.codigo);
    if (!c || (c.cantidad === b.cantidad && c.dias === b.dias)) return [];
    return [{ item: c, before: { cantidad: b.cantidad, dias: b.dias }, after: { cantidad: c.cantidad, dias: c.dias } }];
  });
  const added = current.filter((c) => !c.codigo || !before.has(c.codigo));
  return { removed, changed, added };
}
