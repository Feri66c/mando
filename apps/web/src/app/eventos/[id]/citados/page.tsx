import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuestActions, GuestForm } from "@/components/operacion/cierre";
import { Card, Empty, PageTitle, SectionTitle } from "@/components/operacion/ui";
import { GUEST_STATE_LABEL, guestReminder, guestState, mailtoLink, whatsappLink, type GuestState } from "@mando/core/guests";
import { formatDate, formatTime, zonedDate } from "@mando/core/time";
import { getEventContext, getGuests } from "@/lib/data";

export const metadata: Metadata = { title: "Citados" };

const STATE_COLOR: Record<GuestState, string> = {
  arrived_on_time: "text-[#8fe0b8]",
  arrived_late: "text-gold-300",
  late: "text-[#ff8f7a]",
  waiting: "text-ink-muted",
};

/** Hosts e invitados citados: recordatorio por WhatsApp o correo y marca de llegada. Solo el equipo. */
export default async function GuestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx || !ctx.isTeam) notFound();
  const { event, user } = ctx;
  const guests = await getGuests(id);
  const closed = event.status === "closed";
  const canManage = !closed && event.level !== null && event.level <= 3;
  const now = new Date();
  const arrived = guests.filter((g) => g.arrivedAt).length;

  return (
    <>
      <PageTitle aside={guests.length > 0 ? <span className="font-mono text-sm text-ink-muted">{arrived} de {guests.length} llegaron</span> : undefined}>
        Citados
      </PageTitle>
      <p className="mb-4 mt-1 text-sm text-ink-muted">
        Hosts e invitados que no usan MANDO. Mándales su recordatorio y marca cuando lleguen: su puntualidad cuenta para las estrellas.
      </p>

      {guests.length === 0 ? (
        <Empty>Todavía no hay nadie citado.</Empty>
      ) : (
        <ul aria-label="Citados" className="grid gap-2">
          {guests.map((g) => {
            const { state, delayMin } = guestState(g, now);
            const message = guestReminder({
              name: g.fullName,
              eventName: event.name,
              callAt: g.callAt,
              timeZone: event.timezone,
              venue: event.venueName,
              sender: user.fullName,
            });
            const detail =
              state === "arrived_on_time" || state === "arrived_late"
                ? `a las ${formatTime(g.arrivedAt!, event.timezone)}${delayMin > 0 ? ` · ${delayMin} min después` : ""}`
                : state === "late"
                  ? `${delayMin} min de atraso`
                  : "";
            return (
              <li key={g.id} className="rounded-card bg-surface-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-base font-semibold">{g.fullName}</p>
                    <p className="text-sm text-ink-muted">
                      {g.guestRole} · {formatDate(g.callAt, event.timezone)}
                    </p>
                  </div>
                  <p className="shrink-0 font-mono text-2xl font-semibold leading-none">{formatTime(g.callAt, event.timezone)}</p>
                </div>
                <p className={`mt-2 font-mono text-xs font-semibold uppercase tracking-wider ${STATE_COLOR[state]}`}>
                  {GUEST_STATE_LABEL[state]}
                  {detail ? ` · ${detail}` : ""}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  {g.reminders === 0
                    ? "Sin recordatorio todavía."
                    : `${g.reminders === 1 ? "1 recordatorio" : `${g.reminders} recordatorios`}, el último a las ${formatTime(g.remindedAt!, event.timezone)}.`}
                </p>
                {canManage && (
                  <GuestActions
                    guestId={g.id}
                    name={g.fullName}
                    arrived={Boolean(g.arrivedAt)}
                    whatsapp={whatsappLink(message, g.phone)}
                    mailto={g.email ? mailtoLink(g.email, `Recordatorio: ${event.name}`, message) : null}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && (
        <>
          <SectionTitle>Citar a alguien</SectionTitle>
          <Card>
            <GuestForm
              eventId={id}
              timezone={event.timezone}
              defaultDate={event.startsAt ? zonedDate(event.startsAt, event.timezone) : ""}
              roles={["Invitado", "Host", "Técnico externo", "Otro"]}
            />
          </Card>
        </>
      )}
    </>
  );
}
