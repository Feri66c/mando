import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCard, EvidenceGrid, LogList } from "@/components/operacion/blocks";
import { Card, Empty, SectionTitle, StatusChip, buttonPrimary, buttonSecondary } from "@/components/operacion/ui";
import { nowAndNext } from "@/lib/core/route";
import { formatEventRange, formatTime } from "@/lib/core/time";
import { getAlerts, getEventContext, getEvidences, getLog, getRouteItems, type RouteItem } from "@/lib/data";

export const metadata: Metadata = { title: "Hoy" };

function NowCard({ label, item, timeZone }: { label: string; item: RouteItem | null; timeZone: string }) {
  return (
    <Card>
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">{label}</p>
      {item ? (
        <>
          <p className="mt-1 font-display text-xl font-semibold leading-snug">{item.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-base">
              {formatTime(item.currentStart, timeZone)} – {formatTime(item.currentEnd, timeZone)}
            </span>
            <StatusChip status={item.status} />
          </div>
        </>
      ) : (
        <p className="mt-1 text-ink-muted">Nada por ahora.</p>
      )}
    </Card>
  );
}

export default async function TodayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  const { event, criticality, isTeam } = ctx;
  const [items, alerts, log, evidences] = await Promise.all([
    getRouteItems(id),
    getAlerts(id),
    getLog(id, isTeam ? 6 : 12),
    isTeam ? Promise.resolve([]) : getEvidences(id),
  ]);
  const { current, next } = nowAndNext(items, new Date());
  const base = `/eventos/${id}`;
  const active = alerts.filter((a) => a.status !== "resolved");

  return (
    <>
      <h1 className="sr-only">Hoy</h1>
      <p className="font-mono text-xs text-ink-muted">{formatEventRange(event.startsAt, event.endsAt, event.timezone)}</p>
      <div className="mt-3 grid gap-3">
        <NowCard label="Ahora" item={current} timeZone={event.timezone} />
        <NowCard label="Sigue" item={next} timeZone={event.timezone} />
      </div>

      {isTeam && (
        <>
          <Link href={`${base}/en-vivo`} className={`${buttonPrimary} mt-4 w-full`}>
            Abrir Modo En Vivo
          </Link>
          <SectionTitle>Acciones rápidas</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <Link href={`${base}/evidencias#evidencia`} className={buttonSecondary}>
              Evidencia
            </Link>
            <Link href={current ? `${base}/actividad/${current.id}#cambio` : `${base}/hoja-de-ruta`} className={buttonSecondary}>
              Cambio
            </Link>
            <Link href={`${base}/alertas#reportar`} className={buttonSecondary}>
              Alerta
            </Link>
            <Link href={`${base}/momentos#nuevo`} className={buttonSecondary}>
              Momento crítico
            </Link>
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
