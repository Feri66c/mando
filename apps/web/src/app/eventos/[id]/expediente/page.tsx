import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AddRequirementForm, RequirementPlanForm, RequirementStatusButton, RequirementUpload } from "@/components/operacion/expediente";
import { DeadlineClock, DeadlineReminder } from "@/components/operacion/plazo";
import { Card, PageTitle, SectionTitle } from "@/components/operacion/ui";
import { whatsappLink } from "@mando/core/guests";
import { REQUIREMENT_CATEGORIES, dueLabel, dueState, requirementCap, requirementReminder, type DueState } from "@mando/core/requirements";
import { formatDate, formatTime, zonedDate } from "@mando/core/time";
import { getEventContext, getRequirements, getTeam } from "@/lib/data";

export const metadata: Metadata = { title: "Expediente" };

const DUE_COLOR: Record<DueState, string> = {
  done: "text-ok",
  not_applicable: "text-ink-muted",
  overdue: "text-critical",
  soon: "text-gold-300",
  on_track: "text-ink-muted",
  no_date: "text-ink-muted",
};
const MARK: Record<DueState, string> = { done: "✓", not_applicable: "–", overdue: "!", soon: "◆", on_track: "○", no_date: "○" };

/** Documentos que el evento necesita, por grupo, con plazo y responsable. Solo el equipo. */
export default async function RequirementsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx || !ctx.isTeam) notFound();
  const { event, user } = ctx;
  const [requirements, team] = await Promise.all([getRequirements(id), getTeam(id)]);
  const canDecide = event.level !== null && event.level <= 2;
  const members = team.filter((m) => m.role !== "viewer").map((m) => ({ id: m.profileId, name: m.fullName }));
  const now = new Date();
  const applicable = requirements.filter((r) => r.status !== "not_applicable");
  const done = applicable.filter((r) => r.status === "done").length;
  const isBackend = event.role === "backend";
  const cap = requirementCap(event.startsAt);
  const capLabel = cap ? `${formatDate(cap, event.timezone)}, ${formatTime(cap, event.timezone)}` : "";
  const capDate = cap ? zonedDate(cap, event.timezone) : undefined;
  const pendingCount = applicable.length - done;
  const mandatoryPending = applicable.filter((r) => r.mandatory && r.status !== "done").length;
  const LEDS = Math.max(applicable.length, 1);
  const groups = REQUIREMENT_CATEGORIES.map((c) => ({ ...c, items: requirements.filter((r) => r.category === c.clave) })).filter((g) => g.items.length > 0);

  return (
    <>
      <PageTitle aside={<span className="luz-blanca font-mono text-xl font-semibold">{done} de {applicable.length}</span>}>Expediente</PageTitle>
      <div className="fortaleza mt-3">
        <p className="fortaleza-lema">Tienes el mando.</p>
        <p className="mt-1 text-[15px] leading-snug">
          No importa qué documento llega primero, pero <strong>todos deben quedar visados</strong>. El cliente no ve esta pantalla.
        </p>
        {cap && <DeadlineClock capIso={cap} capLabel={capLabel} pending={pendingCount} />}
        {applicable.length > 0 && (
          <>
            <div className="leds mt-4" role="img" aria-label={`${done} de ${applicable.length} documentos listos`}>
              {Array.from({ length: LEDS }, (_, i) => (
                <i key={i} style={{ "--tono": "var(--ok)" } as React.CSSProperties} data-on={i < done ? "" : undefined} data-sigue={i === done ? "" : undefined} />
              ))}
            </div>
            <p className="mt-2 font-mono text-[13px] font-semibold uppercase tracking-wider text-ink-muted">
              {done} visados · {pendingCount} por subir{mandatoryPending > 0 ? ` · ${mandatoryPending} no negociables` : ""}
            </p>
          </>
        )}
        <p className="fortaleza-jurada">
          <strong>Declaración jurada.</strong> Quien sube un documento responde por él: declara que es verdadero, que tiene validez legal y que lo verificó. Es la responsabilidad de un gran productor.
        </p>
      </div>
      {cap && <DeadlineReminder eventId={id} capIso={cap} capLabel={capLabel} pending={pendingCount} mandatoryPending={mandatoryPending} />}

      {groups.map((g) => (
        <section key={g.clave} className="categoria" data-categoria={g.clave}>
          <div className="categoria-titulo">
            <h2>{g.nombre}</h2>
            <span>
              {g.items.filter((r) => r.status === "done").length} de {g.items.filter((r) => r.status !== "not_applicable").length}
            </span>
          </div>
          <ul aria-label={g.nombre} className="grid gap-2">
            {g.items.map((r) => {
              const due = dueState(r, now);
              const mine = !r.ownerId || r.ownerId === user.id;
              const postEvent = Boolean(r.dueAt && event.startsAt && new Date(r.dueAt) > new Date(event.startsAt));
              const reminder = r.ownerName
                ? requirementReminder({ name: r.ownerName, title: r.title, eventName: event.name, due, mandatory: r.mandatory })
                : null;
              return (
                <li key={r.id} className="rounded-card bg-surface-100 p-4" data-estado={due.state}>
                  <div className="flex items-start gap-3">
                    <span aria-hidden="true" className={`mt-0.5 w-5 text-center font-mono text-2xl font-bold leading-none ${DUE_COLOR[due.state]}`}>
                      {MARK[due.state]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-lg font-semibold leading-snug">{r.title}</p>
                      <p className={`mt-1 font-mono text-[13px] font-semibold uppercase tracking-wider ${DUE_COLOR[due.state]}`}>
                        {dueLabel(due)}
                        {r.status === "pending" && r.dueAt ? ` · plazo ${formatDate(r.dueAt, event.timezone)}` : ""}
                      </p>
                      <p className="mt-1.5 text-sm text-ink-muted">
                        {r.mandatory && <span className="mr-2 font-semibold text-naranja">No negociable</span>}
                        {r.ownerName ? (
                          <>
                            Responsable: <strong className="text-ink">{r.ownerName}</strong>
                          </>
                        ) : (
                          "Responsable: quien lo suba"
                        )}
                      </p>
                      {r.status === "done" && r.swornAt && (
                        <p className="mt-1 font-mono text-xs font-semibold uppercase tracking-wider text-ok">
                          ◆ Visado por {r.doneByName ?? "el equipo"} · {formatDate(r.swornAt, event.timezone)} · bajo declaración jurada
                        </p>
                      )}
                      {r.note && <p className="mt-1 text-sm text-ink-muted">{r.note}</p>}
                      {r.fileUrl && (
                        <a href={r.fileUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block break-all text-sm font-medium text-ice-300 underline underline-offset-4">
                          {r.fileName ?? "Ver documento"}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    {r.status !== "not_applicable" &&
                      (mine ? (
                        <RequirementUpload eventId={id} requirementId={r.id} title={r.title} done={r.status === "done"} />
                      ) : (
                        <p className="w-full border border-line px-3 py-2 text-sm text-ink-muted">
                          Solo <strong className="text-ink">{r.ownerName}</strong> sube este documento. Si no le corresponde, el backend cambia al responsable.
                        </p>
                      ))}
                    {canDecide && r.status !== "done" && <RequirementStatusButton key={r.status} requirementId={r.id} title={r.title} status={r.status} mandatory={r.mandatory} />}
                    {canDecide && r.status === "pending" && reminder && (
                      <a
                        href={whatsappLink(reminder)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Recordar por WhatsApp: ${r.title}`}
                        className="inline-flex min-h-11 items-center justify-center rounded-full bg-surface-200 px-4 text-sm font-semibold text-ink"
                      >
                        Recordar por WhatsApp
                      </a>
                    )}
                  </div>
                  {canDecide && r.status === "pending" && (
                    <RequirementPlanForm
                      requirementId={r.id}
                      title={r.title}
                      timezone={event.timezone}
                      ownerId={r.ownerId}
                      dueDate={r.dueAt ? zonedDate(r.dueAt, event.timezone) : ""}
                      team={members}
                      ownerLocked={Boolean(r.ownerId) && !isBackend}
                      maxDate={postEvent ? undefined : capDate}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {canDecide && (
        <>
          <SectionTitle>Agregar otro documento</SectionTitle>
          <Card>
            <AddRequirementForm eventId={id} timezone={event.timezone} categories={REQUIREMENT_CATEGORIES} />
          </Card>
        </>
      )}
    </>
  );
}
