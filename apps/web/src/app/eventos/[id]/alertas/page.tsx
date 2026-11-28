import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertCard } from "@/components/operacion/blocks";
import { AlertActions, RaiseAlertForm } from "@/components/operacion/forms";
import { Card, Empty, PageTitle, SectionTitle } from "@/components/operacion/ui";
import { levelOf } from "@mando/core/criticality";
import { getAlerts, getEventContext, getRouteItems } from "@/lib/data";

export const metadata: Metadata = { title: "Alertas" };

const NO_NEGOCIABLE = /^No negociable\b/i;
/** «No negociable sin documento: SCTR» → «Sin documento: SCTR». */
const withoutPrefix = (title: string) => {
  const rest = title.replace(NO_NEGOCIABLE, "").trim();
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : title;
};

export default async function AlertsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  const { event, criticality, isTeam } = ctx;
  const [alerts, items] = await Promise.all([getAlerts(id), isTeam ? getRouteItems(id) : Promise.resolve([])]);
  const active = alerts.filter((a) => a.status !== "resolved");
  const resolved = alerts.filter((a) => a.status === "resolved");
  // Las de no negociables van juntas bajo su propio título; así la tarjeta no repite «No negociable».
  const mustHave = active.filter((a) => NO_NEGOCIABLE.test(a.title));
  const others = active.filter((a) => !NO_NEGOCIABLE.test(a.title));
  const levels = [1, 2, 3, 4].map((n) => levelOf(criticality, n));

  return (
    <>
      <PageTitle>Alertas</PageTitle>
      <p className="mt-1 text-sm text-ink-muted">
        {isTeam
          ? "Abierta → reconocida → resuelta. Cada paso queda en la bitácora."
          : "Te avisamos aquí cuando algo compromete el evento."}
      </p>

      {mustHave.length > 0 && (
        <section aria-labelledby="no-negociables" className="mt-6">
          <h2 id="no-negociables" className="no-negociables-titulo">
            <span className="no-negociables-punto" aria-hidden />
            Activas · No negociables
            <span className="ml-auto font-mono text-base">{mustHave.length}</span>
          </h2>
          <ul className="grid gap-2">
            {mustHave.map((a) => (
              <AlertCard key={a.id} alert={a} config={criticality} timeZone={event.timezone} title={withoutPrefix(a.title)}>
                {isTeam && <AlertActions alertId={a.id} status={a.status} />}
                {isTeam && a.visibleToViewer && <p className="mt-2 text-xs text-white/60">El cliente ve esta alerta.</p>}
              </AlertCard>
            ))}
          </ul>
        </section>
      )}

      {(others.length > 0 || mustHave.length === 0) && <SectionTitle>Activas</SectionTitle>}
      {active.length === 0 ? (
        <Empty>Sin alertas activas.</Empty>
      ) : (
        <ul className="grid gap-2">
          {others.map((a) => (
            <AlertCard key={a.id} alert={a} config={criticality} timeZone={event.timezone}>
              {isTeam && <AlertActions alertId={a.id} status={a.status} />}
              {isTeam && a.visibleToViewer && <p className="mt-2 text-xs text-ink-muted">El cliente ve esta alerta.</p>}
            </AlertCard>
          ))}
        </ul>
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
