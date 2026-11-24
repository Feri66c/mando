import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/brand";
import { EventStatusText, ItemStatusText, RolePill } from "@/components/pills";
import { getCurrentUser, getMyEvent, getRouteItems } from "@/lib/data";
import { ROLE_LABEL } from "@/lib/labels";
import { formatEventRange, formatTime, zoneLabel } from "@/lib/time";

export const metadata: Metadata = { title: "Evento" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await getCurrentUser();
  const event = await getMyEvent(id, user.id);
  if (!event) notFound(); // no es miembro: para la base de datos, el evento no existe
  const items = await getRouteItems(event.id);
  const isTeam = event.role !== "viewer";

  return (
    <>
      <AppHeader label={ROLE_LABEL[event.role].toUpperCase()} userName={user.fullName} />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Link href="/eventos" className="text-sm font-medium text-navy-600 hover:underline">
          ← Mis eventos
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <EventStatusText status={event.status} />
          <RolePill role={event.role} />
        </div>
        <h1 className="mt-2 font-display text-2xl font-semibold leading-tight">{event.name}</h1>
        <p className="mt-1 font-mono text-sm text-navy-600">
          {formatEventRange(event.startsAt, event.endsAt, event.timezone)}
        </p>
        <p className="mt-1 text-sm text-ink-muted">{[event.venueName, event.clientName].filter(Boolean).join(" · ")}</p>

        <section className="mt-8" aria-labelledby="ruta">
          <div className="flex items-baseline justify-between">
            <h2 id="ruta" className="font-display text-lg font-semibold">
              Hoja de ruta
            </h2>
            <span className="font-mono text-xs text-ink-muted">hora de {zoneLabel(event.timezone)}</span>
          </div>
          {items.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">Aún no hay actividades publicadas.</p>
          ) : (
            <ol className="mt-3 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface-100">
              {items.map((item) => (
                <li key={item.id} className="flex gap-4 p-4">
                  <div className="w-14 shrink-0 font-mono text-sm leading-6 text-navy-600">
                    {formatTime(item.currentStart, event.timezone)}
                    <div className="text-xs text-ink-muted">{formatTime(item.currentEnd, event.timezone)}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-6">
                      {item.title}
                      {item.isMilestone && (
                        <span className="ml-2 rounded-chip bg-navy-800 px-1.5 py-0.5 align-middle text-[11px] font-semibold uppercase tracking-wide text-ink-inverse">
                          Hito
                        </span>
                      )}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <ItemStatusText status={item.status} />
                      {item.areaName && <span className="text-xs text-ink-muted">{item.areaName}</span>}
                      {isTeam && !item.visibleToViewer && (
                        <span className="text-xs font-medium text-critical">Oculto al cliente</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-4 text-xs text-ink-muted">
            Vista de solo lectura. La hoja de ruta en vivo, los cambios y la bitácora llegan en la Fase 1.
          </p>
        </section>
      </main>
    </>
  );
}
