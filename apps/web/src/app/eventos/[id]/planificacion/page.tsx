import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pieza } from "@/components/operacion/pieza";
import { Semaforo } from "@/components/operacion/semaforo";
import { PageTitle } from "@/components/operacion/ui";
import { PLANNING_ELEMENTS, planningProgress, planningReady } from "@mando/core/planning";
import { getEventContext, getPlanning } from "@/lib/data";

export const metadata: Metadata = { title: "Planificación" };

/** El tablero de los 5 elementos. Con los cinco completos se desbloquea el timeline. */
export default async function PlanningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  const { event, isTeam } = ctx;
  const planning = await getPlanning(id);
  const ready = planningReady(planning.elements);
  const progress = planningProgress(planning.elements);
  const canSeeBudget = event.role === "viewer" || (event.level !== null && event.level <= 2);
  // El cliente entra a lo que le toca decidir; el equipo, a todo menos al presupuesto si no le corresponde.
  const canOpen = (key: string) => (isTeam ? key !== "presupuesto" || canSeeBudget : key === "presupuesto" || key === "aprobaciones");

  return (
    <>
      <PageTitle aside={<span className="font-mono text-sm text-ink-muted">{progress.ready} de {progress.total}</span>}>Planificación</PageTitle>
      <p className="mb-3 mt-1 text-sm text-ink-muted">
        Los 5 elementos del evento. Entra a cualquiera, en el orden que quieras. Con los cinco completos se desbloquea el timeline.
      </p>
      <div className="rounded-card bg-surface-100 p-4">
        <Semaforo elements={planning.elements} />
        <p className="mt-2 text-sm text-ink-muted">Lo obligatorio desbloquea el reto. El resto se completa hasta el plazo que fija el backend.</p>
      </div>

      <ol className="mt-4 grid gap-2.5" aria-label="Elementos de la planificación">
        {PLANNING_ELEMENTS.map((e, i) => {
          const s = planning.elements.find((x) => x.key === e.clave);
          const done = Boolean(s?.ready);
          return (
            <li key={e.clave}>
              <Pieza href={canOpen(e.clave) ? `/eventos/${id}/${e.ruta}` : undefined} label={`${e.nombre}: ${done ? "completo" : "pendiente"}`} done={done}>
                <div className="flex items-start gap-3.5">
                  <span aria-hidden="true" className="pieza-numero">
                    {done ? "✓" : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-xl font-semibold leading-snug">{e.nombre}</p>
                    <p className="text-sm text-ink-muted">{e.descripcion}</p>
                    <p className={`mt-1.5 font-mono text-[13px] font-semibold uppercase tracking-wider ${done ? "text-ok" : "text-gold-300"}`}>
                      {done ? "Completo" : (s?.missing ?? []).join(" · ") || "Pendiente"}
                    </p>
                  </div>
                  {canOpen(e.clave) && <span aria-hidden className="self-center text-2xl text-ink-muted">›</span>}
                </div>
              </Pieza>
            </li>
          );
        })}
      </ol>

      {ready ? (
        <Link href={`/eventos/${id}/hoja-de-ruta`} className="mt-4 block rounded-card border border-[#8fe0b8]/40 bg-surface-100 px-4 py-3 text-sm font-semibold text-[#8fe0b8]">
          ✓ Planificación completa. El timeline está desbloqueado: ábrelo.
        </Link>
      ) : (
        <p role="status" className="mt-4 rounded-card border border-gold-300/50 bg-surface-100 px-4 py-3 text-sm">
          <span className="font-semibold text-gold-300">Timeline bloqueado.</span>{" "}
          <span className="text-ink-muted">
            {planning.gate ? "Se abre cuando los cinco elementos estén completos." : "Este evento es anterior a la planificación: no se bloquea, pero aquí ves lo que falta."}
          </span>
        </p>
      )}
    </>
  );
}
