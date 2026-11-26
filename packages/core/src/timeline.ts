// Tiempos del timeline (decisión 34): la productora estima cuánto toma cada actividad con el control grande,
// y MANDO compara esa estimación con el plan, avisa lo que no cuadra y recomienda márgenes para imprevistos.
import config from "../../../config/timeline.json";

export const DURATION_STEPS: readonly number[] = config.pasos_minutos;
const MARGINS = config.margenes as { hasta_minutos: number | null; margen_minutos: number }[];

export type TimelineItem = {
  id: string;
  title: string;
  start: string;
  end: string;
  estimatedMinutes: number | null;
  isMilestone: boolean;
};

export type TimelineIssue = {
  kind: "evento" | "plan" | "margen";
  itemId: string;
  message: string;
};

const MINUTE = 60_000;

/** «15 min», «2 h», «1 h 30 min». */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

export function plannedMinutes(item: Pick<TimelineItem, "start" | "end">): number {
  return Math.round((new Date(item.end).getTime() - new Date(item.start).getTime()) / MINUTE);
}

/** Lo que MANDO usa para calcular: la estimación de la productora o, si no hay, lo que dice el plan. */
export function effectiveMinutes(item: TimelineItem): number {
  return item.estimatedMinutes ?? plannedMinutes(item);
}

/** Margen mínimo recomendado para imprevistos, según lo que dura la actividad. */
export function marginFor(minutes: number): number {
  const rule = MARGINS.find((r) => r.hasta_minutos === null || minutes <= r.hasta_minutos);
  return rule?.margen_minutos ?? 0;
}

/** El paso del control más cercano a una duración. */
export function nearestStep(minutes: number): number {
  let best = 0;
  DURATION_STEPS.forEach((s, i) => {
    if (Math.abs(s - minutes) < Math.abs(DURATION_STEPS[best]! - minutes)) best = i;
  });
  return best;
}

/** Lo que no cuadra entre lo que la productora estima y el plan. */
export function planIssues(items: TimelineItem[], eventStartsAt: string | null): TimelineIssue[] {
  const issues: TimelineIssue[] = [];
  const sorted = [...items].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const eventStart = eventStartsAt ? new Date(eventStartsAt).getTime() : null;

  for (const item of sorted) {
    if (item.estimatedMinutes === null) continue;
    const start = new Date(item.start).getTime();
    const estimatedEnd = start + item.estimatedMinutes * MINUTE;
    if (eventStart !== null && start < eventStart && estimatedEnd > eventStart) {
      issues.push({
        kind: "evento",
        itemId: item.id,
        message: `Pusiste ${formatDuration(item.estimatedMinutes)} para «${item.title}» y el evento empieza en ${formatDuration((eventStart - start) / MINUTE)}.`,
      });
    } else if (item.estimatedMinutes > plannedMinutes(item)) {
      issues.push({
        kind: "plan",
        itemId: item.id,
        message: `«${item.title}» necesita ${formatDuration(item.estimatedMinutes)} y la hoja de ruta le da ${formatDuration(plannedMinutes(item))}. Pide el cambio de hora o ajusta el tiempo.`,
      });
    }
  }

  // Margen antes de cada hito: se mira la actividad que termina más cerca del hito.
  for (const milestone of sorted.filter((i) => i.isMilestone)) {
    const at = new Date(milestone.start).getTime();
    const before = sorted
      .filter((i) => i.id !== milestone.id && new Date(i.start).getTime() < at)
      .map((i) => ({ item: i, end: new Date(i.start).getTime() + effectiveMinutes(i) * MINUTE }))
      .filter((x) => x.end <= at)
      .sort((a, b) => b.end - a.end)[0];
    if (!before) continue;
    const gap = Math.round((at - before.end) / MINUTE);
    const wanted = marginFor(effectiveMinutes(before.item));
    if (gap < wanted) {
      issues.push({
        kind: "margen",
        itemId: before.item.id,
        message: `Entre «${before.item.title}» y «${milestone.title}» ${gap === 0 ? "no queda margen" : `quedan ${formatDuration(gap)} de margen`}. MANDO recomienda ${formatDuration(wanted)} para imprevistos.`,
      });
    }
  }
  return issues;
}

export function validateTimelineConfig(): string[] {
  const errors: string[] = [];
  if (DURATION_STEPS.length < 2) errors.push("pasos_minutos necesita al menos dos valores");
  if (DURATION_STEPS.some((s, i) => i > 0 && s <= DURATION_STEPS[i - 1]!)) errors.push("pasos_minutos debe ir de menor a mayor");
  if (MARGINS.length === 0 || MARGINS[MARGINS.length - 1]!.hasta_minutos !== null) errors.push("el último margen debe tener hasta_minutos null");
  return errors;
}
