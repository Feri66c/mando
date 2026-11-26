import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RouteRow } from "@/components/operacion/blocks";
import { Empty, PageTitle } from "@/components/operacion/ui";
import { zoneLabel } from "@mando/core/time";
import { PLANNING_ELEMENTS, planningReady } from "@mando/core/planning";
import { getEventContext, getPlanning, getRouteItems } from "@/lib/data";

export const metadata: Metadata = { title: "Hoja de ruta" };

export default async function RoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  const { event, isTeam } = ctx;
  const [items, planning] = await Promise.all([getRouteItems(id), getPlanning(id)]);
  // El timeline se desbloquea cuando los 5 elementos de la planificación están completos.
  if (planning.gate && !planningReady(planning.elements)) {
    const missing = PLANNING_ELEMENTS.filter((e) => !planning.elements.find((s) => s.key === e.clave)?.ready);
    return (
      <>
        <PageTitle>Hoja de ruta</PageTitle>
        <div className="mt-4 rounded-card border border-gold-300/50 bg-surface-100 p-5">
          <p className="font-display text-lg font-semibold text-gold-300">Timeline bloqueado</p>
          <p className="mt-1 text-sm text-ink-muted">Se abre cuando la planificación esté completa. Falta:</p>
          <ul className="mt-2 grid gap-1 text-sm">
            {missing.map((e) => (
              <li key={e.clave}>
                <span className="font-semibold">{e.nombre}:</span>{" "}
                <span className="text-ink-muted">{(planning.elements.find((s) => s.key === e.clave)?.missing ?? []).join(", ") || "pendiente"}</span>
              </li>
            ))}
          </ul>
          <Link href={`/eventos/${id}/planificacion`} className="mt-4 inline-flex min-h-11 items-center rounded-full bg-gold-300 px-5 font-semibold text-navy-950">
            Ir a la planificación
          </Link>
        </div>
      </>
    );
  }
  return (
    <>
      <PageTitle aside={<span className="font-mono text-xs text-ink-muted">hora de {zoneLabel(event.timezone)}</span>}>Hoja de ruta</PageTitle>
      <p className="mt-1 text-sm text-ink-muted">
        {isTeam ? "Toca una actividad para marcarla, pedir un cambio o subir evidencias." : "Plan vigente del evento, en vivo."}
      </p>
      {isTeam && event.level !== null && event.level <= 2 && items.length > 0 && (
        <Link href={`/eventos/${id}/tiempos`} className="mr-2 mt-3 inline-flex min-h-11 items-center rounded-full border border-gold-300/60 px-5 text-sm font-semibold text-gold-300">
          Ajustar tiempos
        </Link>
      )}
      {isTeam && items.length > 0 && (
        <Link href={`/eventos/${id}/minuto-a-minuto`} className="mt-3 inline-flex min-h-11 items-center rounded-full border border-ice-300/60 px-5 text-sm font-semibold text-ice-300">
          Minuto a minuto en PDF o WhatsApp
        </Link>
      )}
      {items.length === 0 ? (
        <div className="mt-4">
          <Empty>Aún no hay actividades publicadas.</Empty>
        </div>
      ) : (
        <ol className="mt-4 grid gap-2" aria-label="Actividades">
          {items.map((item) => (
            <RouteRow key={item.id} item={item} eventId={id} timeZone={event.timezone} isTeam={isTeam} />
          ))}
        </ol>
      )}
    </>
  );
}
