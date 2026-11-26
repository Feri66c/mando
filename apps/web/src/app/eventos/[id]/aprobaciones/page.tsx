import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddApprovalForm, ApprovalDecision, ApprovalGroupsForm, ApprovalTeamActions, CastingTeamActions } from "@/components/operacion/aprobaciones";
import { CastingSemaforo, FichaView } from "@/components/operacion/mando";
import { Card, Empty, PageTitle, SectionTitle } from "@/components/operacion/ui";
import { APPROVAL_GROUPS, APPROVAL_STATUS_LABEL, approvalGate, type ApprovalStatus } from "@mando/core/approvals";
import { formatTime } from "@mando/core/time";
import { getApprovalGroups, getApprovals, getEventContext } from "@/lib/data";

export const metadata: Metadata = { title: "Aprobaciones" };

const STATUS_COLOR: Record<ApprovalStatus, string> = {
  pending: "text-gold-300",
  approved: "text-[#8fe0b8]",
  changes_requested: "text-[#ff6f86]",
  backup: "text-gold-300",
  rejected: "text-[#ff6f86]",
};
const STATUS_MARK: Record<ApprovalStatus, string> = { pending: "◆", approved: "✓", changes_requested: "!", backup: "◐", rejected: "✕" };

/**
 * Elementos base que el cliente aprueba antes de empezar: casting, uniforme, utilería y referencias.
 * La productora sube; el cliente aprueba o pide un cambio, en vivo. Sin todo aprobado no se marca el inicio.
 * El casting lleva semáforo (decisión 50): Aprobado, Backup o No admitido, con la mini ficha junto a la foto.
 */
