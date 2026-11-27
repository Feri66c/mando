import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCard, EvidenceGrid, LogList } from "@/components/operacion/blocks";
import { Pieza } from "@/components/operacion/pieza";
import { Semaforo } from "@/components/operacion/semaforo";
import { EventCountdown } from "@/components/operacion/plazo";
import { UltimoMinuto } from "@/components/operacion/ultimo-minuto";
import { MomentButtons } from "@/components/operacion/momento";
import { Empty, SectionTitle, StatusChip, buttonPrimary } from "@/components/operacion/ui";
import { PLANNING_ELEMENTS, planningProgress } from "@mando/core/planning";
import { nowAndNext } from "@mando/core/route";
import { formatDate, formatTime } from "@mando/core/time";
import { Express } from "./express";
import { getAlerts, getBrief, getClientNotices, getEventContext, getPlanning, getEvidences, getLog, getRouteItems, type RouteItem } from "@/lib/data";

export const metadata: Metadata = { title: "Hoy" };

/** «No negociable sin documento: Permiso municipal» → primero el nombre; el motivo va al pie. */
function flagParts(title: string): { name: string; reason: string | null } {
  const at = title.indexOf(": ");
  if (at < 0) return { name: title, reason: null };
  const reason = title.slice(0, at).replace(/^No negociable\b\s*/i, "No negociable · ").replace(/ · $/, "");
  return { name: title.slice(at + 2), reason };
}

