import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eyebrow, PanelShell } from "@/components/panel/kit";
import { getAdminOrgs, getCurrentUser, getMyLook, getMyOrgBrand, getCustomTypes } from "@/lib/data";
import { EVENT_TEMPLATES, TIERS } from "@mando/core/event-types";
import { NewEventForm } from "./new-event-form";

export const metadata: Metadata = { title: "Crear evento" };

export default async function NewEventPage() {
  const user = await getCurrentUser();
  const orgs = await getAdminOrgs(user.id);
  if (orgs.length === 0) redirect("/eventos");
  const savedTypes = await getCustomTypes(orgs[0].id);

  return (
    <PanelShell userName={user.fullName} brand={await getMyOrgBrand(user.id)} face={(await getMyLook(user.id)).faceUrl}>
      <Link href="/panel" className="text-sm text-ink-muted hover:text-ink">
        ← Panel
      </Link>
      <Eyebrow className="mt-4">Paso 1 de 2</Eyebrow>
      <h1 className="mt-2 font-display text-3xl font-semibold leading-tight">Crea el evento.</h1>
      <p className="mt-2 max-w-xl text-ink-muted">
        Elige el tipo y MANDO arma las piezas de la hoja de ruta. Después las puedes ajustar.
      </p>
      <div className="mt-8">
        <NewEventForm organizationId={orgs[0].id} templates={[...EVENT_TEMPLATES]} tiers={TIERS} savedTypes={savedTypes} />
      </div>
    </PanelShell>
  );
}
