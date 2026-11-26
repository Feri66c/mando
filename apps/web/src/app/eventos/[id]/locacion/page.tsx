import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LocationForm } from "@/components/operacion/expediente";
import { Card, Empty, PageTitle, SectionTitle } from "@/components/operacion/ui";
import { getEventContext, getLocation } from "@/lib/data";

export const metadata: Metadata = { title: "Locación" };

/** Punto de encuentro, transporte y lo que hay que saber del lugar antes de llegar. Solo el equipo. */
export default async function LocationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx || !ctx.isTeam) notFound();
  const { event } = ctx;
  const loc = await getLocation(id);
  const canEdit = event.status !== "closed" && event.level !== null && event.level <= 2;
  const empty = !loc.updatedAt;

  const facts = [
    { label: "Punto de encuentro", value: loc.meetingPoint },
    { label: "Coordina", value: [loc.coordinator, loc.coordinatorPhone].filter(Boolean).join(" · ") || null },
    { label: "Transporte", value: [loc.transportPlate, loc.transportDetail].filter(Boolean).join(" · ") || null },
  ].filter((f) => f.value);

  return (
    <>
      <PageTitle>Locación</PageTitle>
      <p className="mb-4 mt-1 text-sm text-ink-muted">
        {event.venueName ? `${event.venueName}. ` : ""}Dónde nos encontramos, cómo llegamos y qué ya pasó antes en este lugar.
      </p>

      {empty ? (
        <Empty>Todavía no hay datos de la locación.</Empty>
      ) : (
        <>
          <dl className="grid gap-2">
            {facts.map((f) => (
              <div key={f.label} className="rounded-card bg-surface-100 p-4">
                <dt className="font-mono text-xs uppercase tracking-[0.16em] text-ink-muted">{f.label}</dt>
                <dd className="mt-1 text-lg font-semibold leading-snug">{f.value}</dd>
              </div>
            ))}
          </dl>
          {loc.mapUrl && (
            <a href={loc.mapUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-gold-500 px-5 text-base font-semibold text-navy-950">
              Abrir el mapa
            </a>
          )}

          {loc.antecedents.length > 0 && (
            <>
              <SectionTitle>Antecedentes del lugar</SectionTitle>
              <ol aria-label="Antecedentes del lugar" className="grid gap-2">
                {loc.antecedents.map((a, i) => (
                  <li key={i} className="flex gap-3 rounded-card bg-surface-100 p-4">
                    <span aria-hidden="true" className="font-mono text-sm text-gold-300">
                      {i + 1}
                    </span>
                    <span>{a}</span>
                  </li>
                ))}
              </ol>
            </>
          )}

          {(loc.killerZones || loc.blindSpots) && (
            <>
              <SectionTitle>Cuidado con</SectionTitle>
              <div className="grid gap-2">
                {loc.killerZones && (
                  <Card>
                    <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[#ff6f86]">Zonas killer</p>
                    <p className="mt-1 whitespace-pre-line">{loc.killerZones}</p>
                  </Card>
                )}
                {loc.blindSpots && (
                  <Card>
                    <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-gold-300">Puntos ciegos</p>
                    <p className="mt-1 whitespace-pre-line">{loc.blindSpots}</p>
                  </Card>
                )}
              </div>
            </>
          )}
        </>
      )}

      {canEdit && (
        <>
          <SectionTitle>{empty ? "Cargar los datos" : "Editar"}</SectionTitle>
          <Card>
            <LocationForm
              eventId={id}
              values={{
                meetingPoint: loc.meetingPoint ?? "",
                mapUrl: loc.mapUrl ?? "",
                coordinator: loc.coordinator ?? "",
                coordinatorPhone: loc.coordinatorPhone ?? "",
                transportPlate: loc.transportPlate ?? "",
                transportDetail: loc.transportDetail ?? "",
                antecedents: loc.antecedents,
                killerZones: loc.killerZones ?? "",
                blindSpots: loc.blindSpots ?? "",
              }}
            />
          </Card>
        </>
      )}
    </>
  );
}
