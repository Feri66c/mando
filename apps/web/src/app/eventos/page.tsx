import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/brand";
import { EventStatusText, RolePill } from "@/components/pills";
import { getCurrentUser, getMyEvents } from "@/lib/data";
import { ROLE_DESCRIPTION } from "@mando/core/labels";
import { formatEventRange, zoneLabel } from "@mando/core/time";

export const metadata: Metadata = { title: "Mis eventos" };

export default async function MyEventsPage() {
  const user = await getCurrentUser();
  const events = await getMyEvents(user.id);

  return (
    <>
      <AppHeader label="Mis eventos" userName={user.fullName} />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="font-display text-2xl font-semibold">Mis eventos</h1>
        <p className="mt-1 text-sm text-ink-muted">Hola, {user.fullName}. Elige el evento que vas a controlar.</p>

        {events.length === 0 ? (
          <div className="mt-6 rounded-card border border-line bg-surface-100 p-5">
            <p className="font-medium">Todavía no tienes eventos.</p>
            <p className="mt-1 text-sm text-ink-muted">
              Cuando la torre de control te invite a un evento, aparecerá aquí.
            </p>
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {events.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/eventos/${event.id}`}
                  className="block rounded-card border border-line bg-surface-100 p-4 transition-colors hover:border-navy-600"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <EventStatusText status={event.status} />
                    <RolePill role={event.role} />
                  </div>
                  <h2 className="mt-2 font-display text-lg font-semibold leading-snug">{event.name}</h2>
                  <p className="mt-1 font-mono text-sm text-navy-600">
                    {formatEventRange(event.startsAt, event.endsAt, event.timezone)}{" "}
                    <span className="text-ink-muted">· hora de {zoneLabel(event.timezone)}</span>
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {[event.venueName, event.clientName].filter(Boolean).join(" · ")}
                  </p>
                  <p className="mt-3 border-t border-line pt-3 text-xs text-ink-muted">
                    {event.title ? `${event.title}. ` : ""}
                    {ROLE_DESCRIPTION[event.role]}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
