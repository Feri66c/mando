import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CloseEventForm, CriterionButtons, PrintButton, PublishUrlForm, RatingForm } from "@/components/operacion/cierre";
import { CriteriaBars, ScoreCard } from "@/components/operacion/merits";
import { Card, Empty, PageTitle, SectionTitle } from "@/components/operacion/ui";
import { MERIT_CONFIG } from "@mando/core/merits";
import { formatDate, formatTime } from "@mando/core/time";
import { getClosing, getCriteria, getEventContext, getEventScore, getMyRating, type Criterion } from "@/lib/data";

export const metadata: Metadata = { title: "Estrellas y cierre" };

const STATUS_WORD: Record<Criterion["kind"], Record<Criterion["status"], string>> = {
  no_negociable: { pending: "Por marcar", ok: "Cumplido", failed: "Falló" },
  hito_estrella: { pending: "Por marcar", ok: "Logrado", failed: "No logrado" },
};
const STATUS_MARK: Record<Criterion["status"], string> = { pending: "○", ok: "✓", failed: "✕" };

function CriterionList({ items, canMark, label }: { items: Criterion[]; canMark: boolean; label: string }) {
  if (items.length === 0) return <Empty>Este evento no tiene ninguno definido.</Empty>;
  return (
    <ul aria-label={label} className="grid gap-2">
      {items.map((c) => (
        <li key={c.id} className="rounded-card bg-surface-100 p-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={`mt-0.5 font-mono text-lg leading-none ${c.status === "ok" ? "text-[#8fe0b8]" : c.status === "failed" ? "text-[#ff6f86]" : "text-ink-muted"}`}
            >
              {STATUS_MARK[c.status]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium leading-snug">{c.title}</p>
              <p className="mt-0.5 font-mono text-xs uppercase tracking-wider text-ink-muted">{STATUS_WORD[c.kind][c.status]}</p>
              {c.note && <p className="mt-1 text-sm text-ink-muted">{c.note}</p>}
            </div>
          </div>
          {canMark && <CriterionButtons criterionId={c.id} kind={c.kind} status={c.status} title={c.title} />}
        </li>
      ))}
    </ul>
  );
}

/** Estrellas, no negociables, hitos estrella, valoración y cierre. También es el informe que se guarda en PDF. */
export default async function ClosingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  const { event, user, isTeam } = ctx;
  const [{ score, summary }, criteria, closing] = await Promise.all([getEventScore(id), getCriteria(id), getClosing(id)]);
  const closed = event.status === "closed";
  const level = event.level;
  const canMark = isTeam && !closed && level !== null && level <= 2;
  const canRate = isTeam && level !== null && level >= 2;
  const myRating = canRate ? await getMyRating(id, user.id) : null;
  const mandatories = criteria.filter((c) => c.kind === "no_negociable");
  const starMilestones = criteria.filter((c) => c.kind === "hito_estrella");

  const facts = [
    { label: "Piezas terminadas", value: `${summary.items_done} de ${summary.items_total}` },
    { label: "Cambios a la hoja de ruta", value: String(summary.changes) },
    { label: "Alertas", value: summary.alerts_open > 0 ? `${summary.alerts} (${summary.alerts_open} sin resolver)` : String(summary.alerts) },
    { label: "Red Flags", value: String(score.redFlags) },
    { label: "Evidencias", value: String(summary.evidences) },
    ...(summary.guests > 0 ? [{ label: "Citados a su hora", value: `${summary.guests_on_time} de ${summary.guests}` }] : []),
  ];

  return (
    <article className="informe">
      <PageTitle aside={<PrintButton />}>{closed ? "Informe de cierre" : "Estrellas y cierre"}</PageTitle>
      <p className="mb-4 mt-1 text-sm text-ink-muted">
        {closed && closing.closedAt
          ? `Evento cerrado el ${formatDate(closing.closedAt, event.timezone)} a las ${formatTime(closing.closedAt, event.timezone)}.`
          : "Se actualiza en vivo. Al cerrar el evento, esta pantalla queda como el informe para el cliente."}
      </p>
      <p className="solo-imprimir mb-4 text-sm">
        {event.name}
        {event.clientName ? ` · ${event.clientName}` : ""}
        {event.startsAt ? ` · ${formatDate(event.startsAt, event.timezone)}` : ""}
      </p>

      <ScoreCard score={score} />

      {closing.publishUrl && (
        <Card className="mt-3">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink-muted">Publicado</p>
          <a href={closing.publishUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all font-medium text-ice-300 underline underline-offset-4">
            {closing.publishUrl}
          </a>
        </Card>
      )}

      <SectionTitle>No negociables</SectionTitle>
      <p className="mb-2 text-sm text-ink-muted">{MERIT_CONFIG.no_negociables.explicacion}</p>
      <CriterionList items={mandatories} canMark={canMark} label="No negociables" />

      <SectionTitle>Criterios de producción</SectionTitle>
      <CriteriaBars score={score} />

      <SectionTitle>Hitos estrella</SectionTitle>
      <CriterionList items={starMilestones} canMark={canMark} label="Hitos estrella" />

      <SectionTitle>Resumen del evento</SectionTitle>
      <dl className="grid grid-cols-2 gap-2">
        {facts.map((f) => (
          <div key={f.label} className="rounded-card bg-surface-100 p-4">
            <dt className="text-sm text-ink-muted">{f.label}</dt>
            <dd className="mt-1 font-mono text-xl font-semibold">{f.value}</dd>
          </div>
        ))}
      </dl>

      <div className="no-imprimir">
        <SectionTitle>{isTeam ? "Aprendizajes" : "Tu impresión"}</SectionTitle>
        <Card>
          <p className="text-sm text-ink-muted">
            {isTeam ? "Antes de pasar al siguiente evento, deja lo que aprendiste en este." : "Cuéntanos cómo te fue con este evento. Toma un minuto."}
          </p>
          <Link href={`/eventos/${id}/aprendizajes`} className="mt-3 inline-flex min-h-11 items-center rounded-full bg-gold-300 px-5 font-semibold text-navy-950">
            {isTeam ? "Dejar mis aprendizajes" : "Llenar mi ficha de satisfacción"}
          </Link>
        </Card>
        <SectionTitle>Repositorio del evento</SectionTitle>
        <Card>
          <p className="text-sm text-ink-muted">Fotos, notas de voz y videos del evento, con su hora y su huella.</p>
          <Link href={`/eventos/${id}/evidencias`} className="mt-3 inline-flex min-h-11 items-center rounded-full border border-gold-300/60 px-5 text-sm font-semibold text-gold-300">
            Ver las {summary.evidences} evidencias
          </Link>
        </Card>
      </div>

      {canRate && (
        <div className="no-imprimir">
          <SectionTitle>Tu valoración</SectionTitle>
          <Card>
            <RatingForm eventId={id} current={myRating} />
          </Card>
        </div>
      )}

      {canMark && (
        <div className="no-imprimir">
          <SectionTitle>Publicación</SectionTitle>
          <Card>
            <PublishUrlForm eventId={id} current={closing.publishUrl} />
          </Card>
        </div>
      )}

      {isTeam && level === 1 && !closed && (
        <div className="no-imprimir">
          <SectionTitle>Cerrar el evento</SectionTitle>
          <Card>
            <CloseEventForm eventId={id} pendingMandatories={score.mandatories.pending} />
          </Card>
        </div>
      )}
    </article>
  );
}