export default async function ApprovalsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  const { event, isTeam } = ctx;
  const [active, items] = await Promise.all([getApprovalGroups(id), getApprovals(id)]);
  const closed = event.status === "closed";
  const level = event.level;
  const canUpload = isTeam && !closed && level !== null && level <= 3;
  const canChoose = isTeam && !closed && level !== null && level <= 2;
  const isClient = event.role === "viewer";
  const onBehalf = event.role === "backend";
  const canDecide = !closed && (isClient || onBehalf);
  const gate = approvalGate(active, items);
  const groups = APPROVAL_GROUPS.filter((g) => active.includes(g.clave));
  const approved = items.filter((i) => active.includes(i.group) && i.status === "approved").length;
  const total = items.filter((i) => active.includes(i.group)).length;

  return (
    <>
      <PageTitle aside={total > 0 ? <span className="font-mono text-sm text-ink-muted">{approved} de {total} aprobados</span> : undefined}>Aprobaciones</PageTitle>
      <p className="mb-3 mt-1 text-sm text-ink-muted">
        {isClient
          ? "Lo que el equipo propone para tu evento. Aprueba cada elemento o pide un cambio: el equipo lo ve al instante."
          : "Sube cada elemento con su foto. El cliente lo aprueba o pide un cambio desde su teléfono, y todo queda en la bitácora."}
      </p>

      {groups.length === 0 ? (
        <Empty>{isTeam ? "Este evento todavía no pide aprobaciones. Elige abajo lo que el cliente debe aprobar según el brief." : "Este evento no tiene elementos por aprobar."}</Empty>
      ) : gate.ready ? (
        <p role="status" className="rounded-card border border-[#8fe0b8]/40 bg-surface-100 px-4 py-3 text-sm font-semibold text-[#8fe0b8]">
          ✓ Todo aprobado. El evento puede empezar.
        </p>
      ) : (
        <div role="status" className="rounded-card border border-gold-300/50 bg-surface-100 px-4 py-3 text-sm">
          <p className="font-semibold text-gold-300">Todavía no se puede marcar el inicio</p>
          <ul className="mt-1 text-ink-muted">
            {gate.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {groups.map((g) => {
        const own = items.filter((i) => i.group === g.clave);
        return (
          <section key={g.clave}>
            <SectionTitle>{g.nombre}</SectionTitle>
            <p className="-mt-1 mb-2 text-xs text-ink-muted">{g.descripcion}</p>
            {own.length === 0 ? (
              <Empty>{isTeam ? "Falta subirlo." : "El equipo todavía no sube nada aquí."}</Empty>
            ) : (
              <ul aria-label={g.nombre} className="grid gap-2">
                {own.map((a) => {
                  const label = `${a.code} ${a.name}`;
                  if (g.clave === "casting")
                    return (
                      <li key={a.id} className="rounded-card bg-surface-100 p-4">
                        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                          {a.fileUrl ? (
                            <a href={a.fileUrl} target="_blank" rel="noreferrer" aria-label={`Ver foto de ${label}`} className="shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado de corta duración */}
                              <img src={a.fileUrl} alt={`Foto de ${a.name}`} className="h-36 w-28 bg-surface-200 object-cover" />
                            </a>
                          ) : (
                            <div aria-hidden="true" className="grid h-36 w-28 shrink-0 place-items-center bg-surface-200 font-mono text-xs text-ink-muted">
                              sin foto
                            </div>
                          )}
                          <div className="min-w-[9rem] flex-1">
                            <p className="font-mono text-xs text-ink-muted">
                              {a.code}
                              {a.version > 1 ? ` · foto ${a.version}` : ""}
                            </p>
                            <p className="font-display text-lg font-bold leading-tight">{a.name}</p>
                            {a.detail && <p className="mt-0.5 text-sm text-ink-muted">{a.detail}</p>}
                            <p className={`mt-1 font-mono text-xs font-semibold uppercase tracking-wider ${STATUS_COLOR[a.status]}`}>
                              <span aria-hidden="true">{STATUS_MARK[a.status]} </span>
                              {APPROVAL_STATUS_LABEL[a.status]}
                              {a.status !== "pending" && a.decidedAt ? ` · ${formatTime(a.decidedAt, event.timezone)}` : ""}
                            </p>
                            {a.status !== "pending" && a.decisionNote && <p className="mt-1 text-sm">«{a.decisionNote}»</p>}
                          </div>
                          <div className="w-full min-w-0 border-t border-line pt-3 sm:w-[46%] sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                            <FichaView profile={a.profile} />
                          </div>
                        </div>
                        <div className="mt-3 grid gap-3">
                          <CastingSemaforo itemId={a.id} label={label} status={a.status} canDecide={canDecide} />
                          {canUpload && <CastingTeamActions eventId={id} itemId={a.id} label={label} profile={a.profile} />}
                        </div>
                      </li>
                    );
                  return (
                    <li key={a.id} className="rounded-card bg-surface-100 p-4">
                      <div className="flex items-start gap-3">
                        {a.fileUrl ? (
                          <a href={a.fileUrl} target="_blank" rel="noreferrer" aria-label={`Ver foto de ${label}`} className="shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado de corta duración */}
                            <img src={a.fileUrl} alt={`Foto de ${a.name}`} className="size-24 bg-surface-200 object-cover" />
                          </a>
                        ) : (
                          <div aria-hidden="true" className="grid size-24 shrink-0 place-items-center bg-surface-200 font-mono text-xs text-ink-muted">
                            sin foto
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-xs text-ink-muted">
                            {a.code}
                            {a.version > 1 ? ` · versión ${a.version}` : ""}
                          </p>
                          <p className="font-medium leading-snug">{a.name}</p>
                          {a.detail && <p className="mt-0.5 text-sm text-ink-muted">{a.detail}</p>}
                          <p className={`mt-1 font-mono text-xs font-semibold uppercase tracking-wider ${STATUS_COLOR[a.status]}`}>
                            <span aria-hidden="true">{STATUS_MARK[a.status]} </span>
                            {APPROVAL_STATUS_LABEL[a.status]}
                            {a.status !== "pending" && a.decidedAt ? ` · ${formatTime(a.decidedAt, event.timezone)}` : ""}
                          </p>
                          {a.status !== "pending" && a.decisionNote && <p className="mt-1 text-sm">«{a.decisionNote}»</p>}
                        </div>
                      </div>
                      {(canDecide || canUpload) && (
                        <div className="mt-3 grid gap-2">
                          {canDecide && <ApprovalDecision key={`${a.status}-${a.version}`} itemId={a.id} label={label} status={a.status} onBehalf={onBehalf} />}
                          {canUpload && <ApprovalTeamActions eventId={id} itemId={a.id} label={label} />}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {canUpload && <AddApprovalForm eventId={id} group={g.clave} groupName={g.nombre} />}
            {g.clave === "casting" && canChoose && (
              <Link href={`/eventos/${id}/talentos`} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-gold-300 underline underline-offset-4">
                Elegir del banco de talentos
              </Link>
            )}
          </section>
        );
      })}

      {canChoose && (
        <>
          <SectionTitle>Qué aprueba el cliente</SectionTitle>
          <Card>
            <ApprovalGroupsForm eventId={id} groups={[...APPROVAL_GROUPS]} active={active} />
          </Card>
        </>
      )}
    </>
  );
}
