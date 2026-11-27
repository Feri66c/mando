import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Logo } from "@/components/brand";
import { ClockRules, LiveClock, RealtimeRefresh } from "@/components/operacion/live";
import { BottomNav, PlusButton } from "@/components/operacion/nav";
import { ROLE_LABEL } from "@mando/core/labels";
import { formatEventRange, zoneLabel } from "@mando/core/time";
import { modalityBadge } from "@mando/core/command";
import { getAlerts, getBrands, getEventContext } from "@/lib/data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pantallas del evento: tema oscuro de operación, cabecera con el evento y su hora, barra inferior y «+». */
export default async function EventLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await getEventContext(id);
  if (!ctx) notFound(); // no es miembro: para la base de datos, el evento no existe
  const { user, event, isTeam } = ctx;
  if (!event.welcomedAt) redirect(`/bienvenida/${id}`); // primero la bienvenida: ahí toma el mando
  const [alerts, brands] = await Promise.all([getAlerts(id), getBrands(id)]);
  const openAlerts = alerts.filter((a) => a.status === "open").length;
  const badge = modalityBadge(event.modality, event.agencyName);
  const firstName = user.fullName.split(" ")[0];
  const when = formatEventRange(event.startsAt, event.endsAt, event.timezone).split(" · ");

  return (
    <div className="tema-operacion min-h-dvh pb-44">
      <header className="mx-auto max-w-2xl px-5 pb-2 pt-[max(1.1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between gap-3">
          <Link href="/eventos" className="flex min-h-11 items-center gap-3" aria-label="Volver a Mis eventos">
            <span aria-hidden className="text-lg text-ink-muted">←</span>
            <Logo className="h-10 w-auto" />
          </Link>
          <RealtimeRefresh eventId={id} />
        </div>
        <p className="mt-3 font-mono text-[13px] uppercase tracking-[0.08em] text-[#a9bdd6]">
          Hola, {firstName} · {event.title ?? ROLE_LABEL[event.role]}
        </p>
        <p className="mt-1 font-display text-[26px] font-bold leading-tight">{event.name}</p>
        {badge && (
          <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-gold-300/60 px-2.5 py-0.5 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-gold-300">
            <span aria-hidden className="size-1.5 rotate-45 bg-gold-300" />
            {badge}
          </p>
        )}
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <LiveClock timeZone={event.timezone} className="reloj-evento block" />
            <p className="luz-naranja mt-1.5 font-mono text-sm font-semibold uppercase tracking-[0.14em]">Hora de {zoneLabel(event.timezone)}</p>
          </div>
          <div className="min-w-0 text-right">
            <p className="luz-blanca font-display text-xl font-bold capitalize leading-tight">{when[0]}</p>
            {when[1] && <p className="luz-naranja mt-0.5 font-mono text-base font-semibold">{when[1]}</p>}
          </div>
        </div>
        {brands.length > 0 && (
          <ul aria-label="Marcas del evento" className="mt-3 flex flex-wrap items-center gap-2">
            {brands.map((b) => (
              <li key={b.id} title={b.name}>
                {b.logoUrl ? (
                  // Logo subido por el backend al cubo privado; el enlace firmado cambia cada hora.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.logoUrl} alt={b.name} className="h-8 w-auto max-w-[120px] rounded-md bg-white object-contain px-2 py-1" />
                ) : (
                  <span className="inline-flex h-8 items-center rounded-md border border-line px-2.5 text-xs font-semibold">{b.name}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </header>
      <main className="mx-auto max-w-2xl px-5 pt-3">{children}</main>
      <BottomNav eventId={id} openAlerts={isTeam ? openAlerts : 0} client={!isTeam} />
      {isTeam && <PlusButton eventId={id} />}
      {isTeam && <ClockRules eventId={id} />}
    </div>
  );
}
