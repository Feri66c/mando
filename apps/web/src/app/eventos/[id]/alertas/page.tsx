import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertCard } from "@/components/operacion/blocks";
import { AlertActions, RaiseAlertForm } from "@/components/operacion/forms";
import { Card, Empty, PageTitle, SectionTitle } from "@/components/operacion/ui";
import { levelOf } from "@mando/core/criticality";
import { getAlerts, getEventContext, getPlanning, getRouteItems } from "@/lib/data";
import { DesignModeBanner } from "@/components/operacion/modo-diseno";

export const metadata: Metadata = { title: "Alertas" };

const NO_NEGOCIABLE = /^No negociable\b/i;
const VENCIDO = /^Documento vencido\b/i;
/** En cada grupo el título dice solo el documento: «Documento vencido: RUC…» → «RUC…». */
const docName = (title: string) => (title.includes(": ") ? title.slice(title.indexOf(": ") + 2) : title);

export default async function AlertsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  const { event, criticality, isTeam } = ctx;
  const [alerts, items, planning] = await Promise.all([getAlerts(id), isTeam ? getRouteItems(id) : Promise.resolve([]), getPlanning(id)]);
  const open = alerts.filter((a) => a.status !== "resolved");
  // Modo diseño: las automáticas quedan en pausa (no bloquean) hasta «Listo, activa».
  const paused = planning.designMode ? open.filter((a) => a.ruleKey) : [];
  const active = open.filter((a) => !paused.includes(a));
  const resolved = alerts.filter((a) => a.status === "resolved");
  // Nomenclatura por grupo: Activas · Red flag, Activas · Vencidas y Activas (el resto).
  const flags = active.filter((a) => NO_NEGOCIABLE.test(a.title));
  const expired = active.filter((a) => VENCIDO.test(a.title));
  const others = active.filter((a) => !flags.includes(a) && !expired.includes(a));
  // Alertas de un documento del expediente: se resuelven adjuntándolo, no con una palabra.
  const docOf = (a: (typeof alerts)[number]) =>
    a.entityType === "requirement" && a.entityId ? { eventId: id, requirementId: a.entityId, title: docName(a.title) } : null;
  const levels = [1, 2, 3, 4].map((n) => levelOf(criticality, n));

  const group = (key: string, heading: string, list: typeof alerts, tone: "rojo" | "ambar") => (
    <section aria-labelledby={key} className="mt-6">
      <h2 id={key} className={`no-negociables-titulo ${tone === "ambar" ? "grupo-ambar" : ""}`}>
        <span className="no-negociables-punto" aria-hidden />
        {heading}
        <span className="ml-auto font-mono text-base">{list.length}</span>
      </h2>
      <ul className="grid gap-2">
        {list.map((a) => (
          <AlertCard key={a.id} alert={a} config={criticality} timeZone={event.timezone} title={docName(a.title)}>
            {isTeam && <AlertActions alertId={a.id} status={a.status} document={docOf(a)} />}
            {isTeam && a.visibleToViewer && <p className="mt-2 text-xs opacity-70">El cliente ve esta alerta.</p>}
          </AlertCard>
        ))}
      </ul>
    </section>
  );

  return (
    <>
      <PageTitle>Alertas</PageTitle>
      <p className="mt-1 text-sm text-ink-muted">
        {isTeam
          ? "Los documentos se resuelven adjuntándolos: la IA de MANDO los revisa y da el pase. Todo queda en la bitácora."
          : "Te avisamos aquí cuando algo compromete el evento."}
      </p>
      {planning.designMode && <DesignModeBanner />}

      {flags.length > 0 && group("activas-red-flag", "Activas · Red flag", flags, "rojo")}
      {expired.length > 0 && group("activas-vencidas", "Activas · Vencidas", expired, "ambar")}

      {(others.length > 0 || (flags.length === 0 && expired.length === 0)) && <SectionTitle>Activas</SectionTitle>}
      {active.length === 0 ? (
        <Empty>Sin alertas activas.</Empty>
      ) : (
        <ul className="grid gap-2">
          {others.map((a) => (
            <AlertCard key={a.id} alert={a} config={criticality} timeZone={event.timezone} title={a.entityType === "requirement" ? docName(a.title) : undefined}>
              {isTeam && <AlertActions alertId={a.id} status={a.status} document={docOf(a)} />}
              {isTeam && a.visibleToViewer && <p className="mt-2 text-xs text-ink-muted">El cliente ve esta alerta.</p>}
            </AlertCard>
          ))}
        </ul>
      )}

      {paused.length > 0 && (
        <details className="mt-6">
          <summary className="etiqueta-mando cursor-pointer text-ice-300">En pausa por modo diseño · {paused.length}</summary>
          <ul className="mt-2 grid gap-2 opacity-70">
            {paused.map((a) => (
              <AlertCard key={a.id} alert={a} config={criticality} timeZone={event.timezone} title={docName(a.title)} paused />
            ))}
          </ul>
        </details>
      )}

      {isTeam && (
        <section id="reportar" className="scroll-mt-24">
          <SectionTitle>Reportar un problema</SectionTitle>
          <Card>
            <RaiseAlertForm
              eventId={id}
              levels={levels.map((l) => ({ nivel: l.nivel, nombre: l.nombre, descripcion: l.descripcion }))}
              items={items.map((i) => ({ id: i.id, title: i.title }))}
            />
          </Card>
        </section>
      )}

      {resolved.length > 0 && (
        <>
          <SectionTitle>Resueltas</SectionTitle>
          <ul className="grid gap-2">
            {resolved.map((a) => (
              <AlertCard key={a.id} alert={a} config={criticality} timeZone={event.timezone} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
