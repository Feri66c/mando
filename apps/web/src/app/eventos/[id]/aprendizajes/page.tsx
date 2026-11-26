import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LearningsForm, SatisfactionForm } from "@/components/operacion/cierre";
import { Card, Empty, PageTitle, SectionTitle } from "@/components/operacion/ui";
import { CLIENT_QUESTION, LEARNINGS_COUNT, LEARNINGS_HINTS, LEARNINGS_LAST_QUESTION, firstName } from "@mando/core/learnings";
import { getEventContext, getFeedbackBoard, getMyFeedback } from "@/lib/data";

export const metadata: Metadata = { title: "Aprendizajes" };

/** Encuesta de cierre: el equipo deja sus aprendizajes y el cliente su ficha de satisfacción. */
export default async function LearningsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  const { event, user, isTeam } = ctx;
  const name = firstName(user.fullName);
  const canReadAll = isTeam && event.level !== null && event.level <= 2;
  const [mine, board] = await Promise.all([getMyFeedback(id, user.id), canReadAll ? getFeedbackBoard(id) : Promise.resolve([])]);
  const learnings = board.filter((r) => r.kind === "learnings");
  const satisfaction = board.filter((r) => r.kind === "satisfaction");

  return (
    <>
      <PageTitle>{isTeam ? `Tus aprendizajes, ${name}.` : `Tu impresión, ${name}.`}</PageTitle>
      <p className="mb-4 mt-1 text-sm text-ink-muted">
        {isTeam
          ? `${event.name}. Hasta ${LEARNINGS_COUNT} cosas que te llevas de este evento. Las leen el productor general y el productor de campo.`
          : `${event.name}. Tu ficha la lee el equipo de producción para hacerlo mejor la próxima vez.`}
      </p>
      <Card>
        {isTeam ? (
          <LearningsForm eventId={id} count={LEARNINGS_COUNT} hints={LEARNINGS_HINTS} lastQuestion={LEARNINGS_LAST_QUESTION} current={mine?.kind === "learnings" ? mine : null} />
        ) : (
          <SatisfactionForm eventId={id} question={CLIENT_QUESTION} current={mine?.kind === "satisfaction" ? mine : null} />
        )}
      </Card>

      {canReadAll && (
        <>
          <SectionTitle>Ficha del cliente</SectionTitle>
          {satisfaction.length === 0 ? (
            <Empty>El cliente todavía no llena su ficha.</Empty>
          ) : (
            <ul aria-label="Ficha del cliente" className="grid gap-2">
              {satisfaction.map((r) => (
                <li key={r.name} className="rounded-card bg-surface-100 p-4">
                  <p className="font-medium">{r.name}</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-gold-300">{r.stars} de 5</p>
                  {r.extra && <p className="mt-1 text-sm text-ink-muted">{r.extra}</p>}
                </li>
              ))}
            </ul>
          )}

          <SectionTitle>Lo que aprendió el equipo</SectionTitle>
          {learnings.length === 0 ? (
            <Empty>Nadie del equipo ha dejado aprendizajes todavía.</Empty>
          ) : (
            <ul aria-label="Aprendizajes del equipo" className="grid gap-2">
              {learnings.map((r) => (
                <li key={r.name} className="rounded-card bg-surface-100 p-4">
                  <p className="font-medium">
                    {r.name}
                    {r.title && <span className="ml-2 text-xs font-normal text-ink-muted">{r.title}</span>}
                  </p>
                  <ol className="mt-2 grid list-decimal gap-1 pl-5 text-sm">
                    {r.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>
                  {r.extra && <p className="mt-2 text-sm text-ink-muted">{r.extra}</p>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
