import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eyebrow, PanelShell, TierMeter } from "@/components/panel/kit";
import { Card, Empty, buttonPrimary } from "@/components/operacion/ui";
import { EventStatusText } from "@/components/pills";
import { getAdminOrgs, getCurrentUser, getMyEvents } from "@/lib/data";
import { TIERS, type TierKey } from "@mando/core/event-types";
import { formatEventRange } from "@mando/core/time";

export const metadata: Metadata = { title: "Panel" };

/** Panel del productor general: aquí nacen los eventos y se reparte el mando. */
export default async function PanelPage() {
  const user = await getCurrentUser();
  const orgs = await getAdminOrgs(user.id);
  if (orgs.length === 0) redirect("/eventos"); // solo el productor general tiene panel
  const events = (await getMyEvents(user.id)).filter((e) => e.role === "backend");

  return (
    <PanelShell userName={user.fullName}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>{orgs[0].name} · Productor general</Eyebrow>
          <h1 className="mt-2 font-display text-3xl font-semibold leading-tight">Tú repartes el mando.</h1>
          <p className="mt-2 max-w-xl text-ink-muted">
            Crea el evento, elige su tipo e invita a cada persona con su cargo. Nadie entra sin tu invitación.
          </p>
        </div>
        <Link href="/panel/nuevo" className={buttonPrimary}>
          Crear evento
        </Link>
      </div>

      <h2 className="mb-3 mt-10 font-display text-lg font-semibold">Tus eventos</h2>
      {events.length === 0 ? (
        <Empty>Todavía no creaste eventos. Empieza con «Crear evento».</Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {events.map((event) => (
            <li key={event.id}>
              <Link href={`/panel/${event.id}`} className="block h-full">
                <Card className="h-full transition-colors hover:bg-surface-200">
                  <div className="flex items-center justify-between gap-2">
                    <EventStatusText status={event.status} />
                    {event.tier && <TierMeter tier={event.tier} label={TIERS[event.tier as TierKey]?.nombre ?? event.tier} />}
                  </div>
                  <p className="mt-2 font-display text-lg font-semibold leading-snug">{event.name}</p>
                  <p className="mt-1 text-sm text-ink-muted">{[event.eventType, event.clientName].filter(Boolean).join(" · ")}</p>
                  <p className="mt-1 font-mono text-sm text-ink-muted">{formatEventRange(event.startsAt, event.endsAt, event.timezone)}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
