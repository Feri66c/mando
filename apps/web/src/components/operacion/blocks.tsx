import Link from "next/link";
import type { CriticalityConfig } from "@mando/core/criticality";
import { ALERT_STATUS_LABEL, EVIDENCE_KIND_LABEL } from "@mando/core/labels";
import { formatShift, minutesLate } from "@mando/core/route";
import { formatTime } from "@mando/core/time";
import type { Alert, Evidence, LogEntry, RouteItem } from "@/lib/data";
import { Empty, LevelChip, StatusChip, areaColor } from "./ui";

/** Fila de la hoja de ruta: compacta para que entren de seis a ocho por pantalla. */
export function RouteRow({ item, eventId, timeZone, isTeam }: { item: RouteItem; eventId: string; timeZone: string; isTeam: boolean }) {
  const shift = minutesLate(item.plannedStart, item.currentStart, new Date());
  const inner = (
    <div className="flex items-stretch gap-3">
      <span aria-hidden className="w-1 shrink-0 rounded-full" style={{ background: areaColor(item.areaOrder) }} />
      <div className="w-12 shrink-0 font-mono text-sm leading-5">
        {formatTime(item.currentStart, timeZone)}
        <div className="text-xs text-ink-muted">{formatTime(item.currentEnd, timeZone)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium leading-5">
          {item.title}
          {item.isMilestone && <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-gold-300">Hito</span>}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
          <StatusChip status={item.status} />
          {item.areaName && <span>{item.areaName}</span>}
          {shift !== 0 && <span className="font-mono">{formatShift(shift)} del plan</span>}
          {isTeam && !item.visibleToViewer && <span className="text-[#ffb19e]">Oculto al cliente</span>}
        </div>
      </div>
      {isTeam && (
        <span aria-hidden className="self-center text-ink-muted">
          ›
        </span>
      )}
    </div>
  );
  return (
    <li>
      {isTeam ? (
        <Link href={`/eventos/${eventId}/actividad/${item.id}`} className="block min-h-14 rounded-card bg-surface-100 px-3 py-3 hover:bg-surface-200">
          {inner}
        </Link>
      ) : (
        <div className="rounded-card bg-surface-100 px-3 py-3">{inner}</div>
      )}
    </li>
  );
}

export function LogList({ entries, timeZone, config }: { entries: LogEntry[]; timeZone: string; config: CriticalityConfig | null }) {
  if (entries.length === 0) return <Empty>La bitácora está vacía.</Empty>;
  return (
    <ol className="space-y-1" aria-label="Bitácora">
      {entries.map((e) => (
        <li key={e.id} className="flex gap-3 rounded-2xl px-2 py-2 odd:bg-surface-100/60">
          <time className="w-12 shrink-0 font-mono text-sm text-ice-300">{formatTime(e.at, timeZone)}</time>
          <div className="min-w-0 flex-1 text-sm">
            {e.level && e.level > 1 && (
              <span className="mr-2 align-middle">
                <LevelChip level={e.level} config={config} />
              </span>
            )}
            <span className="align-middle">{e.summary}</span>
            {e.actorName && e.kind !== "change_applied" && <span className="block text-xs text-ink-muted">{e.actorName}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function AlertCard({
  alert,
  config,
  timeZone,
  children,
}: {
  alert: Alert;
  config: CriticalityConfig | null;
  timeZone: string;
  children?: React.ReactNode;
}) {
  return (
    <li className={`rounded-card bg-surface-100 p-4 ${alert.status === "resolved" ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <LevelChip level={alert.level} config={config} />
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{ALERT_STATUS_LABEL[alert.status]}</span>
        <time className="ml-auto font-mono text-xs text-ink-muted">{formatTime(alert.raisedAt, timeZone)}</time>
      </div>
      <p className="mt-2 font-medium">{alert.title}</p>
      {alert.detail && <p className="mt-1 text-sm text-ink-muted">{alert.detail}</p>}
      {children}
    </li>
  );
}

export function EvidenceGrid({ items, timeZone, isTeam }: { items: Evidence[]; timeZone: string; isTeam: boolean }) {
  if (items.length === 0) return <Empty>Todavía no hay evidencias.</Empty>;
  return (
    <ul className="grid grid-cols-2 gap-2">
      {items.map((ev) => (
        <li key={ev.id} className="overflow-hidden rounded-card bg-surface-100">
          {ev.kind === "photo" && ev.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- enlace firmado y privado: no pasa por el optimizador
            <img src={ev.url} alt={ev.note ?? "Foto de evidencia"} className="aspect-square w-full object-cover" loading="lazy" />
          ) : ev.kind === "video" && ev.url ? (
            <video src={ev.url} controls preload="metadata" className="aspect-square w-full bg-black object-cover" />
          ) : ev.kind === "audio" && ev.url ? (
            <div className="flex aspect-square items-center p-2">
              <audio src={ev.url} controls className="w-full" />
            </div>
          ) : (
            <div className="flex aspect-square items-center justify-center p-3 text-center text-sm">
              {ev.url ? (
                <a href={ev.url} target="_blank" rel="noreferrer" className="font-semibold underline">
                  Abrir {EVIDENCE_KIND_LABEL[ev.kind].toLowerCase()}
                </a>
              ) : (
                <span>{ev.note}</span>
              )}
            </div>
          )}
          <div className="space-y-0.5 p-2 text-xs">
            <p className="font-semibold">
              {EVIDENCE_KIND_LABEL[ev.kind]} ·{" "}
              <span className="font-mono" title="Hora del servidor">
                {formatTime(ev.receivedAt, timeZone)}
              </span>
            </p>
            {ev.note && ev.kind !== "note" && <p className="line-clamp-2 text-ink-muted">{ev.note}</p>}
            {isTeam && !ev.visibleToViewer && <p className="text-[#ffb19e]">Oculta al cliente</p>}
            {isTeam && ev.sha256 && (
              <p className="truncate font-mono text-[10px] text-ink-muted" title={`SHA-256 ${ev.sha256}`}>
                huella {ev.sha256.slice(0, 12)}…
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
