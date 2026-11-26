import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkButtons } from "@/components/operacion/forms";
import { LiveClock } from "@/components/operacion/live";
import { Card, LevelChip, StatusChip, buttonGhost, buttonSecondary } from "@/components/operacion/ui";
import { formatShift, minutesLate, nowAndNext } from "@/lib/core/route";
import { formatTime, zoneLabel } from "@/lib/core/time";
import { getAlerts, getEventContext, getRouteItems } from "@/lib/data";

export const metadata: Metadata = { title: "Modo En Vivo" };

/**
 * Modo En Vivo: una sola pantalla, para una mano y con guantes.
 * Reloj del evento, la actividad de ahora, la que sigue y un botón grande de un toque.
 */
export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  const { event, isTeam, criticality } = ctx;
  const tz = event.timezone;
  const [items, alerts] = await Promise.all([getRouteItems(id), getAlerts(id)]);
  const now = new Date();
  const { current, next } = nowAndNext(items, now);
  const worst = alerts.filter((a) => a.status === "open").sort((a, b) => b.level - a.level)[0] ?? null;
  const base = `/eventos/${id}`;

  return (
    <>
      <h1 className="sr-only">Modo En Vivo</h1>
      <div className="text-center">
        <LiveClock timeZone={tz} seconds className="text-6xl font-medium" />
        <p className="mt-1 font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">hora del evento · {zoneLabel(tz)}</p>
      </div>

      {worst && (
        <Link href={`${base}/alertas`} className="mt-4 flex min-h-12 items-center gap-3 rounded-card bg-surface-100 px-4 py-3">
          <LevelChip level={worst.level} config={criticality} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{worst.title}</span>
          <span aria-hidden>›</span>
        </Link>
      )}

      <Card className="mt-4 border-2 border-ink/80 p-5">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">Ahora</p>
        {current ? (
          <>
            <p className="mt-1 font-display text-3xl font-semibold leading-tight">{current.title}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg">
                {formatTime(current.currentStart, tz)} – {formatTime(current.currentEnd, tz)}
              </span>
              <StatusChip status={current.status} />
            </div>
            {current.actualStart ? (
              <p className="mt-1 text-sm text-ink-muted">
                Empezó a las <span className="font-mono">{formatTime(current.actualStart, tz)}</span> ·{" "}
                {formatShift(minutesLate(current.currentStart, current.actualStart, now))}
              </p>
            ) : (
              <p className="mt-1 text-sm text-ink-muted">
                Debía empezar a las <span className="font-mono">{formatTime(current.currentStart, tz)}</span>
              </p>
            )}
            {isTeam && (
              <div className="mt-5">
                <MarkButtons itemId={current.id} started={Boolean(current.actualStart)} big allowRisk={false} />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Link href={`${base}/actividad/${current.id}#cambio`} className={buttonSecondary}>
                    Más tiempo
                  </Link>
                  <Link href={`${base}/actividad/${current.id}#evidencia`} className={buttonSecondary}>
                    Evidencia
                  </Link>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="mt-2 text-ink-muted">No hay ninguna actividad en curso.</p>
        )}
      </Card>

      <Card className="mt-3">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">Sigue</p>
        {next ? (
          <>
            <p className="mt-1 font-display text-xl font-semibold leading-snug">{next.title}</p>
            <p className="mt-1 font-mono">
              {formatTime(next.currentStart, tz)} – {formatTime(next.currentEnd, tz)}
            </p>
            {isTeam && !current && (
              <div className="mt-4">
                <MarkButtons itemId={next.id} started={false} big allowRisk={false} />
              </div>
            )}
          </>
        ) : (
          <p className="mt-1 text-ink-muted">Es la última actividad.</p>
        )}
      </Card>

      <Link href={`${base}/hoja-de-ruta`} className={`${buttonGhost} mt-4 w-full`}>
        Ver toda la hoja de ruta
      </Link>
    </>
  );
}
