// Planificación del evento (decisiones 30 a 33): los 5 elementos, la lista técnica y el presupuesto.
// Todo lo que se puede ajustar vive en config/.
import planning from "../../../config/planificacion.json";
import costs from "../../../config/costos-referencia.json";
import tech from "../../../config/tecnica.json";

export type PlanningElement = { clave: string; nombre: string; descripcion: string; ruta: string };
export const PLANNING_ELEMENTS: readonly PlanningElement[] = planning.elementos;
export const SUGGESTED_ROLES: readonly string[] = planning.roles_sugeridos;

/** Lo que devuelve la base por cada elemento: cuánto va y qué falta. */
export type ElementStatus = { key: string; ready: boolean; done: number; total: number; missing: string[] };

export function planningReady(status: ElementStatus[]): boolean {
  return PLANNING_ELEMENTS.every((e) => status.find((s) => s.key === e.clave)?.ready);
}

/** Avance de la planificación, de 0 a 5. */
export function planningProgress(status: ElementStatus[]): { ready: number; total: number } {
  return { ready: PLANNING_ELEMENTS.filter((e) => status.find((s) => s.key === e.clave)?.ready).length, total: PLANNING_ELEMENTS.length };
}

// ---- Personal ----

export type DocState = "vigente" | "vencido" | "sin_vigencia" | "sin_dni";
export const DOC_STATE_LABEL: Record<DocState, string> = {
  vigente: "DNI vigente",
  vencido: "DNI vencido",
  sin_vigencia: "Falta la fecha de vencimiento",
  sin_dni: "Falta el DNI",
};

// ---- Técnico ----

type TechSpec = { categoria: string; titulo: string; obligatorio: boolean; plazo_horas?: number; tipos: string[] | "todos" };
const TECH = tech as unknown as { categorias: { clave: string; nombre: string }[]; sugeridos: TechSpec[] };
export const TECH_CATEGORIES: readonly { clave: string; nombre: string }[] = TECH.categorias;

/** Lista técnica con la que nace un tipo de evento. */
export function techItemsFor(kind: string): Omit<TechSpec, "tipos">[] {
  return TECH.sugeridos
    .filter((t) => t.tipos === "todos" || t.tipos.includes(kind))
    .map(({ categoria, titulo, obligatorio, plazo_horas }) => ({ categoria, titulo, obligatorio, ...(plazo_horas ? { plazo_horas } : {}) }));
}

/** Hasta cuándo se puede completar algo que no es obligatorio. */
export function techDeadline(startsAt: string | null, dueHours: number | null): Date | null {
  if (!startsAt || !dueHours) return null;
  return new Date(new Date(startsAt).getTime() - dueHours * 3_600_000);
}

// ---- Presupuesto ----

export type CostReference = { clave: string; nombre: string; unidad: string; minimo: number };
export const COST_REFERENCES: readonly CostReference[] = costs.conceptos;
export const BUDGET_CURRENCY = costs.moneda;

export function formatMoney(amount: number, currency = BUDGET_CURRENCY): string {
  const symbol = currency === "PEN" ? "S/" : currency;
  return `${symbol} ${amount.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type BudgetLine = { title: string; conceptKey: string | null; quantity: number; unitCost: number };

/** Partidas por debajo del costo de referencia: «verifica, 15 viajes a S/ 10 no alcanza». */
export function budgetWarnings(lines: BudgetLine[]): { title: string; message: string }[] {
  const out: { title: string; message: string }[] = [];
  for (const line of lines) {
    const ref = COST_REFERENCES.find((c) => c.clave === line.conceptKey);
    if (!ref || line.unitCost >= ref.minimo) continue;
    out.push({
      title: line.title,
      message: `Verifica «${line.title}»: ${line.quantity} × ${formatMoney(line.unitCost)} por ${ref.unidad}. La referencia mínima es ${formatMoney(ref.minimo)} por ${ref.unidad}.`,
    });
  }
  return out;
}

export function budgetLinesTotal(lines: BudgetLine[]): number {
  return Math.round(lines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0) * 100) / 100;
}

export function validatePlanningConfig(): string[] {
  const problems: string[] = [];
  const cats = new Set(TECH.categorias.map((c) => c.clave));
  for (const t of TECH.sugeridos) {
    if (!cats.has(t.categoria)) problems.push(`Categoría técnica desconocida: ${t.categoria}.`);
    if (t.plazo_horas !== undefined && t.plazo_horas !== 24 && t.plazo_horas !== 2) problems.push(`Plazo inválido en «${t.titulo}».`);
  }
  if (PLANNING_ELEMENTS.length !== 5) problems.push("La planificación debe tener 5 elementos.");
  if (COST_REFERENCES.some((c) => !(c.minimo > 0))) problems.push("Hay costos de referencia sin mínimo.");
  return problems;
}
