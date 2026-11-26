import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShareMinute } from "@/components/operacion/minuto";
import { Empty, PageTitle, SectionTitle } from "@/components/operacion/ui";
import { minuteByMinuteText, originLabel, type MinuteRow } from "@mando/core/experience";
import { formatDate, formatTime, zoneLabel } from "@mando/core/time";
import { getEventContext, getRouteItems, getRouteVersions } from "@/lib/data";

export const metadata: Metadata = { title: "Minuto a minuto" };

/** El minuto a minuto vigente, listo para PDF o WhatsApp, y el historial de versiones (decisiones 65 y 66). */
export default async function MinutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx || !ctx.isTeam) notFound();
  const { event } = ctx;
  const [items, versions] = await Promise.all([getRouteItems(id), getRouteVersions(id)]);
  const tz = event.timezone;
  const rows: MinuteRow[] = items
    .filter((i) => i.status !== "cancelled")
    .map((i) => ({ title: i.title, start: i.currentStart, end: i.currentEnd, area: i.areaName, milestone: i.isMilestone, status: i.status }))
    .sort((a, b) => a.start.localeCompare(b.start));
  const version = versions[0]?.version ?? 1;
  const text = minuteByMinuteText({ eventName: event.name, version, rows, timeZone: tz });

  return (
    <article className="informe">
      <PageTitle aside={<span className="font-mono text-xs text-ink-muted">hora de {zoneLabel(tz)}</span>}>Minuto a minuto</PageTitle>
      <p className="mt-1 text-sm text-ink-muted">
        <span className="font-mono font-semibold text-gold-300">Versión {version}</span>
        {versions[0] ? ` · actualizado el ${formatDate(versions[0].createdAt, tz)} a las ${formatTime(versions[0].createdAt, tz)}` : " · el plan publicado, sin cambios"}
      </p>
      <p className="solo-imprimir mb-2 text-sm">
        {event.name}
        {event.clientName ? ` · ${event.clientName}` : ""}
      </p>

      <div className="mt-4">
        <ShareMinute text={text} />
      </div>

      {rows.length === 0 ? (
        <div className="mt-4">
          <Empty>Aún no hay actividades publicadas.</Empty>
        </div>
      ) : (
        <ol className="mt-4 grid gap-1.5" aria-label="Minuto a minuto vigente">
          {rows.map((r, i) => (
            <li key={`${r.start}-${i}`} className="flex items-baseline gap-3 rounded-card bg-surface-100 px-4 py-3">
              <span className="w-[108px] shrink-0 font-mono text-sm font-medium">
                {formatTime(r.start, tz)} – {formatTime(r.end, tz)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium leading-snug">
                  {r.milestone && (
                    <span aria-label="Hito" className="mr-1.5 text-gold-300">
                      ◆
                    </span>
                  )}
                  {r.title}
                </span>
                {r.area && <span className="block text-xs text-ink-muted">{r.area}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="no-imprimir">
        <SectionTitle>Historial de versiones</SectionTitle>
        {versions.length === 0 ? (
          <Empty>Todavía es la versión 1. Cada cambio aplicado a la hoja de ruta guarda una versión nueva aquí.</Empty>
        ) : (
          <ol className="grid gap-2">
            {versions.map((v) => (
              <li key={v.id} className="rounded-card bg-surface-100 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-display text-base font-semibold">Versión {v.version}</p>
                  <p className="font-mono text-xs text-ink-muted">
                    {formatDate(v.createdAt, tz)} · {formatTime(v.createdAt, tz)}
                  </p>
                </div>
                <p className="mt-1 text-sm">
                  <span className="font-mono text-xs uppercase tracking-wider text-gold-300">{originLabel(v.origin)}</span>
                  {v.reason ? <span className="text-ink-muted"> · {v.reason}</span> : null}
                </p>
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-ice-300">Ver cómo quedó</summary>
                  <ul className="mt-2 grid gap-1 font-mono text-xs">
                    {v.rows.map((r, i) => (
                      <li key={i}>
                        {formatTime(r.start, tz)} – {formatTime(r.end, tz)} <span className="font-sans text-sm">{r.title}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
            <li className="rounded-card border border-line px-4 py-3 text-sm text-ink-muted">Versión 1 · el plan publicado</li>
          </ol>
        )}
        <Link href={`/eventos/${id}/hoja-de-ruta`} className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-ice-300 underline underline-offset-4">
          Volver a la hoja de ruta
        </Link>
      </div>
    </article>
  );
}
