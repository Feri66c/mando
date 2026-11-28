import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revokeInvitation } from "@/app/actions/panel";
import { Eyebrow, LevelBadge, PanelShell, PieceChain, TierMeter } from "@/components/panel/kit";
import { Card, Empty, buttonGhost, buttonSecondary } from "@/components/operacion/ui";
import { getAreas, getBrief, getBriefDocuments, getBriefDoubts, getCurrentUser, getEventTemplate, getMyEvent, getPendingInvitations, getTeam } from "@/lib/data";
import { SUGGESTED_AREAS } from "@mando/core/command";
import { DEFAULT_CARGOS, LEVEL_LABEL, TIERS, invitationMessage, type TierKey } from "@mando/core/event-types";
import { formatDate, formatTime } from "@mando/core/time";
import { BriefForm, DoubtAnswer } from "./brief-panel";
import { CopyButton, InviteForm, SendInviteButton } from "./invite-form";
import { canSendMail } from "@/lib/mail";

export const metadata: Metadata = { title: "Equipo del evento" };
// La IA procesa el brief, busca en internet y arma el Excel: puede tardar unos minutos.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Equipo del evento: jerarquía, invitaciones pendientes y el formulario para invitar. */
export default async function EventTeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ creado?: string }>;
}) {
  const { id } = await params;
  const { creado } = await searchParams;
  if (!UUID.test(id)) notFound();
  const user = await getCurrentUser();
  const event = await getMyEvent(id, user.id);
  if (!event) notFound();
  if (event.role !== "backend") redirect(`/eventos/${id}`); // solo el productor general arma el equipo

  const [areas, { template }, team, invitations, brief, doubts, briefDocuments, headerList] = await Promise.all([
    getAreas(id).catch(() => []),
    getEventTemplate(id),
    getTeam(id),
    getPendingInvitations(id),
    getBrief(id, user.id),
    getBriefDoubts(id),
    getBriefDocuments(id).catch(() => []),
    headers(),
  ]);
  const cargos = template?.cargos ?? [...DEFAULT_CARGOS];
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const mailReady = canSendMail();
  const linkFor = (email: string) => `${proto}://${host}/ingresar?correo=${encodeURIComponent(email)}`;

  return (
    <PanelShell userName={user.fullName}>
      <Link href="/panel" className="text-sm text-ink-muted hover:text-ink">
        ← Panel
      </Link>

      {creado && (
        <p role="status" className="mt-4 bg-gold-500/15 px-4 py-3 text-sm">
          Evento creado con {template?.piezas.length ?? 0} piezas. Ahora invita a tu equipo y al cliente.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow>
            {event.eventType ?? "Evento"}
            {event.clientName ? ` · ${event.clientName}` : ""}
          </Eyebrow>
          <h1 className="mt-2 font-display text-3xl font-semibold leading-tight">{event.name}</h1>
          {event.startsAt && (
            <p className="mt-2 font-mono text-sm text-ink-muted">
              {template?.hora_clave ?? "Inicio"}: {formatDate(event.startsAt, event.timezone)} · {formatTime(event.startsAt, event.timezone)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {event.tier && <TierMeter tier={event.tier} label={`Tamaño ${TIERS[event.tier as TierKey]?.nombre ?? event.tier}`} />}
          <Link href={`/eventos/${id}`} className={buttonSecondary}>
            Abrir el evento
          </Link>
        </div>
      </div>

      {template && (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-lg font-semibold">Piezas del evento</h2>
          <PieceChain pieces={template.piezas} />
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-1 font-display text-lg font-semibold">Brief del evento</h2>
        <p className="mb-3 text-sm text-ink-muted">
          Es lo primero que lee cada persona del equipo después de aceptar su cargo. Sin confirmar que está enterada, no toma el mando.
        </p>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <BriefForm eventId={id} brief={brief} documents={briefDocuments} />
          </Card>
          <div>
            <h3 className="mb-2 font-mono text-xs uppercase tracking-[0.14em] text-ink-muted">
              Dudas del equipo · {doubts.filter((d) => d.status === "open").length} por responder
            </h3>
            {doubts.length === 0 ? (
              <Empty>Nadie dejó dudas sobre el brief.</Empty>
            ) : (
              <ul className="space-y-2">
                {doubts.map((d) => (
                  <li key={d.id}>
                    <Card className={d.status === "open" ? "border border-gold-500/60" : ""}>
                      <p className="font-mono text-xs uppercase tracking-wider text-ink-muted">
                        {d.who} · {d.status === "open" ? "Espera tu respuesta" : "Respondida"}
                      </p>
                      <p className="mt-1 text-lg font-medium">«{d.question}»</p>
                      {d.status === "open" ? <DoubtAnswer doubt={d} /> : <p className="mt-2 text-sm text-ink-muted">Respondiste: {d.answer}</p>}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <section>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-lg font-semibold">Equipo con el mando activo</h2>
              <Link href={`/eventos/${id}/mando`} className="text-sm font-medium underline underline-offset-4">
                Ver la cadena de mando
              </Link>
            </div>
            <ul className="space-y-2" aria-label="Equipo">
              {team.map((m) => (
                <li
                  key={m.profileId}
                  className="flex items-center gap-3 bg-surface-100 p-3"
                  style={{ marginLeft: m.level ? `${(m.level - 1) * 16}px` : 0 }}
                >
                  <LevelBadge level={m.level} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display font-semibold">{m.fullName}</p>
                    <p className="text-sm text-ink-muted">
                      {m.title ?? (m.level ? LEVEL_LABEL[m.level] : "Cliente")}
                      {m.level ? ` · Nivel ${m.level}` : " · Solo mira"}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-xs uppercase tracking-wider text-ink-muted">
                    {m.welcomedAt ? "Activo" : "Sin entrar"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-8">
            <h2 className="mb-3 font-display text-lg font-semibold">Invitaciones por activar</h2>
            {invitations.length === 0 ? (
              <Empty>No hay invitaciones pendientes.</Empty>
            ) : (
              <ul className="space-y-2" aria-label="Invitaciones pendientes">
                {invitations.map((inv) => {
                  const message = invitationMessage({
                    name: inv.fullName,
                    inviter: user.fullName,
                    eventName: event.name,
                    cargo: inv.title,
                    link: linkFor(inv.email),
                  });
                  return (
                    <li key={inv.id}>
                      <Card>
                        <div className="flex items-center gap-3">
                          <LevelBadge level={inv.level} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-display font-semibold">{inv.fullName}</p>
                            <p className="truncate text-sm text-ink-muted">
                              {inv.title} · {inv.email}
                            </p>
                          </div>
                        </div>
                        <p className="mt-3 bg-surface-000 p-3 text-sm text-ink-muted">{message}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <CopyButton text={message} />
                          <a
                            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
                            target="_blank"
                            rel="noreferrer"
                            className={buttonGhost}
                          >
                            Enviar por WhatsApp
                          </a>
                          <SendInviteButton
                            invitationId={inv.id}
                            direct={mailReady}
                            mailto={`mailto:${inv.email}?subject=${encodeURIComponent(`Te invitaron a ${event.name} en MANDO`)}&body=${encodeURIComponent(message)}`}
                          />
                          <form action={revokeInvitation} className="ml-auto">
                            <input type="hidden" name="invitacion" value={inv.id} />
                            <button type="submit" className="min-h-11 px-3 text-sm font-medium text-ink-muted underline-offset-4 hover:underline">
                              Retirar
                            </button>
                          </form>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <section className="min-w-0">
          <h2 className="mb-3 font-display text-lg font-semibold">Invita a alguien</h2>
          <Card>
            <InviteForm
              eventId={id}
              areas={[...new Set([...areas.map((a) => a.name), ...SUGGESTED_AREAS])]}
              team={team.filter((m) => m.role !== "viewer").map((m) => ({ profileId: m.profileId, fullName: m.fullName, title: m.title }))}
              cargos={cargos.map((c) => ({ cargo: c.cargo, nivel: c.nivel, descripcion: c.nivel ? (LEVEL_LABEL[c.nivel] === c.cargo ? `Nivel ${c.nivel}` : `Nivel ${c.nivel} · ${LEVEL_LABEL[c.nivel]}`) : "Solo mira en vivo" }))}
            />
          </Card>
          <p className="mt-3 text-sm text-ink-muted">
            La persona entra con su correo y un código de 6 dígitos que MANDO le manda en ese momento. Solo funciona para
            correos invitados.
          </p>
        </section>
      </div>
    </PanelShell>
  );
}
