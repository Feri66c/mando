import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getBrief, getCurrentUser, getEventTemplate, getMyEvent } from "@/lib/data";
import { TIERS, welcomeMandatories, type TierKey } from "@mando/core/event-types";
import { ROLE_LABEL } from "@mando/core/labels";
import { formatDate, formatTime, zoneLabel } from "@mando/core/time";
import { Welcome } from "./welcome";

export const metadata: Metadata = { title: "Bienvenida" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo primero que ve una persona invitada: agradecimiento, su evento, lo no negociable y el reloj que arranca. */
export default async function WelcomePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await getCurrentUser();
  const event = await getMyEvent(id, user.id);
  if (!event) notFound();
  if (event.welcomedAt) redirect(`/eventos/${id}`);
  const { template, createdByName } = await getEventTemplate(id);
  const isViewer = event.role === "viewer";
  if (!isViewer && !event.acceptedAt) redirect("/eventos"); // primero acepta su cargo
  const brief = isViewer ? null : await getBrief(id, user.id);

  return (
    <Welcome
      eventId={id}
      brief={brief}
      firstName={user.fullName.split(" ")[0]}
      inviter={createdByName}
      eventName={event.name}
      typeLabel={[event.eventType, event.tier ? TIERS[event.tier as TierKey]?.nombre : null].filter(Boolean).join(" · ")}
      cargo={event.title ?? ROLE_LABEL[event.role]}
      isViewer={isViewer}
      keyLabel={template?.hora_clave ?? "Inicio del evento"}
      keyTimeIso={event.startsAt}
      dateText={event.startsAt ? formatDate(event.startsAt, event.timezone) : null}
      timeText={event.startsAt ? formatTime(event.startsAt, event.timezone) : null}
      zone={zoneLabel(event.timezone)}
      pieces={template?.piezas.length ?? 0}
      mandatories={isViewer ? [] : welcomeMandatories(template).slice(0, 5)}
    />
  );
}
