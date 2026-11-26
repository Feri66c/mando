import type { Metadata } from "next";
import { notFound } from "next/navigation";
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
  const canRemove = event.level !== null && event.level <= 2;
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
        Confirma cada equipo con su modelo o medidas. Los obligatorios desbloquean el timeline; el resto se completa hasta 24 o 2 horas antes.
      </p>
      {items.length === 0 && <Empty>Todavía no hay lista técnica. Agrega el primer equipo abajo.</Empty>}

      {groups.map((g) => (
        <section key={g.clave}>
          <SectionTitle>{g.nombre}</SectionTitle>
          <ul aria-label={g.nombre} className="grid gap-2">
            {g.items.map((i) => {
              const deadline = techDeadline(event.startsAt, i.dueHours);
              const late = i.status === "pending" && deadline !== null && deadline.getTime() < now;
              const color = i.status === "confirmed" ? "text-[#8fe0b8]" : i.status === "not_applicable" ? "text-ink-muted" : late ? "text-[#ff6f86]" : "text-gold-300";
              return (
                <li key={i.id} className="rounded-card bg-surface-100 p-4">
                  <p className="font-medium leading-snug">
                    {i.title}
                    {i.quantity > 1 ? ` × ${i.quantity}` : ""}
                  </p>
                  {i.detail && <p className="text-sm text-ink-muted">{i.detail}</p>}
                  <p className={`mt-1 font-mono text-xs font-semibold uppercase tracking-wider ${color}`}>
                    {i.status === "confirmed" ? "✓ Confirmado" : i.status === "not_applicable" ? "No aplica" : i.mandatory ? "Obligatorio · por confirmar" : late ? "Plazo vencido" : "Por completar"}
                    {i.status === "pending" && !i.mandatory && deadline
                      ? ` · hasta ${i.dueHours} h antes (${formatDate(deadline.toISOString(), event.timezone)}, ${formatTime(deadline.toISOString(), event.timezone)})`
                      : ""}
                  </p>
                  {canEdit && <TechItemActions key={i.status} itemId={i.id} title={i.title} status={i.status} canRemove={canRemove || !i.mandatory} />}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {canEdit && (
        <>
          <SectionTitle>Agregar equipo</SectionTitle>
          <Card>
            <AddTechItemForm eventId={id} categories={TECH_CATEGORIES} />
          </Card>
        </>
      )}
    </>
  );
}
