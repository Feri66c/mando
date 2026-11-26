import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AddRequirementForm, RequirementPlanForm, RequirementStatusButton, RequirementUpload } from "@/components/operacion/expediente";
import { Card, PageTitle, SectionTitle } from "@/components/operacion/ui";
import { whatsappLink } from "@mando/core/guests";
import { REQUIREMENT_CATEGORIES, dueLabel, dueState, requirementReminder, type DueState } from "@mando/core/requirements";
import { formatDate, zonedDate } from "@mando/core/time";
import { getEventContext, getRequirements, getTeam } from "@/lib/data";

export const metadata: Metadata = { title: "Expediente" };

const DUE_COLOR: Record<DueState, string> = {
  done: "text-[#8fe0b8]",
  not_applicable: "text-ink-muted",
  overdue: "text-[#ff8f7a]",
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
  const { event } = ctx;
  const [requirements, team] = await Promise.all([getRequirements(id), getTeam(id)]);
  const canDecide = event.level !== null && event.level <= 2;
  const members = team.filter((m) => m.role !== "viewer").map((m) => ({ id: m.profileId, name: m.fullName }));
  const now = new Date();
  const applicable = requirements.filter((r) => r.status !== "not_applicable");
  const done = applicable.filter((r) => r.status === "done").length;
  const groups = REQUIREMENT_CATEGORIES.map((c) => ({ ...c, items: requirements.filter((r) => r.category === c.clave) })).filter((g) => g.items.length > 0);

  return (
    <>
      <PageTitle aside={<span className="font-mono text-sm text-ink-muted">{done} de {applicable.length} listos</span>}>Expediente</PageTitle>
      <p className="mb-2 mt-1 text-sm text-ink-muted">
        Todo lo que hay que subir para este evento. MANDO avisa cuando a un documento le quedan 2 días y cuando vence. El cliente no ve esta pantalla.
      </p>
      {applicable.length > 0 && (
        <div className="h-1.5 bg-surface-200" role="img" aria-label={`${done} de ${applicable.length} documentos listos`}>
          <div className="h-full bg-gold-300" style={{ width: `${Math.round((done / applicable.length) * 100)}%` }} />
        </div>
      )}

      {groups.map((g) => (
        <section key={g.clave}>
          <SectionTitle>{g.nombre}</SectionTitle>
          <ul aria-label={g.nombre} className="grid gap-2">
            {g.items.map((r) => {
              const due = dueState(r, now);
              const reminder = r.ownerName
                ? requirementReminder({ name: r.ownerName, title: r.title, eventName: event.name, due, mandatory: r.mandatory })
                : null;
              return (
                <li key={r.id} className="rounded-card bg-surface-100 p-4">
                  <div className="flex items-start gap-3">
                    <span aria-hidden="true" className={`mt-0.5 w-4 text-center font-mono text-lg leading-none ${DUE_COLOR[due.state]}`}>
                      {MARK[due.state]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-snug">{r.title}</p>
                      <p className={`mt-0.5 font-mono text-xs font-semibold uppercase tracking-wider ${DUE_COLOR[due.state]}`}>
                        {dueLabel(due)}
                        {r.status === "pending" && r.dueAt ? ` · plazo ${formatDate(r.dueAt, event.timezone)}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-ink-muted">
                        {r.mandatory ? "No negociable · " : ""}
                        {r.ownerName ? `A cargo de ${r.ownerName}` : "Sin responsable"}
                      </p>
                      {r.note && <p className="mt-1 text-sm text-ink-muted">{r.note}</p>}
                      {r.fileUrl && (
                        <a href={r.fileUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block break-all text-sm font-medium text-ice-300 underline underline-offset-4">
                          {r.fileName ?? "Ver documento"}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    {r.status !== "not_applicable" && <RequirementUpload eventId={id} requirementId={r.id} title={r.title} done={r.status === "done"} />}
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
