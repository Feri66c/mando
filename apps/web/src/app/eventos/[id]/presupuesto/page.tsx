import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BudgetDecision, BudgetForm, BudgetLineForm, RemoveBudgetLine } from "@/components/operacion/planificacion";
import { BudgetExtraDecision, BudgetExtrasRequest, BudgetExtrasToggle } from "@/components/operacion/ajustes";
import { Card, Empty, PageTitle, SectionTitle } from "@/components/operacion/ui";
import { COST_REFERENCES, budgetLinesTotal, budgetWarnings, formatMoney } from "@mando/core/planning";
import { BUDGET_EXTRA_LABEL } from "@mando/core/data";
import { formatTime } from "@mando/core/time";
import { getBudget, getEventContext } from "@/lib/data";

export const metadata: Metadata = { title: "Presupuesto" };

const STATUS = {
  sent: { label: "Por aprobar", color: "text-gold-300" },
  approved: { label: "✓ Aprobado por el cliente", color: "text-[#8fe0b8]" },
  changes_requested: { label: "El cliente pidió un cambio", color: "text-[#ff6f86]" },
} as const;

/**
 * Presupuesto del evento. El cliente aprueba el monto global. La productora ve el global y, solo si el productor
 * general lo habilita, el desglose. Coordinación y técnicos no ven montos.
 */
export default async function BudgetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  const { event } = ctx;
  const isClient = event.role === "viewer";
  const isBackend = event.role === "backend";
  if (!isClient && !(event.level !== null && event.level <= 2)) notFound();
  const closed = event.status === "closed";
  const budget = await getBudget(id);
  const lines = budget?.lines ?? [];
  const warnings = budgetWarnings(lines);
  const linesTotal = budgetLinesTotal(lines);
  const pendingExtras = (budget?.extras ?? []).filter((x) => x.status === "requested");

  return (
    <>
      <PageTitle>Presupuesto</PageTitle>
      <p className="mb-3 mt-1 text-sm text-ink-muted">
        {isClient ? "El monto de tu evento. Apruébalo o pide un cambio." : isBackend ? "Carga el monto, decide si la productora ve el desglose y espera la aprobación del cliente." : "El monto con el que trabajas en este evento."}
      </p>

      {!budget ? (
        <Empty>{isBackend ? "Todavía no hay presupuesto. Cárgalo abajo." : "El productor general todavía no carga el presupuesto."}</Empty>
      ) : (
        <Card>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">{isClient ? "Monto global" : "Presupuesto asignado"}</p>
          <p className="mt-1 font-mono text-3xl font-semibold">{formatMoney(budget.total, budget.currency)}</p>
          <p className={`mt-2 font-mono text-xs font-semibold uppercase tracking-wider ${STATUS[budget.status].color}`}>
            {STATUS[budget.status].label}
            {budget.status !== "sent" && budget.decidedAt ? ` · ${formatTime(budget.decidedAt, event.timezone)}` : ""}
          </p>
          {budget.status !== "sent" && budget.decisionNote && <p className="mt-1 text-sm">«{budget.decisionNote}»</p>}
          {!closed && (isClient || isBackend) && (
            <div className="mt-3">
              <BudgetDecision key={budget.status} eventId={id} status={budget.status} onBehalf={isBackend} />
            </div>
          )}
        </Card>
      )}

      {budget && !isClient && (isBackend || budget.breakdownVisible) && (
        <>
          <SectionTitle>Desglose</SectionTitle>
          {warnings.length > 0 && (
            <ul aria-label="Avisos del presupuesto" className="mb-2 grid gap-2">
              {warnings.map((w) => (
                <li key={w.title} className="rounded-card border border-[#ff6f86]/50 bg-surface-100 px-4 py-3 text-sm">
                  <span className="font-semibold text-[#ff6f86]">Por debajo del mercado. </span>
                  {w.message}
                </li>
              ))}
            </ul>
          )}
          {lines.length === 0 ? (
            <Empty>Todavía no hay partidas.</Empty>
          ) : (
            <Card>
              <ul aria-label="Partidas" className="divide-y divide-line">
                {lines.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-snug">{l.title}</p>
                      <p className="font-mono text-xs text-ink-muted">
                        {l.quantity} × {formatMoney(l.unitCost, budget.currency)}
                      </p>
                    </div>
                    <p className="shrink-0 font-mono text-sm">{formatMoney(l.quantity * l.unitCost, budget.currency)}</p>
                    {isBackend && !closed && <RemoveBudgetLine lineId={l.id} title={l.title} />}
                  </li>
                ))}
              </ul>
              <p className="mt-2 border-t border-line pt-2 text-right font-mono text-sm">
                Suma de partidas: <span className="font-semibold">{formatMoney(linesTotal, budget.currency)}</span>
              </p>
              {Math.abs(linesTotal - budget.total) >= 0.01 && (
                <p className="mt-1 text-right text-xs text-gold-300">
                  {linesTotal > budget.total ? "Las partidas superan el monto global por " : "Faltan partidas por "}
                  {formatMoney(Math.abs(linesTotal - budget.total), budget.currency)}.
                </p>
              )}
            </Card>
          )}
        </>
      )}

      {budget && !isClient && !closed && (isBackend || budget.extrasOpen) && (
        <>
          <SectionTitle>Adicionales</SectionTitle>
          <Card>
            {isBackend ? (
              <>
                <p className="mb-3 text-sm text-ink-muted">
                  {budget.extrasOpen ? "La productora puede solicitar adicionales de personal, técnica o locación." : "Ábrelos si la productora puede pedir más personal, técnica o locación."}
                </p>
                <BudgetExtrasToggle eventId={id} open={budget.extrasOpen} />
                {pendingExtras.length > 0 && (
                  <ul aria-label="Adicionales solicitados" className="mt-4 divide-y divide-line">
                    {pendingExtras.map((x) => (
                      <li key={x.id} className="py-3">
                        <p className="font-medium">{BUDGET_EXTRA_LABEL[x.kind]}</p>
                        {x.note && <p className="text-sm text-ink-muted">«{x.note}»</p>}
                        <BudgetExtraDecision extraId={x.id} label={BUDGET_EXTRA_LABEL[x.kind]} />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <BudgetExtrasRequest eventId={id} extras={budget.extras} />
            )}
          </Card>
        </>
      )}

      {isBackend && !closed && (
        <>
          <SectionTitle>{budget ? "Cambiar el presupuesto" : "Cargar el presupuesto"}</SectionTitle>
          <Card>
            <BudgetForm eventId={id} total={budget?.total ?? null} breakdownVisible={budget?.breakdownVisible ?? false} />
          </Card>
          {budget && (
            <>
              <SectionTitle>Agregar partida</SectionTitle>
              <Card>
                <BudgetLineForm eventId={id} concepts={COST_REFERENCES} />
              </Card>
            </>
          )}
        </>
      )}
    </>
  );
}
