import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TechDocUpload, TechNaButton, TechNaReview } from "@/components/operacion/ajustes";
import { AddTechItemForm, TechItemActions } from "@/components/operacion/planificacion";
import { Card, Empty, PageTitle, SectionTitle } from "@/components/operacion/ui";
import { TECH_CATEGORIES, techDeadline } from "@mando/core/planning";
import { formatDate, formatTime } from "@mando/core/time";
import { getEventContext, getTechItems } from "@/lib/data";

export const metadata: Metadata = { title: "Técnico" };

/** La capacidad técnica del evento y su checklist: obligatorios, y lo que se completa hasta 24 o 2 horas antes. */
export default async function TechPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx || !ctx.isTeam) notFound();
  const { event } = ctx;
  const items = (await getTechItems(id)).filter((i) => i.status !== "not_applicable" || event.level !== null);
  const canEdit = event.level !== null && event.level <= 3 && event.status !== "closed";
  const isBackend = event.role === "backend";
  const live = items.filter((i) => i.status !== "not_applicable");
  const must = live.filter((i) => i.mandatory);
  const now = new Date().getTime();
  const groups = TECH_CATEGORIES.map((c) => ({ ...c, items: items.filter((i) => i.category === c.clave) })).filter((g) => g.items.length > 0);

  return (
    <>
      <PageTitle aside={<span className="font-mono text-sm text-ink-muted">{must.filter((i) => i.status === "confirmed").length} de {must.length} obligatorios</span>}>
        Técnico
      </PageTitle>
      <p className="mb-2 mt-1 text-sm text-ink-muted">
        Adjunta el presupuesto o el documento de cada concepto, en Excel, PDF o foto. Lo que no va en este evento se marca «No aplica» y el backend lo revisa. Los obligatorios desbloquean el timeline.
      </p>
      {items.length === 0 && <Empty>Todavía no hay lista técnica. Agrega el primer equipo abajo.</Empty>}

      {groups.map((g) => (
        <section key={g.clave}>
          <SectionTitle>{g.nombre}</SectionTitle>
          <ul aria-label={g.nombre} className="grid gap-2">
            {g.items.map((i) => {
              const deadline = techDeadline(event.startsAt, i.dueHours);
              const late = i.status === "pending" && deadline !== null && deadline.getTime() < now;
              const color = i.status === "confirmed" ? "text-ok" : i.status === "not_applicable" ? "text-ink-muted" : i.naRejected || late ? "text-[#ff6f86]" : "text-gold-300";
              return (
                <li key={i.id} className="rounded-card bg-surface-100 p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className={`font-mono text-xs font-semibold uppercase tracking-[0.12em] ${i.mandatory ? "text-gold-300" : "text-ink-muted"}`}>
                        {i.mandatory ? "Mandatorio" : i.dueHours ? `Hasta ${i.dueHours} h antes` : "Por completar"}
                      </p>
                      <p className="text-lg font-semibold leading-snug">
                        {i.title}
                        {i.quantity > 1 ? ` × ${i.quantity}` : ""}
                      </p>
                      {i.detail && <p className="text-sm text-ink-muted">{i.detail}</p>}
                      <p className={`mt-1 break-words font-mono text-xs font-semibold uppercase tracking-wider ${color}`}>
                        {i.status === "confirmed"
                          ? i.docName ? `✓ Adjunto · ${i.docName}` : "✓ Confirmado"
                          : i.status === "not_applicable"
                            ? "No aplica · aceptado"
                            : i.naRequested
                              ? "No aplica · en revisión del backend"
                              : i.naRejected
                                ? "Rechazado · sí aplica"
                                : late ? "Plazo vencido" : "Falta su documento"}
                        {i.status === "pending" && !i.mandatory && !i.naRequested && deadline
                          ? ` · hasta ${formatDate(deadline.toISOString(), event.timezone)}, ${formatTime(deadline.toISOString(), event.timezone)}`
                          : ""}
                      </p>
                    </div>
                    {canEdit && i.status !== "not_applicable" && (
                      <div className="flex w-32 shrink-0 flex-col gap-2">
                        <TechDocUpload eventId={id} itemId={i.id} title={i.title} docName={i.docName} />
                        {i.status === "pending" && <TechNaButton key={String(i.naRequested)} itemId={i.id} title={i.title} requested={i.naRequested} />}
                      </div>
                    )}
                  </div>
                  {isBackend && i.naRequested && event.status !== "closed" && <TechNaReview itemId={i.id} title={i.title} />}
                  {canEdit && i.status !== "pending" && !i.docName && <TechItemActions key={i.status} itemId={i.id} title={i.title} status={i.status} canRemove={false} />}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {canEdit && (
        <>
          <SectionTitle>Sumar a técnica</SectionTitle>
          <p className="mb-2 text-sm text-ink-muted">Todo lo que responda a técnica: vallas separadoras, botellas de agua, cables adicionales, transporte adicional.</p>
          <Card>
            <AddTechItemForm eventId={id} categories={TECH_CATEGORIES} />
          </Card>
        </>
      )}
    </>
  );
}
