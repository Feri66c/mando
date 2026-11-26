import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CommandView } from "@/components/operacion/cadena-vista";
import { SUGGESTED_AREAS, seesAll } from "@mando/core/command";
import { getAccessList, getAreas, getCommandChain, getEmergencyChanges, getEventContext } from "@/lib/data";

export const metadata: Metadata = { title: "Cadena de mando" };

/**
 * Cadena de mando (decisiones 59 a 64): quién reporta a quién, cuánta gente tiene conectada cada mando y qué ve
 * cada persona. Debajo, el Staff de mando con la lista de ingreso y los cambios de emergencia.
 * Lo que aparece aquí ya viene filtrado por la base: un submando solo ve a su mando y a los suyos.
 */
export default async function CommandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx || !ctx.isTeam) notFound();
  const { event, user } = ctx;
  const closed = event.status === "closed";
  const full = seesAll(event.role, event.visibility);
  const level = event.level ?? 4;
  const isBackend = event.role === "backend";
  const canCommand = !closed && (isBackend || (full && level === 2));
  const canExport = full && level <= 2;
  const canReport = !closed && level <= 3;

  const [chain, areas, emergencies, access] = await Promise.all([
    getCommandChain(id),
    getAreas(id),
    getEmergencyChanges(id),
    canExport ? getAccessList(id).catch(() => []) : Promise.resolve([]),
  ]);
  return (
    <CommandView
      eventId={id}
      userId={user.id}
      timezone={event.timezone}
      full={full}
      isBackend={isBackend}
      canCommand={canCommand}
      canExport={canExport}
      canReport={canReport}
      chain={chain}
      areaNames={[...new Set([...areas.map((a) => a.name), ...SUGGESTED_AREAS])]}
      emergencies={emergencies}
      access={access}
    />
  );
}
