import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Logo } from "@/components/brand";
import { ClockRules, LiveClock, RealtimeRefresh } from "@/components/operacion/live";
import { BottomNav, PlusButton } from "@/components/operacion/nav";
import { ROLE_LABEL } from "@mando/core/labels";
import { zoneLabel } from "@mando/core/time";
import { getAlerts, getEventContext } from "@/lib/data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pantallas del evento: tema oscuro de operación, cabecera con el evento y su hora, barra inferior y «+». */
export default async function EventLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await getEventContext(id);
  if (!ctx) notFound(); // no es miembro: para la base de datos, el evento no existe
  const { user, event, isTeam } = ctx;
  if (!event.welcomedAt) redirect(`/bienvenida/${id}`); // primero la bienvenida: ahí toma el mando
  const openAlerts = (await getAlerts(id)).filter((a) => a.status === "open").length;
  const firstName = user.fullName.split(" ")[0];

  return (
    <div className="tema-operacion min-h-dvh pb-44">
      <header className="mx-auto max-w-2xl px-5 pb-2 pt-[max(1.1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between gap-3">
          <Link href="/eventos" className="flex min-h-11 items-center gap-3" aria-label="Volver a Mis eventos">
            <span aria-hidden className="text-lg text-ink-muted">←</span>
            <Logo className="h-7 w-auto" />
          </Link>
          <RealtimeRefresh eventId={id} />
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#a9bdd6]">
              Hola, {firstName} · {event.title ?? ROLE_LABEL[event.role]}
            </p>
            <p className="mt-1 truncate font-display text-[21px] font-bold leading-tight">{event.name}</p>
          </div>
          <div className="shrink-0 text-right">
            <LiveClock timeZone={event.timezone} className="text-[28px] font-semibold leading-none" />
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#a9bdd6]">hora de {zoneLabel(event.timezone)}</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-5 pt-3">{children}</main>
      <BottomNav eventId={id} openAlerts={openAlerts} />
      {isTeam && <PlusButton eventId={id} />}
      {isTeam && <ClockRules eventId={id} />}
    </div>
  );
}
