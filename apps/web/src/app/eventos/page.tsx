import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/brand";
import { EventStatusText, RolePill } from "@/components/pills";
import { getAdminOrgs, getCurrentUser, getMyEvents } from "@/lib/data";
import { AcceptRole } from "@/components/accept-role";
import { ROLE_DESCRIPTION, ROLE_LABEL } from "@mando/core/labels";
import { formatEventRange, zoneLabel } from "@mando/core/time";

export const metadata: Metadata = { title: "Mis eventos" };

export default async function MyEventsPage() {
  const user = await getCurrentUser();
  const events = await getMyEvents(user.id);
  const canCreate = (await getAdminOrgs(user.id)).length > 0;

  return (
    <>
      <AppHeader userName={user.fullName} />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="font-display text-[32px] font-bold leading-none">Mis eventos</h1>
        <p className="mt-2 text-base text-ink-muted">Hola, {user.fullName}. Elige el evento que vas a controlar.</p>
        {canCreate && (
          <Link
            href="/panel"
            className="mt-4 inline-flex min-h-12 items-center rounded-full bg-gold-500 px-5 text-sm text-navy-950"
          >
            Ir al panel: crear eventos e invitar
          </Link>
        )}

        {events.length === 0 ? (
          <div className="mt-6 rounded-card border border-line bg-surface-100 p-5">
            <p className="font-medium">Todavía no tienes eventos.</p>
            <p className="mt-1 text-sm text-ink-muted">
              Cuando el productor general te invite a un evento, aparecerá aquí.
            </p>
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {events.map((event) => {
              // «vie, 20 nov. 2026 · 10:00 – 20:00»: la fecha va en blanco con luz y las horas en naranja neón.
              const when = formatEventRange(event.startsAt, event.endsAt, event.timezone).split(" · ");
              const body = (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <EventStatusText status={event.status} />
                    <RolePill role={event.role} />
                  </div>
                  {event.role !== "viewer" && (
                    <p className="mt-3 font-mono text-xs uppercase tracking-[0.14em] text-ink-muted">
                      {event.acceptedAt ? "Tu cargo" : "Te convocaron como"}
                    </p>
                  )}
                  {event.role !== "viewer" && <p className="font-display text-xl font-bold uppercase tracking-wide text-gold-500">{event.title ?? ROLE_LABEL[event.role]}</p>}
                  <h2 className="mt-2 font-display text-lg font-semibold leading-snug">{event.name}</h2>
                  <p className="mt-2 font-mono text-base font-medium">
                    {when.length > 1 ? (
                      <>
                        <span className="luz-blanca">{when[0]}</span> <span className="luz-naranja">· {when.slice(1).join(" · ")}</span>
                      </>
                    ) : (
                      <span className="luz-blanca">{when[0]}</span>
                    )}
                    <span className="block text-sm font-normal text-ink-muted">hora de {zoneLabel(event.timezone)}</span>
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {[event.venueName, event.clientName].filter(Boolean).join(" · ")}
                  </p>
                </>
              );
              // Quien todavía no acepta su cargo no entra: primero «Acepto» (decisión 40). El cliente no tiene cargo que aceptar.
              if (event.role !== "viewer" && !event.acceptedAt) {
                return (
                  <li key={event.id} className="rounded-card bg-surface-100 p-4">
                    {body}
                    <AcceptRole eventId={event.id} />
                  </li>
                );
              }
              return (
                <li key={event.id}>
                  <Link
                    href={event.welcomedAt ? `/eventos/${event.id}` : `/bienvenida/${event.id}`}
                    className="block rounded-card bg-surface-100 p-4"
                  >
                    {body}
                    <p className="mt-3 border-t border-line pt-3 text-xs text-ink-muted">{ROLE_DESCRIPTION[event.role]}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
