import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AssignToggle, PersonForm } from "@/components/operacion/planificacion";
import { Card, Empty, PageTitle, SectionTitle } from "@/components/operacion/ui";
import { DOC_STATE_LABEL, SUGGESTED_ROLES } from "@mando/core/planning";
import { getEventContext, getEventOrganization, getPeopleBoard, type CrewPerson } from "@/lib/data";

export const metadata: Metadata = { title: "Personal" };

function PersonRow({ p, children }: { p: CrewPerson; children?: React.ReactNode }) {
  const ok = p.docState === "vigente" && p.photoUrl;
  return (
    <div className="flex items-start gap-3">
      {p.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- enlace firmado de corta duración
        <img src={p.photoUrl} alt={`Foto de ${p.fullName}`} className="size-14 shrink-0 bg-surface-200 object-cover" />
      ) : (
        <div aria-hidden="true" className="grid size-14 shrink-0 place-items-center bg-surface-200 font-mono text-[10px] text-ink-muted">
          sin foto
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-snug">{p.fullName}</p>
        <p className="text-sm text-ink-muted">{p.role ?? p.defaultRole ?? "Sin rol"}</p>
        <p className={`mt-0.5 font-mono text-xs font-semibold uppercase tracking-wider ${ok ? "text-[#8fe0b8]" : "text-[#ff6f86]"}`}>
          {DOC_STATE_LABEL[p.docState]}
          {!p.photoUrl ? " · falta la foto" : ""}
        </p>
      </div>
      {children}
    </div>
  );
}

/** El personal del evento. Cada persona se registra una vez y en los siguientes eventos se elige con un check. */
export default async function CrewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx || !ctx.isTeam) notFound();
  const { event } = ctx;
  const canManage = event.level !== null && event.level <= 2 && event.status !== "closed";
  const [people, organizationId] = await Promise.all([getPeopleBoard(id), getEventOrganization(id)]);
  const assigned = people.filter((p) => p.assigned);
  const others = people.filter((p) => !p.assigned);

  return (
    <>
      <PageTitle aside={<span className="font-mono text-sm text-ink-muted">{assigned.length} en el evento</span>}>Personal</PageTitle>
      <p className="mb-2 mt-1 text-sm text-ink-muted">
        {canManage
          ? "Registra a cada persona una sola vez, con foto y DNI. En tus siguientes eventos solo la marcas con un check."
          : "La gente que va a este evento."}
      </p>

      <SectionTitle>En este evento</SectionTitle>
      {assigned.length === 0 ? (
        <Empty>Todavía no hay personal elegido.</Empty>
      ) : (
        <ul aria-label="Personal del evento" className="grid gap-2">
          {assigned.map((p) => (
            <li key={p.id} className="rounded-card bg-surface-100 p-4">
              <PersonRow p={p}>{canManage && <AssignToggle eventId={id} personId={p.id} name={p.fullName} assigned role={p.role} />}</PersonRow>
              {canManage && organizationId && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer font-medium text-ice-300">Corregir ficha de {p.fullName}</summary>
                  <div className="mt-3">
                    <PersonForm
                      eventId={id}
                      organizationId={organizationId}
                      roles={SUGGESTED_ROLES}
                      person={{ id: p.id, fullName: p.fullName, docNumber: p.docNumber ?? "", docExpiresOn: p.docExpiresOn ?? "", phone: p.phone ?? "", role: p.role ?? p.defaultRole ?? "" }}
                    />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && others.length > 0 && (
        <>
          <SectionTitle>Tu base de personas</SectionTitle>
          <p className="-mt-1 mb-2 text-xs text-ink-muted">Ya están registradas. Marca a quienes van a este evento.</p>
          <ul aria-label="Base de personas" className="grid gap-2">
            {others.map((p) => (
              <li key={p.id} className="rounded-card bg-surface-100 p-4">
                <PersonRow p={p}>
                  <AssignToggle eventId={id} personId={p.id} name={p.fullName} assigned={false} role={p.defaultRole} />
                </PersonRow>
              </li>
            ))}
          </ul>
        </>
      )}

      {canManage && organizationId && (
        <>
          <SectionTitle>Registrar a alguien nuevo</SectionTitle>
          <Card>
            <PersonForm eventId={id} organizationId={organizationId} roles={SUGGESTED_ROLES} />
          </Card>
        </>
      )}
    </>
  );
}
