import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { signOut } from "@/app/actions/auth";
import { PageTitle, buttonGhost } from "@/components/operacion/ui";
import { ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/core/labels";
import { getEventContext } from "@/lib/data";

export const metadata: Metadata = { title: "Más" };

export default async function MorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  const { event, user, isTeam } = ctx;
  const base = `/eventos/${id}`;
  const links = [
    { href: `${base}/bitacora`, label: "Bitácora", hint: "Todo lo que pasó, minuto a minuto. No se edita ni se borra." },
    { href: `${base}/evidencias`, label: "Evidencias", hint: "Fotos, audios, videos y documentos con hora del servidor." },
    ...(isTeam ? [{ href: `${base}/momentos`, label: "Momentos críticos", hint: "Prueba de sonido, montaje, puertas: prometido contra entregado." }] : []),
    { href: "/eventos", label: "Mis eventos", hint: "Cambiar de evento." },
  ];
  return (
    <>
      <PageTitle>Más</PageTitle>
      <ul className="mt-4 grid gap-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="block min-h-14 rounded-card bg-surface-100 px-4 py-3 hover:bg-surface-200">
              <span className="block font-semibold">{l.label}</span>
              <span className="block text-sm text-ink-muted">{l.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-6 rounded-card border border-line p-4 text-sm">
        <p className="font-semibold">
          {user.fullName} · {ROLE_LABEL[event.role]}
        </p>
        <p className="mt-1 text-ink-muted">{ROLE_DESCRIPTION[event.role]}</p>
        <form action={signOut} className="mt-3">
          <button type="submit" className={buttonGhost}>
            Salir
          </button>
        </form>
      </div>
    </>
  );
}
