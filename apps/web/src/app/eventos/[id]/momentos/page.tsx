import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CreateMomentForm } from "@/components/operacion/forms";
import { Card, Empty, LevelChip, PageTitle, SectionTitle } from "@/components/operacion/ui";
import { MOMENT_STATUS_LABEL } from "@mando/core/labels";
import { MOMENT_TEMPLATES, templateForArea } from "@mando/core/templates";
import { getEventContext, getMoments, getRouteItems } from "@/lib/data";

export const metadata: Metadata = { title: "Momentos críticos" };

export default async function MomentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ actividad?: string }>;
}) {
  const { id } = await params;
  const { actividad } = await searchParams;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  if (!ctx.isTeam) redirect(`/eventos/${id}`); // internos del equipo
  const [moments, items] = await Promise.all([getMoments(id), getRouteItems(id)]);
  const selected = items.find((i) => i.id === actividad) ?? null;

  return (
    <>
      <PageTitle>Momentos críticos</PageTitle>
      <p className="mt-1 text-sm text-ink-muted">Qué no funciona, qué prometió el proveedor y qué se encontró. Interno del equipo.</p>
      <SectionTitle>En curso y programados</SectionTitle>
      {moments.length === 0 ? (
        <Empty>No hay momentos críticos.</Empty>
      ) : (
        <ul className="grid gap-2">
          {moments.map((m) => (
            <li key={m.id}>
              <Link href={`/eventos/${id}/momentos/${m.id}`} className="block min-h-14 rounded-card bg-surface-100 px-4 py-3 hover:bg-surface-200">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{m.title}</span>
                  {m.level > 1 && <LevelChip level={m.level} config={ctx.criticality} />}
                </span>
                <span className="block text-sm text-ink-muted">
                  {MOMENT_STATUS_LABEL[m.status]}
                  {m.routeItemTitle && ` · ${m.routeItemTitle}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <section id="nuevo" className="scroll-mt-24">
        <SectionTitle>Abrir un momento crítico</SectionTitle>
        <Card>
          <CreateMomentForm
            eventId={id}
            templates={MOMENT_TEMPLATES}
            items={items.map((i) => ({ id: i.id, title: i.title }))}
            defaultItemId={selected?.id ?? null}
            defaultTemplate={templateForArea(selected?.areaName)?.clave ?? null}
          />
        </Card>
      </section>
    </>
  );
}
