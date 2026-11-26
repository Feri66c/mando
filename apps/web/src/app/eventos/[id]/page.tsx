import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCard, EvidenceGrid, LogList } from "@/components/operacion/blocks";
import { Empty, SectionTitle, StatusChip, buttonPrimary } from "@/components/operacion/ui";
import { PLANNING_ELEMENTS, planningProgress } from "@mando/core/planning";
import { nowAndNext } from "@mando/core/route";
import { formatEventRange, formatTime } from "@mando/core/time";
import { Express } from "./express";
import { getAlerts, getClientNotices, getEventContext, getPlanning, getEvidences, getLog, getRouteItems, type RouteItem } from "@/lib/data";

export const metadata: Metadata = { title: "Hoy" };

function Slot({ item, timeZone }: { item: RouteItem | null; timeZone: string }) {
  if (!item) return <p className="mt-1 text-ink-muted">Nada por ahora.</p>;
  return (
    <>
      <p className="mt-1.5 font-display text-[26px] font-bold leading-[1.05]">{item.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-[17px] font-medium">
          {formatTime(item.currentStart, timeZone)} – {formatTime(item.currentEnd, timeZone)}
        </span>
        <StatusChip status={item.status} />
      </div>
    </>
  );
}

export default async function TodayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  const { event, criticality, isTeam } = ctx;
  if (!isTeam) {
    // El cliente no ve la operación: solo MANDO Express.
    const [plan, notices] = await Promise.all([getPlanning(id), getClientNotices(id)]);
    const approvals = plan.elements.find((e) => e.key === "aprobaciones");
    return (
      <Express
        eventId={id}
        status={event.status}
        startsAt={event.startsAt}
        endsAt={event.endsAt}
        timeZone={event.timezone}
        elements={plan.elements}
        approvalsPending={Boolean(approvals && !approvals.ready)}
        notices={notices}
      />
    );
  }
  const [items, alerts, log, evidences, planning] = await Promise.all([
    getRouteItems(id),
    getAlerts(id),
    getLog(id, isTeam ? 6 : 12),
    isTeam ? Promise.resolve([]) : getEvidences(id),
    getPlanning(id),
  ]);
  // Eventos con candado: los 5 elementos. Eventos anteriores: solo las aprobaciones del cliente.
  const pendingElements = PLANNING_ELEMENTS.filter((e) => (planning.gate || e.clave === "aprobaciones") && !planning.elements.find((s) => s.key === e.clave)?.ready);
  const progress = planningProgress(planning.elements);
  const { current, next } = nowAndNext(items, new Date());
  const base = `/eventos/${id}`;
  const active = alerts.filter((a) => a.status !== "resolved");
  const stages = items.filter((i) => i.status !== "cancelled").slice(0, 14);
  const doneCount = stages.filter((i) => i.status === "done").length;
  const quick = [
    { label: "Evidencia", href: `${base}/evidencias#evidencia`, icon: <><path d="M3 7 H7.5 L9.5 4.5 H14.5 L16.5 7 H21 V19 H3 Z" /><path d="M12 9.5 L15 13 L12 16.5 L9 13 Z" /></> },
    { label: "Cambio", href: current ? `${base}/actividad/${current.id}#cambio` : `${base}/hoja-de-ruta`, icon: <><path d="M4 8 H19" /><path d="M15.5 4 L19.5 8 L15.5 12" /><path d="M20 16 H5" /><path d="M8.5 12 L4.5 16 L8.5 20" /></> },
    { label: "Alerta", href: `${base}/alertas#reportar`, icon: <><path d="M8 2.5 H16 L21.5 8 V16 L16 21.5 H8 L2.5 16 V8 Z" /><path d="M12 7 V13" /><path d="M12 16.5 V17" /></> },
    { label: "Momento crítico", href: `${base}/momentos#nuevo`, icon: <><path d="M12 2.5 L21.5 12 L12 21.5 L2.5 12 Z" /><path d="M12 8 V12.5 H15.5" /></> },
  ];

  return (
    <>
      <h1 className="sr-only">Hoy</h1>
      <section aria-label="Avance del evento">
        <div className="flex items-baseline justify-between gap-3">
          <span className="etiqueta-mando text-ice-300">
            {stages.length > 0 ? `Etapa ${Math.min(doneCount + 1, stages.length)} de ${stages.length}` : "Sin hoja de ruta"}
          </span>
          <span className="font-mono text-[11px] tracking-wide text-ink">{formatEventRange(event.startsAt, event.endsAt, event.timezone)}</span>
        </div>
        {stages.length > 0 && (
          <div aria-hidden className="mt-2 flex gap-[3px]">
            {stages.map((i) => (
              <span key={i.id} className="tramo" data-estado={i.status === "done" ? "hecho" : current?.id === i.id ? "ahora" : "falta"} />
            ))}
          </div>
        )}
      </section>

      <div className="mt-4 flex flex-col">
        <div className="encastre-marco">
          <div className="encastre-pieza">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-gold-300">Ahora</p>
            <Slot item={current} timeZone={event.timezone} />
            {isTeam && (
              <Link href={`${base}/en-vivo`} className={`${buttonPrimary} mt-4 w-full`}>
                Abrir Modo En Vivo
              </Link>
            )}
          </div>
        </div>
        <div className="encastre-recibe">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ice-300">Sigue</p>
          <Slot item={next} timeZone={event.timezone} />
        </div>
      </div>

      {pendingElements.length > 0 && event.status !== "closed" && (
        <Link href={`${base}/${planning.gate ? "planificacion" : "aprobaciones"}`} className="mt-3 block rounded-card border border-gold-300/50 bg-surface-100 px-4 py-3 text-sm">
          <span className="block font-semibold text-gold-300">
            {planning.gate
              ? `Planificación: ${progress.ready} de ${progress.total}. El timeline sigue bloqueado`
              : isTeam
                ? "Falta la aprobación del cliente para empezar"
                : "Tienes elementos por aprobar"}
          </span>
          <span className="block text-ink-muted">
            {pendingElements
              .map((e) => (planning.gate ? `${e.nombre}: ` : "") + (planning.elements.find((s) => s.key === e.clave)?.missing ?? []).join(", "))
              .join(" · ")}
          </span>
        </Link>
      )}

      {isTeam && (
        <>
          <SectionTitle>Acciones rápidas</SectionTitle>
          <div className="grid grid-cols-4 gap-1.5">
            {quick.map((q) => (
              <Link key={q.label} href={q.href} className="flex min-h-[78px] flex-col items-center justify-center gap-1.5 text-center text-[12.5px] font-medium leading-tight">
                <span aria-hidden className="hexagono flex h-[50px] w-[58px] items-center justify-center bg-surface-200">
                  <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square" strokeLinejoin="miter">
                    {q.icon}
                  </svg>
                </span>
                {q.label}
              </Link>
            ))}
          </div>
        </>
      )}

      <SectionTitle href={`${base}/alertas`} linkLabel="Ver alertas">
        {isTeam ? "Alertas activas" : "Alertas"}
      </SectionTitle>
      {active.length === 0 ? (
        <Empty>{isTeam ? "Sin alertas activas." : "Sin alertas. Todo marcha según lo previsto."}</Empty>
      ) : (
        <ul className="grid gap-2">
          {active.slice(0, 3).map((a) => (
            <AlertCard key={a.id} alert={a} config={criticality} timeZone={event.timezone} />
          ))}
        </ul>
      )}

      <SectionTitle href={`${base}/bitacora`} linkLabel="Bitácora completa">
        {isTeam ? "Bitácora" : "Minuto a minuto"}
      </SectionTitle>
      <LogList entries={log} timeZone={event.timezone} config={criticality} />

      {!isTeam && evidences.length > 0 && (
        <>
          <SectionTitle href={`${base}/evidencias`}>Evidencias</SectionTitle>
          <EvidenceGrid items={evidences.slice(0, 4)} timeZone={event.timezone} isTeam={false} />
        </>
      )}
    </>
  );
}
