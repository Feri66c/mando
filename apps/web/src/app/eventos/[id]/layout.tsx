import { notFound, redirect } from "next/navigation";
import { ClockRules, LiveClock, RealtimeRefresh } from "@/components/operacion/live";
import { EventBack, Mesa, TapSounds, type MesaPiece } from "@/components/operacion/mesa";
import { BottomNav, PlusButton } from "@/components/operacion/nav";
import { ROLE_LABEL } from "@mando/core/labels";
import { formatEventRange, zoneLabel } from "@mando/core/time";
import { modalityBadge } from "@mando/core/command";
import { PLANNING_ELEMENTS } from "@mando/core/planning";
import { getAlerts, getBrands, getEventContext, getMyLook, getPlanning, getRouteItems } from "@/lib/data";
import { Cara } from "@/components/perfil/cara";
import { ModoSync } from "@/components/perfil/modo-sync";
import { ModoAvatar } from "@/components/perfil/modo-avatar";
import { formatTime } from "@mando/core/time";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pantallas del evento: tema oscuro de operación, cabecera con el evento y su hora, barra inferior y «+». */
export default async function EventLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await getEventContext(id);
  if (!ctx) notFound(); // no es miembro: para la base de datos, el evento no existe
  const { user, event, isTeam } = ctx;
  if (!event.welcomedAt) redirect(`/bienvenida/${id}`); // primero la bienvenida: ahí toma el mando
  const [alerts, brands, planning, look, items] = await Promise.all([
    getAlerts(id),
    getBrands(id),
    getPlanning(id),
    getMyLook(user.id),
    isTeam ? getRouteItems(id).catch(() => []) : Promise.resolve([]),
  ]);
  // La mesa: las cinco piezas a la mano. El presupuesto solo lo abren los niveles 1 y 2 y el cliente.
  const canSeeBudget = !isTeam || (event.level !== null && event.level <= 2);
  const pieces: MesaPiece[] = PLANNING_ELEMENTS.map((e) => ({
    key: e.clave,
    name: e.nombre,
    route: e.ruta,
    done: Boolean(planning.elements.find((s) => s.key === e.clave)?.ready),
    open: isTeam ? e.clave !== "presupuesto" || canSeeBudget : e.clave === "presupuesto" || e.clave === "aprobaciones",
  }));
  const open = alerts.filter((a) => a.status === "open");
  const openAlerts = open.length;
  // Lo que viene, para el modo avatar: lo que está en curso o la próxima actividad pendiente.
  const nowIso = new Date().toISOString();
  const nextItem =
    items.find((i) => i.status === "in_progress") ??
    items.filter((i) => i.status !== "done" && i.status !== "cancelled" && i.currentEnd >= nowIso).sort((a, b) => a.currentStart.localeCompare(b.currentStart))[0] ??
    null;
  const badge = modalityBadge(event.modality, event.agencyName);
  const firstName = user.fullName.split(" ")[0];
  const when = formatEventRange(event.startsAt, event.endsAt, event.timezone).split(" · ");

  return (
    <div className="tema-operacion min-h-dvh pb-44">
      <header className="mx-auto max-w-2xl px-5 pb-2 pt-[max(1.1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between gap-3">
          <EventBack eventId={id} />
          <RealtimeRefresh eventId={id} />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <a href="/perfil" aria-label="Mi perfil" className="shrink-0">
            <Cara url={look.faceUrl} name={user.fullName} size={52} />
          </a>
          <p className="min-w-0 font-mono text-[13px] uppercase tracking-[0.08em] text-ice-300">
            Hola, {firstName} · {event.title ?? ROLE_LABEL[event.role]}
          </p>
        </div>
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
      <div className="mx-auto max-w-2xl px-5">
        <Mesa eventId={id} pieces={pieces} />
      </div>
      <main className="mx-auto max-w-2xl px-5 pt-3">{children}</main>
      <TapSounds />
      <ModoSync mode={look.mode} />
      {isTeam && (
        <ModoAvatar
          face={look.faceUrl}
          name={user.fullName}
          eventName={event.name}
          timeZone={event.timezone}
          next={nextItem ? { title: nextItem.title, time: formatTime(nextItem.currentStart, event.timezone) } : null}
          openAlerts={openAlerts}
          alertKey={open.map((a) => a.id).sort().join(",")}
        />
      )}
      <BottomNav eventId={id} openAlerts={isTeam ? openAlerts : 0} client={!isTeam} />
      {isTeam && <PlusButton eventId={id} />}
      {isTeam && <ClockRules eventId={id} />}
    </div>
  );
}
