import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LogList } from "@/components/operacion/blocks";
import { PageTitle } from "@/components/operacion/ui";
import { getEventContext, getLog } from "@/lib/data";

export const metadata: Metadata = { title: "Bitácora" };

export default async function LogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  const log = await getLog(id, 300);
  return (
    <>
      <PageTitle>Bitácora</PageTitle>
      <p className="mb-4 mt-1 text-sm text-ink-muted">
        Se actualiza en vivo. Ninguna entrada se edita ni se borra: si algo estuvo mal, se registra una corrección.
      </p>
      <LogList entries={log} timeZone={ctx.event.timezone} config={ctx.criticality} />
    </>
  );
}
