import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TalentBank, TalentForm, TalentImport } from "@/components/operacion/talentos";
import { Card, PageTitle, SectionTitle, buttonGhost } from "@/components/operacion/ui";
import { TALENT_CATEGORIES, plain } from "@mando/core/talents";
import { getApprovalGroups, getEventContext, getEventOrganization, getTalentBank } from "@/lib/data";

export const metadata: Metadata = { title: "Banco de talentos" };

/**
 * Banco de talentos (decisiones 55 a 58): las personas no se guardan para un evento, se guardan para siempre.
 * Cada una se reconoce por su documento y vuelve con su foto y su mini ficha. Tiene datos personales:
 * solo lo ven el productor general y el productor de campo (niveles 1 y 2).
 */
export default async function TalentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx || !ctx.isTeam || ctx.event.level === null || ctx.event.level > 2) notFound();
  const { event } = ctx;
  const closed = event.status === "closed";
  const [talents, organizationId, groups] = await Promise.all([getTalentBank(id), getEventOrganization(id), getApprovalGroups(id)]);
  const seen = new Set(TALENT_CATEGORIES.map(plain));
  for (const t of talents) for (const c of t.categories) seen.add(c);
  const categories = [...seen];
  const inCasting = talents.filter((t) => t.inCasting).length;

  return (
    <>
      <PageTitle aside={<span className="font-mono text-sm text-ink-muted">{talents.length} en el banco</span>}>Banco de talentos</PageTitle>
      <p className="mb-3 mt-1 text-sm text-ink-muted">
        Aquí no trabajas para un evento: guardas a tu gente. Escribe su documento otra vez y vuelve con su foto y su ficha.
        {groups.includes("casting") ? ` ${inCasting} ya ${inCasting === 1 ? "está" : "están"} en el casting de este evento.` : ""}
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        <a href={`/eventos/${id}/talentos/exportar`} className={buttonGhost}>
          Exportar a Excel (CSV)
        </a>
        <Link href={`/eventos/${id}/aprobaciones`} className={buttonGhost}>
          Ver el casting
        </Link>
      </div>

      <TalentBank eventId={id} talents={talents} categories={categories} canCast={!closed} />

      {!closed && organizationId && (
        <>
          <SectionTitle>Registrar un talento</SectionTitle>
          <Card>
            <TalentForm eventId={id} organizationId={organizationId} categories={categories} />
          </Card>
          <SectionTitle>Ingresar una lista</SectionTitle>
          <Card>
            <TalentImport eventId={id} categories={categories} />
          </Card>
        </>
      )}
      <p className="mt-6 text-xs text-ink-muted">
        Los documentos y celulares solo los ven el productor general y el productor de campo. El cliente ve la foto y la mini ficha de quienes están en el casting de su evento, nunca su documento.
      </p>
    </>
  );
}
