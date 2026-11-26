import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RouteRow } from "@/components/operacion/blocks";
import { Empty, PageTitle } from "@/components/operacion/ui";
import { zoneLabel } from "@/lib/core/time";
import { getEventContext, getRouteItems } from "@/lib/data";

export const metadata: Metadata = { title: "Hoja de ruta" };

export default async function RoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  const { event, isTeam } = ctx;
  const items = await getRouteItems(id);
  return (
    <>
      <PageTitle aside={<span className="font-mono text-xs text-ink-muted">hora de {zoneLabel(event.timezone)}</span>}>Hoja de ruta</PageTitle>
      <p className="mt-1 text-sm text-ink-muted">
        {isTeam ? "Toca una actividad para marcarla, pedir un cambio o subir evidencias." : "Plan vigente del evento, en vivo."}
      </p>
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
