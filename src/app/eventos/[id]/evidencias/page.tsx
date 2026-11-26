import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EvidenceGrid } from "@/components/operacion/blocks";
import { EvidenceUploader } from "@/components/operacion/evidence-uploader";
import { Card, PageTitle, SectionTitle } from "@/components/operacion/ui";
import { getEventContext, getEvidences } from "@/lib/data";

export const metadata: Metadata = { title: "Evidencias" };

export default async function EvidencesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  const evidences = await getEvidences(id);
  return (
    <>
      <PageTitle>Evidencias</PageTitle>
      <p className="mt-1 text-sm text-ink-muted">Cada evidencia guarda la hora del servidor y una huella que prueba que no se tocó.</p>
      {ctx.isTeam && (
        <>
          <SectionTitle>Nueva evidencia</SectionTitle>
          <Card>
            <EvidenceUploader eventId={id} />
          </Card>
        </>
      )}
      <SectionTitle>Registradas</SectionTitle>
      <EvidenceGrid items={evidences} timeZone={ctx.event.timezone} isTeam={ctx.isTeam} />
    </>
  );
}
