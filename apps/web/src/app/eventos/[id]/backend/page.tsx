import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BudgetExtraDecision, ClientNoticeForm, DeadlineForm, InstructionForm, TechNaReview } from "@/components/operacion/ajustes";
import { LogList } from "@/components/operacion/blocks";
import { Semaforo } from "@/components/operacion/semaforo";
import { Card, Empty, PageTitle, SectionTitle } from "@/components/operacion/ui";
import { BUDGET_EXTRA_LABEL, NOTICE_LABEL } from "@mando/core/data";
import { formatTime } from "@mando/core/time";
import { getBriefDoubts, getBudget, getClientNotices, getEventContext, getLog, getPlanning, getPlanningDeadline, getTechItems } from "@/lib/data";

export const metadata: Metadata = { title: "Backend" };

const OBSERVATIONS = ["Factura no pagada", "Adelanto no generado"] as const;
const NOTICE_COLOR = { ok: "text-ok", observation: "text-[var(--naranja)]", unconfirmed: "text-gold-300" } as const;

/**
 * Backend del evento (decisiones 45 a 48): lo que espera su revisión, las instrucciones al productor,
 * los avisos al cliente y las ocurrencias internas, que se quedan para el aprendizaje.
 */
export default async function BackendPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx || ctx.event.role !== "backend") notFound();
  const { event, criticality } = ctx;
  const closed = event.status === "closed";
  const [planning, tech, budget, doubts, notices, hours, log] = await Promise.all([
    getPlanning(id),
    getTechItems(id),
    getBudget(id),
    getBriefDoubts(id),
    getClientNotices(id),
    getPlanningDeadline(id),
    getLog(id, 8),
  ]);
  const naPending = tech.filter((t) => t.naRequested);
  const extrasPending = (budget?.extras ?? []).filter((x) => x.status === "requested");
  const doubtsOpen = doubts.filter((d) => d.status === "open");
  const waiting = naPending.length + extrasPending.length + doubtsOpen.length;

  return (
    <>
      <PageTitle>Backend</PageTitle>
      <p className="mb-3 mt-1 text-sm text-ink-muted">Desde aquí das instrucciones al productor e informas al cliente.</p>

      <SectionTitle>Te esperan</SectionTitle>
      {waiting === 0 ? (
        <Empty>Nada espera tu revisión.</Empty>
      ) : (
        <ul className="grid gap-2">
          {naPending.map((t) => (
            <li key={t.id}>
              <Card>
                <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-[var(--naranja)]">No aplica · por revisar</p>
                <p className="mt-1 font-semibold">{t.title}</p>
                <p className="text-sm text-ink-muted">{t.mandatory ? "Es obligatorio. Si dices que sí aplica, se levanta un Red Flag." : "No es obligatorio."}</p>
                {!closed && <TechNaReview itemId={t.id} title={t.title} />}
              </Card>
            </li>
          ))}
          {extrasPending.map((x) => (
            <li key={x.id}>
              <Card>
                <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-gold-300">Adicional solicitado</p>
                <p className="mt-1 font-semibold">{BUDGET_EXTRA_LABEL[x.kind]}</p>
                {x.note && <p className="text-sm text-ink-muted">«{x.note}»</p>}
                {!closed && <BudgetExtraDecision extraId={x.id} label={BUDGET_EXTRA_LABEL[x.kind]} />}
              </Card>
            </li>
          ))}
          {doubtsOpen.map((d) => (
            <li key={d.id}>
              <Card>
                <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-ice-300">Duda sobre el brief</p>
                <p className="mt-1 font-semibold">{d.who}</p>
                <p className="text-sm">«{d.question}»</p>
                <Link href={`/panel/${id}`} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-gold-300 underline underline-offset-4">
                  Responder en el panel
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {!closed && (
        <>
          <SectionTitle>Reglas</SectionTitle>
          <Card>
            <p className="mb-3 text-sm text-ink-muted">
              Lo que no sea obligatorio se completa hasta este plazo. Al aplicarlo, lo que siga pendiente levanta un Red Flag.
            </p>
            <DeadlineForm eventId={id} hours={hours} />
          </Card>

          <SectionTitle>Instrucción al productor</SectionTitle>
          <Card>
            <InstructionForm eventId={id} />
          </Card>
        </>
      )}

      <SectionTitle>Informar al cliente</SectionTitle>
      <Card>
        <Semaforo elements={planning.elements} />
        <p className="mt-2 text-sm text-ink-muted">
          El avance lo decide el sistema. Cuando un hito se cumple, el cliente recibe su «Todo OK» sin que nadie lo escriba.
        </p>
        {!closed && (
          <div className="mt-4 border-t border-line pt-4">
            <ClientNoticeForm eventId={id} presets={OBSERVATIONS} />
          </div>
        )}
      </Card>

      <SectionTitle>Lo que ve el cliente</SectionTitle>
      {notices.length === 0 ? (
        <Empty>Todavía no hay avisos para el cliente.</Empty>
      ) : (
        <Card>
          <ul aria-label="Avisos al cliente" className="divide-y divide-line">
            {notices.slice(0, 8).map((n) => (
              <li key={n.id} className="py-2">
                <p className={`font-mono text-xs font-semibold uppercase tracking-wider ${NOTICE_COLOR[n.kind]}`}>
                  {NOTICE_LABEL[n.kind]} · {formatTime(n.createdAt, event.timezone)}
                </p>
                <p className="leading-snug">{n.body}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <SectionTitle href={`/eventos/${id}/bitacora`} linkLabel="Bitácora completa">
        Ocurrencias internas
      </SectionTitle>
      <p className="mb-2 text-sm text-ink-muted">Se quedan con el equipo, para el aprendizaje. El cliente no las ve.</p>
      <LogList entries={log} timeZone={event.timezone} config={criticality} />
    </>
  );
}
