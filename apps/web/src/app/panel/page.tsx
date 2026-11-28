import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eyebrow, PanelShell, TierMeter } from "@/components/panel/kit";
import { Card, Empty, buttonPrimary } from "@/components/operacion/ui";
import { EventStatusText } from "@/components/pills";
import { getAdminOrgs, getCurrentUser, getMyLook, getMyOrgBrand, getMyEvents, getOrgRequests } from "@/lib/data";
import { MandoLockup } from "@/components/brand";
import { CustomizationForm, CustomizationStatusForm, OrgBrandForm } from "@/components/panel/marca";
import { REQUEST_STATUSES } from "@mando/core/command";
import { TIERS, type TierKey } from "@mando/core/event-types";
import { formatEventRange } from "@mando/core/time";

export const metadata: Metadata = { title: "Panel" };

/** Panel del productor general: aquí nacen los eventos y se reparte el mando. */
export default async function PanelPage() {
  const user = await getCurrentUser();
  const orgs = await getAdminOrgs(user.id);
  if (orgs.length === 0) redirect("/eventos"); // solo el productor general tiene panel
  const events = (await getMyEvents(user.id)).filter((e) => e.role === "backend");
  const brand = await getMyOrgBrand(user.id);
  const myOrg = brand?.isAdmin ? brand : null;
  const requests = myOrg ? await getOrgRequests(myOrg.id) : [];

  return (
    <PanelShell userName={user.fullName} brand={brand} face={(await getMyLook(user.id)).faceUrl}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>{orgs[0].name} · Productor general</Eyebrow>
          <h1 className="mt-2 font-display text-3xl font-semibold leading-tight">Tú repartes el mando.</h1>
          <p className="mt-2 max-w-xl text-ink-muted">
            Crea el evento, elige su tipo e invita a cada persona con su cargo. Nadie entra sin tu invitación.
          </p>
        </div>
        <Link href="/panel/nuevo" className={buttonPrimary}>
          Crear evento
        </Link>
      </div>

      <h2 className="mb-3 mt-10 font-display text-lg font-semibold">Tus eventos</h2>
      {events.length === 0 ? (
        <Empty>Todavía no creaste eventos. Empieza con «Crear evento».</Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {events.map((event) => (
            <li key={event.id}>
              <Link href={`/panel/${event.id}`} className="block h-full">
                <Card className="h-full transition-colors hover:bg-surface-200">
                  <div className="flex items-center justify-between gap-2">
                    <EventStatusText status={event.status} />
                    {event.tier && <TierMeter tier={event.tier} label={TIERS[event.tier as TierKey]?.nombre ?? event.tier} />}
                  </div>
                  <p className="mt-2 font-display text-lg font-semibold leading-snug">{event.name}</p>
                  <p className="mt-1 text-sm text-ink-muted">{[event.eventType, event.clientName].filter(Boolean).join(" · ")}</p>
                  <p className="mt-1 font-mono text-sm text-ink-muted">{formatEventRange(event.startsAt, event.endsAt, event.timezone)}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {myOrg && (
        <section className="mt-12" aria-labelledby="mi-mando">
          <h2 id="mi-mando" className="font-display text-lg font-semibold">
            Tu mando de marca
          </h2>
          <p className="mt-1 max-w-xl text-sm text-ink-muted">
            MANDO firma con el nombre y el logo de tu agencia o unidad: así lo ve todo tu equipo arriba de cada pantalla.
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <Eyebrow>Así se ve</Eyebrow>
              <div className="mt-3 rounded-card bg-[#07080c] px-4 py-4">
                <MandoLockup brand={myOrg} />
              </div>
              <div className="mt-4">
                <OrgBrandForm orgId={myOrg.id} brandName={myOrg.brandName} parentName={myOrg.parentName} hasLogo={Boolean(myOrg.logoPath)} />
              </div>
            </Card>
            <Card>
              <Eyebrow>Pedidos especiales de este mando</Eyebrow>
              <p className="mt-2 text-sm text-ink-muted">
                Lo que esta agencia quiere distinto (por ejemplo, priorizar sus palabras). Cada pedido se cotiza y, si se cobra, queda marcado.
              </p>
              <div className="mt-4">
                <CustomizationForm orgId={myOrg.id} />
              </div>
              {requests.length > 0 && (
                <ul className="mt-5 space-y-3">
                  {requests.map((r) => (
                    <li key={r.id} className="border-t border-line pt-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{r.title}</p>
                        <span className="senal font-mono text-xs uppercase tracking-[0.12em]">
                          {REQUEST_STATUSES.find((s) => s.clave === r.status)?.nombre ?? r.status}
                          {r.billable ? " · se cobra" : " · sin costo"}
                        </span>
                      </div>
                      {r.detail && <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">{r.detail}</p>}
                      {r.quoteNote && <p className="mt-1 text-sm text-gold-500">{r.quoteNote}</p>}
                      <CustomizationStatusForm requestId={r.id} status={r.status} billable={r.billable} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </section>
      )}
    </PanelShell>
  );
}
