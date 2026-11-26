import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EvidenceGrid } from "@/components/operacion/blocks";
import { EvidenceUploader } from "@/components/operacion/evidence-uploader";
import { ChangeForm, MarkButtons } from "@/components/operacion/forms";
import { Card, LevelChip, SectionTitle, StatusChip, buttonGhost } from "@/components/operacion/ui";
import { MOMENT_STATUS_LABEL } from "@mando/core/labels";
import { formatShift, minutesLate } from "@mando/core/route";
import { templateForArea } from "@mando/core/templates";
import { formatTime } from "@mando/core/time";
import { getEventContext, getEvidences, getMoments, getRouteItem } from "@/lib/data";

export const metadata: Metadata = { title: "Actividad" };

function TimeRow({ label, start, end, timeZone }: { label: string; start: string | null; end: string | null; timeZone: string }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-mono">
        {start ? formatTime(start, timeZone) : "—"} – {end ? formatTime(end, timeZone) : "—"}
      </dd>
    </div>
  );
}

export default async function ItemPage({ params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  if (!ctx.isTeam) redirect(`/eventos/${id}/hoja-de-ruta`); // el cliente solo mira
  const item = await getRouteItem(id, itemId);
  if (!item) notFound();
  const { event, criticality } = ctx;
  const tz = event.timezone;
  const [evidences, moments] = await Promise.all([getEvidences(id, { routeItemId: itemId }), getMoments(id)]);
  const myMoments = moments.filter((m) => m.routeItemId === itemId);
  const closed = item.status === "done" || item.status === "cancelled";
  const template = templateForArea(item.areaName);
  const shift = minutesLate(item.plannedStart, item.currentStart, new Date());

  return (
    <>
      <Link href={`/eventos/${id}/hoja-de-ruta`} className="text-sm text-ink-muted hover:text-ink">
        ← Hoja de ruta
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold leading-tight">{item.title}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <StatusChip status={item.status} />
        {item.isMilestone && <span className="text-xs font-semibold uppercase tracking-wide text-gold-300">Hito</span>}
        {item.areaName && <span className="text-ink-muted">{item.areaName}</span>}
        {!item.visibleToViewer && <span className="text-[#ffb19e]">Oculto al cliente</span>}
      </div>

      <Card className="mt-4">
        <dl className="divide-y divide-line">
          <TimeRow label="Plan publicado" start={item.plannedStart} end={item.plannedEnd} timeZone={tz} />
          <TimeRow label="Plan vigente" start={item.currentStart} end={item.currentEnd} timeZone={tz} />
          <TimeRow label="Real" start={item.actualStart} end={item.actualEnd} timeZone={tz} />
          {shift !== 0 && (
            <div className="flex justify-between py-1.5 text-sm">
              <dt className="text-ink-muted">Diferencia con el plan</dt>
              <dd className="font-mono">{formatShift(shift)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3 py-1.5 text-sm">
            <dt className="text-ink-muted">Responsable</dt>
            <dd>{item.ownerName ?? <span className="text-[#ffb19e]">Sin responsable</span>}</dd>
          </div>
          {item.providerName && (
            <div className="flex justify-between gap-3 py-1.5 text-sm">
              <dt className="text-ink-muted">Proveedor</dt>
              <dd className="text-right">
                {item.providerName}
                {item.providerPhone && (
                  <a href={`tel:${item.providerPhone.replace(/\s/g, "")}`} className="block font-mono text-ice-300 underline">
                    Llamar {item.providerPhone}
                  </a>
                )}
              </dd>
            </div>
          )}
        </dl>
      </Card>

      {!closed && (
        <>
          <SectionTitle>Marcar</SectionTitle>
          <MarkButtons itemId={item.id} started={Boolean(item.actualStart)} />
        </>
      )}

      {!closed && (
        <section id="cambio" className="scroll-mt-24">
          <SectionTitle>Pedir un cambio</SectionTitle>
          <Card>
            <ChangeForm itemId={item.id} currentStart={item.currentStart} timeZone={tz} canMoveStart={!item.actualStart} />
          </Card>
        </section>
      )}

      <SectionTitle href={`/eventos/${id}/momentos?actividad=${item.id}#nuevo`} linkLabel="Abrir uno">
        Momentos críticos
      </SectionTitle>
      {myMoments.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Ninguno todavía.
          {template && ` Sugerido: ${template.nombre}.`}
        </p>
      ) : (
        <ul className="grid gap-2">
          {myMoments.map((m) => (
            <li key={m.id}>
              <Link href={`/eventos/${id}/momentos/${m.id}`} className="flex min-h-12 items-center justify-between gap-2 rounded-card bg-surface-100 px-4 py-3">
                <span className="font-medium">{m.title}</span>
                <span className="flex items-center gap-2 text-xs text-ink-muted">
                  {m.level > 1 && <LevelChip level={m.level} config={criticality} />}
                  {MOMENT_STATUS_LABEL[m.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>Evidencias</SectionTitle>
      <EvidenceGrid items={evidences} timeZone={tz} isTeam />
      <Card className="mt-3">
        <EvidenceUploader eventId={id} routeItemId={item.id} defaultVisible={item.visibleToViewer} />
      </Card>

      <div className="mt-6">
        <Link href={`/eventos/${id}/en-vivo`} className={`${buttonGhost} w-full`}>
          Ir a Modo En Vivo
        </Link>
      </div>
    </>
  );
}
