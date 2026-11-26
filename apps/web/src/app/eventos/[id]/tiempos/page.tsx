import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DurationDial } from "@/components/operacion/tiempos";
import { Empty, PageTitle, SectionTitle } from "@/components/operacion/ui";
import { planningReady } from "@mando/core/planning";
import { formatTime, zoneLabel } from "@mando/core/time";
import { effectiveMinutes, formatDuration, marginFor, planIssues, plannedMinutes, type TimelineItem } from "@mando/core/timeline";
import { getEventContext, getPlanning, getRouteItems } from "@/lib/data";

export const metadata: Metadata = { title: "Tiempos" };

/** La productora estima cuánto toma cada actividad; MANDO avisa lo que no cuadra y recomienda márgenes. */
export default async function TimesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx || !ctx.isTeam) notFound();
  const { event } = ctx;
  const [items, planning] = await Promise.all([getRouteItems(id), getPlanning(id)]);
  if (planning.gate && !planningReady(planning.elements)) {
    return (
      <>
        <PageTitle>Tiempos</PageTitle>
        <div className="mt-4 rounded-card border border-gold-300/50 bg-surface-100 p-5">
          <p className="font-display text-lg font-semibold text-gold-300">Timeline bloqueado</p>
          <p className="mt-1 text-sm text-ink-muted">Los tiempos se ajustan cuando la planificación esté completa.</p>
          <Link href={`/eventos/${id}/planificacion`} className="mt-4 inline-flex min-h-11 items-center rounded-full bg-gold-300 px-5 font-semibold text-navy-950">
            Ir a la planificación
          </Link>
        </div>
      </>
    );
  }
  const canEdit = event.level !== null && event.level <= 2 && event.status !== "closed";
  const live = items.filter((i) => i.status !== "cancelled");
  const timeline: TimelineItem[] = live.map((i) => ({ id: i.id, title: i.title, start: i.currentStart, end: i.currentEnd, estimatedMinutes: i.estimatedMinutes, isMilestone: i.isMilestone }));
  const issues = planIssues(timeline, event.startsAt);
  const total = timeline.reduce((sum, i) => sum + effectiveMinutes(i), 0);
  const margin = timeline.reduce((sum, i) => sum + marginFor(effectiveMinutes(i)), 0);

  return (
    <>
      <PageTitle aside={<span className="font-mono text-xs text-ink-muted">hora de {zoneLabel(event.timezone)}</span>}>Tiempos</PageTitle>
      <p className="mt-1 text-sm text-ink-muted">
        {canEdit
          ? "Arrastra el control para decir cuánto toma cada actividad. Se guarda al soltar. La hoja de ruta no se mueve: si hace falta otra hora, se pide el cambio."
          : "Lo que el productor estima para cada actividad."}
      </p>

      {live.length === 0 ? (
        <div className="mt-4">
          <Empty>Aún no hay actividades en la hoja de ruta.</Empty>
        </div>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-card bg-surface-100 p-4">
              <dt className="text-xs uppercase tracking-wider text-ink-muted">Trabajo estimado</dt>
              <dd className="mt-1 font-mono text-2xl font-semibold">{formatDuration(total)}</dd>
            </div>
            <div className="rounded-card bg-surface-100 p-4">
              <dt className="text-xs uppercase tracking-wider text-ink-muted">Margen recomendado</dt>
              <dd className="mt-1 font-mono text-2xl font-semibold text-gold-300">{formatDuration(margin)}</dd>
            </div>
          </dl>

          <SectionTitle>{issues.length === 0 ? "Todo cuadra" : issues.length === 1 ? "1 aviso de MANDO" : `${issues.length} avisos de MANDO`}</SectionTitle>
          {issues.length === 0 ? (
            <p className="text-sm text-ink-muted">Las estimaciones entran en el plan y hay margen antes de cada hito.</p>
          ) : (
            <ul aria-label="Avisos de MANDO" className="grid gap-2">
              {issues.map((issue) => (
                <li key={`${issue.kind}-${issue.itemId}`} className="rounded-card border border-[#ff6f86]/50 bg-surface-100 p-4 text-sm">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#ff6f86]">{issue.kind === "margen" ? "Margen" : "No cuadra"}</span>
                  <p className="mt-1">{issue.message}</p>
                </li>
              ))}
            </ul>
          )}

          <SectionTitle>Actividades</SectionTitle>
          <ol aria-label="Tiempos por actividad" className="grid gap-2">
            {live.map((i) => {
              const flagged = issues.some((x) => x.itemId === i.id);
              return (
                <li key={i.id} className={`rounded-card bg-surface-100 p-4 ${flagged ? "border border-[#ff6f86]/50" : ""}`}>
                  <p className="font-medium leading-snug">
                    {i.title}
                    {i.isMilestone && <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-gold-300">Hito</span>}
                  </p>
                  <p className="font-mono text-xs text-ink-muted">
                    {formatTime(i.currentStart, event.timezone)} a {formatTime(i.currentEnd, event.timezone)} · plan de {formatDuration(plannedMinutes({ start: i.currentStart, end: i.currentEnd }))}
                  </p>
                  <DurationDial itemId={i.id} title={i.title} planned={plannedMinutes({ start: i.currentStart, end: i.currentEnd })} estimated={i.estimatedMinutes} canEdit={canEdit} />
                </li>
              );
            })}
          </ol>
        </>
      )}
    </>
  );
}