function Slot({ item, timeZone }: { item: RouteItem | null; timeZone: string }) {
  if (!item) return <p className="mt-1 text-ink-muted">Nada por ahora.</p>;
  return (
    <>
      <p className="mt-1.5 font-display text-[26px] font-bold leading-[1.05]">{item.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-[17px] font-medium">
          {formatTime(item.currentStart, timeZone)} – {formatTime(item.currentEnd, timeZone)}
        </span>
        <StatusChip status={item.status} />
      </div>
    </>
  );
}

export default async function TodayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  const { event, criticality, isTeam } = ctx;
  if (!isTeam) {
    // El cliente no ve la operación: solo MANDO Express.
    const [plan, notices] = await Promise.all([getPlanning(id), getClientNotices(id)]);
    const approvals = plan.elements.find((e) => e.key === "aprobaciones");
    return (
      <Express
        eventId={id}
        status={event.status}
        startsAt={event.startsAt}
        endsAt={event.endsAt}
        timeZone={event.timezone}
        elements={plan.elements}
        approvalsPending={Boolean(approvals && !approvals.ready)}
        notices={notices}
      />
    );
  }
  const [items, alerts, log, evidences, planning, brief] = await Promise.all([
    getRouteItems(id),
    getAlerts(id),
    getLog(id, isTeam ? 6 : 12),
    isTeam ? Promise.resolve([]) : getEvidences(id),
    getPlanning(id),
    getBrief(id, ctx.user.id),
  ]);
  // Eventos con candado: los 5 elementos. Eventos anteriores: solo las aprobaciones del cliente.
  const pendingElements = PLANNING_ELEMENTS.filter((e) => (planning.gate || e.clave === "aprobaciones") && !planning.elements.find((s) => s.key === e.clave)?.ready);
  const progress = planningProgress(planning.elements);
  const { current, next } = nowAndNext(items, new Date());
  const base = `/eventos/${id}`;
  const active = alerts.filter((a) => a.status !== "resolved");
  const stages = items.filter((i) => i.status !== "cancelled").slice(0, 14);
  const doneCount = stages.filter((i) => i.status === "done").length;
  const quick = [
    { label: "Evidencia", href: `${base}/evidencias#evidencia`, icon: <><path d="M3 7 H7.5 L9.5 4.5 H14.5 L16.5 7 H21 V19 H3 Z" /><path d="M12 9.5 L15 13 L12 16.5 L9 13 Z" /></> },
    { label: "Cambio", href: current ? `${base}/actividad/${current.id}#cambio` : `${base}/hoja-de-ruta`, icon: <><path d="M4 8 H19" /><path d="M15.5 4 L19.5 8 L15.5 12" /><path d="M20 16 H5" /><path d="M8.5 12 L4.5 16 L8.5 20" /></> },
    { label: "Alerta", href: `${base}/alertas#reportar`, icon: <><path d="M8 2.5 H16 L21.5 8 V16 L16 21.5 H8 L2.5 16 V8 Z" /><path d="M12 7 V13" /><path d="M12 16.5 V17" /></> },
    { label: "Momento crítico", href: `${base}/momentos#nuevo`, icon: <><path d="M12 2.5 L21.5 12 L12 21.5 L2.5 12 Z" /><path d="M12 8 V12.5 H15.5" /></> },
  ];

  // Con la planificación incompleta, lo primero es la planificación; el timeline baja al final (decisión 71).
  const planningFirst = planning.gate && pendingElements.length > 0 && event.status !== "closed";
  const timelineBlock = (
    <>
      <section aria-label="Avance del evento">
        <p className="font-display text-xl font-bold uppercase tracking-[0.06em] text-ice-300">
          {stages.length > 0 ? (
            <>
              Etapa <span className="luz-blanca font-mono text-2xl">{Math.min(doneCount + 1, stages.length)}</span> de {stages.length}
            </>
          ) : (
            "Sin hoja de ruta"
          )}
        </p>
        {stages.length > 0 && (
          <div aria-hidden className="mt-2.5 flex gap-[3px]">
            {stages.map((i) => (
              <span key={i.id} className="tramo" data-estado={i.status === "done" ? "hecho" : current?.id === i.id ? "ahora" : "falta"} />
            ))}
          </div>
        )}
      </section>

      <div className="mt-4 flex flex-col">
        <div className="encastre-marco">
          <div className="encastre-pieza">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-gold-300">Ahora</p>
            <Slot item={current} timeZone={event.timezone} />
            {isTeam && (
              <Link href={`${base}/en-vivo`} className={`${buttonPrimary} mt-4 w-full`}>
                Abrir Modo En Vivo
              </Link>
            )}
          </div>
        </div>
        <div className="encastre-recibe">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ice-300">Sigue</p>
          <Slot item={next} timeZone={event.timezone} />
        </div>
      </div>

      {isTeam && (
        <>
          <SectionTitle>En el evento</SectionTitle>
          <div className="grid grid-cols-4 gap-1.5">
            {quick.map((q) => (
              <Link key={q.label} href={q.href} className="flex min-h-[78px] flex-col items-center justify-center gap-1.5 text-center text-[12.5px] font-medium leading-tight">
                <span aria-hidden className="hexagono flex h-[50px] w-[58px] items-center justify-center bg-surface-200">
                  <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square" strokeLinejoin="miter">
                    {q.icon}
                  </svg>
                </span>
                {q.label}
              </Link>
            ))}
          </div>
        </>
      )}

      {isTeam && event.status !== "closed" && (
        <>
          <SectionTitle>Efecto wow y eventualidades</SectionTitle>
          <MomentButtons eventId={id} />
        </>
      )}

    </>
  );
  // Red flag = nivel 4 o más; ámbar = niveles 2 y 3: «verifica, te queda poco tiempo».
  const redFlags = active.filter((a) => a.level >= 4);
  const amber = active.filter((a) => a.level >= 2 && a.level < 4);
  const rest = active.filter((a) => a.level < 2);
  // Puntos del brief: la sinopsis (o el resumen) partida en frases cortas. Con la IA conectada, aquí irá su lectura.
  const briefPoints = (brief?.synopsis || brief?.summary || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 4);

  return (
    <>
      <h1 className="sr-only">Hoy</h1>
      {redFlags.length > 0 && (
        <section aria-label="Red flags" className="red-flag mb-6">
          <div className="red-flag-titulo">
            <span aria-hidden className="bandera" />
            <h2>
              Red flag{redFlags.length > 1 ? "s" : ""} <span className="font-mono">· {redFlags.length}</span>
            </h2>
            <span aria-hidden className="bandera" />
          </div>
          <ul className="mt-3 grid gap-2">
            {redFlags.slice(0, 4).map((a) => (
              <li key={a.id}>
                <Link href={`${base}/alertas`} className="red-flag-item">
                  <span aria-hidden className="bandera bandera-chica" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-xl font-bold leading-snug">{flagParts(a.title).name}</span>
                    {flagParts(a.title).reason && <span className="red-flag-pie">{flagParts(a.title).reason}</span>}
                    {a.detail && <span className="mt-1 block text-sm opacity-80">{a.detail}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {redFlags.length > 4 && (
            <Link href={`${base}/alertas`} className="mt-2 block text-sm font-semibold underline underline-offset-4">
              Ver las {redFlags.length} red flags
            </Link>
          )}
        </section>
      )}

      {planningFirst && (
        <section aria-label="Planificación" className="mb-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-2xl font-bold">Planificación</h2>
            <span className="luz-blanca font-mono text-xl font-semibold">
              {progress.ready} de {progress.total}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-muted">Lo primero. Entra a cualquiera de las piezas, en el orden que quieras.</p>
          <div className="mt-3">
            <Semaforo elements={planning.elements} />
          </div>
          <ol className="mt-4 grid gap-2.5">
            {PLANNING_ELEMENTS.map((e, i) => {
              const s = planning.elements.find((x) => x.key === e.clave);
              const done = Boolean(s?.ready);
              const open = e.clave !== "presupuesto" || (event.level !== null && event.level <= 2);
              return (
                <li key={e.clave}>
                  <Pieza href={open ? `${base}/${e.ruta}` : undefined} label={`${e.nombre}: ${done ? "completo" : "pendiente"}`} done={done}>
                    <div className="flex items-center gap-3.5">
                      <span aria-hidden className="pieza-numero">
                        {done ? "✓" : i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-xl font-semibold leading-snug">{e.nombre}</p>
                        <p className={`mt-0.5 font-mono text-[13px] font-semibold uppercase tracking-wider ${done ? "text-ok" : "text-gold-300"}`}>
                          {done ? "Completo" : (s?.missing ?? []).join(" · ") || "Pendiente"}
                        </p>
                      </div>
                      {open && <span aria-hidden className="text-2xl text-ink-muted">›</span>}
                    </div>
                  </Pieza>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {!planningFirst && timelineBlock}

      {pendingElements.length > 0 && !planningFirst && event.status !== "closed" && (
        <Link href={`${base}/${planning.gate ? "planificacion" : "aprobaciones"}`} className="mt-3 block rounded-card border border-gold-300/50 bg-surface-100 px-4 py-3 text-sm">
          <span className="block font-semibold text-gold-300">
            {planning.gate
              ? `Planificación: ${progress.ready} de ${progress.total}. El timeline sigue bloqueado`
              : isTeam
                ? "Falta la aprobación del cliente para empezar"
                : "Tienes elementos por aprobar"}
          </span>
          <span className="block text-ink-muted">
            {pendingElements
              .map((e) => (planning.gate ? `${e.nombre}: ` : "") + (planning.elements.find((s) => s.key === e.clave)?.missing ?? []).join(", "))
              .join(" · ")}
          </span>
        </Link>
      )}

      {isTeam && event.status !== "closed" && (
        <div className="mt-5">
          <UltimoMinuto eventId={id} />
        </div>
      )}

      {amber.length > 0 && (
        <section aria-label="Verifica" className="ambar mt-4">
          <div className="ambar-titulo">
            <h2>Verifica · te queda poco tiempo</h2>
            <span className="font-mono">{amber.length}</span>
          </div>
          <ul className="mt-2 grid gap-1.5">
            {amber.slice(0, 3).map((a) => (
              <li key={a.id}>
                <Link href={`${base}/alertas`} className="ambar-item">
                  <span className="font-semibold">{a.title}</span>
                  {a.detail && <span className="block text-sm text-ink-muted">{a.detail}</span>}
                </Link>
              </li>
            ))}
          </ul>
          {amber.length > 3 && (
            <Link href={`${base}/alertas`} className="mt-2 block text-sm font-semibold text-gold-300 underline underline-offset-4">
              Ver las {amber.length}
            </Link>
          )}
        </section>
      )}

      {event.startsAt && event.status !== "closed" && (
        <EventCountdown startsAt={event.startsAt} label={`El evento empieza el ${formatDate(event.startsAt, event.timezone)} a las ${formatTime(event.startsAt, event.timezone)}.`} />
      )}

      {brief && (brief.synopsis || brief.summary) && (
        <section aria-label="Brief" className="mt-6">
          <SectionTitle href={`/bienvenida/${id}`} linkLabel="Ver el brief">
            Puntos del brief
          </SectionTitle>
          <div className="brief-puntos">
            <ul>
              {briefPoints.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {rest.length > 0 || active.length === 0 ? (
        <>
          <SectionTitle href={`${base}/alertas`} linkLabel="Ver alertas">
            {active.length === 0 ? "Alertas" : "Otras alertas"}
          </SectionTitle>
          {active.length === 0 ? (
            <Empty>Sin alertas activas.</Empty>
          ) : (
            <ul className="grid gap-2">
              {rest.slice(0, 3).map((a) => (
                <AlertCard key={a.id} alert={a} config={criticality} timeZone={event.timezone} />
              ))}
            </ul>
          )}
        </>
      ) : null}

      <SectionTitle href={`${base}/bitacora`} linkLabel="Bitácora completa">
        {isTeam ? "Bitácora" : "Minuto a minuto"}
      </SectionTitle>
      <LogList entries={log} timeZone={event.timezone} config={criticality} />

      {planningFirst && (
        <>
          <SectionTitle>Timeline · se abre con la planificación completa</SectionTitle>
          <div className="pointer-events-none opacity-60" aria-disabled="true">{timelineBlock}</div>
        </>
      )}

      {!isTeam && evidences.length > 0 && (
        <>
          <SectionTitle href={`${base}/evidencias`}>Evidencias</SectionTitle>
          <EvidenceGrid items={evidences.slice(0, 4)} timeZone={event.timezone} isTeam={false} />
        </>
      )}
    </>
  );
}
