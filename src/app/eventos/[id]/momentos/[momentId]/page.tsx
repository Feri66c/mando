import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EvidenceGrid } from "@/components/operacion/blocks";
import { EvidenceUploader } from "@/components/operacion/evidence-uploader";
import { AddCommitmentForm, AnswerForm, CommitmentForm, ResolveMomentForm } from "@/components/operacion/forms";
import { Card, LevelChip, SectionTitle, buttonSecondary } from "@/components/operacion/ui";
import { COMMITMENT_OUTCOME_LABEL, MOMENT_STATUS_LABEL } from "@/lib/core/labels";
import { DOCUMENT_LABEL, templateByKey } from "@/lib/core/templates";
import { formatTime } from "@/lib/core/time";
import { getEventContext, getEvidences, getMomentDetail } from "@/lib/data";
import { OpenMomentButton } from "./open-button";

export const metadata: Metadata = { title: "Momento crítico" };

export default async function MomentPage({ params }: { params: Promise<{ id: string; momentId: string }> }) {
  const { id, momentId } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  if (!ctx.isTeam) redirect(`/eventos/${id}`);
  const detail = await getMomentDetail(id, momentId);
  if (!detail) notFound();
  const { moment, checks, commitments } = detail;
  const evidences = await getEvidences(id, { momentId });
  const template = templateByKey(moment.templateKey);
  const tz = ctx.event.timezone;
  const resolved = moment.status === "resolved";

  return (
    <>
      <Link href={`/eventos/${id}/momentos`} className="text-sm text-ink-muted hover:text-ink">
        ← Momentos críticos
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-semibold leading-tight">{moment.title}</h1>
        {moment.level > 1 && <LevelChip level={moment.level} config={ctx.criticality} />}
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        {MOMENT_STATUS_LABEL[moment.status]}
        {moment.openedAt && ` desde las ${formatTime(moment.openedAt, tz)}`}
        {moment.routeItemTitle && (
          <>
            {" · "}
            <Link href={`/eventos/${id}/actividad/${moment.routeItemId}`} className="underline">
              {moment.routeItemTitle}
            </Link>
          </>
        )}
      </p>

      {moment.status === "scheduled" && (
        <div className="mt-4">
          <OpenMomentButton momentId={moment.id} />
        </div>
      )}

      {resolved && moment.resolution && (
        <Card className="mt-4">
          <p className="text-sm text-ink-muted">Cómo terminó</p>
          <p className="mt-1">{moment.resolution}</p>
        </Card>
      )}

      <SectionTitle>Preguntas</SectionTitle>
      <div className="grid gap-3">
        {checks.map((c) => (
          <Card key={c.id}>
            {resolved ? (
              <>
                <p className="font-medium">{c.question}</p>
                <p className="mt-1 text-sm text-ink-muted">{c.answer ?? "Sin respuesta"}</p>
              </>
            ) : (
              <AnswerForm checkId={c.id} question={c.question} answer={c.answer} />
            )}
          </Card>
        ))}
        {template && !resolved && (
          <p className="text-sm text-ink-muted">
            Documento base: {DOCUMENT_LABEL[template.documento_base] ?? template.documento_base}. Súbelo abajo como evidencia
            (documento o foto).
          </p>
        )}
      </div>

      <SectionTitle>Prometido contra entregado</SectionTitle>
      <div className="grid gap-3">
        {commitments.map((c) => (
          <Card key={c.id}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-semibold">{c.label}</p>
              {c.outcome && <span className="text-xs font-semibold uppercase tracking-wide">{COMMITMENT_OUTCOME_LABEL[c.outcome]}</span>}
            </div>
            <p className="text-sm text-ink-muted">
              Prometido: <span className="text-ink">{c.promised}</span>
            </p>
            {resolved ? (
              <p className="text-sm text-ink-muted">Encontrado: {c.found ?? "—"}</p>
            ) : (
              <CommitmentForm commitmentId={c.id} found={c.found} outcome={c.outcome} />
            )}
          </Card>
        ))}
        {!resolved && (
          <Card>
            <AddCommitmentForm momentId={moment.id} />
          </Card>
        )}
      </div>

      <SectionTitle>Evidencias</SectionTitle>
      <EvidenceGrid items={evidences} timeZone={tz} isTeam />
      {!resolved && (
        <Card className="mt-3">
          <EvidenceUploader
            eventId={id}
            momentId={moment.id}
            routeItemId={moment.routeItemId}
            defaultVisible={false}
            suggested={template?.evidencia_sugerida.map((k) => ({ photo: "foto", audio: "audio", video: "video" })[k] ?? k)}
          />
        </Card>
      )}

      {!resolved && moment.status !== "scheduled" && (
        <>
          <SectionTitle>Cerrar el momento</SectionTitle>
          <Card>
            <ResolveMomentForm momentId={moment.id} />
          </Card>
        </>
      )}

      {moment.routeItemId && (
        <Link href={`/eventos/${id}/actividad/${moment.routeItemId}#cambio`} className={`${buttonSecondary} mt-6 w-full`}>
          Pedir más tiempo para la actividad
        </Link>
      )}
    </>
  );
}
