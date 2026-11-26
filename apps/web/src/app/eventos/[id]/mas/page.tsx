import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { signOut } from "@/app/actions/auth";
import { PageTitle, buttonGhost } from "@/components/operacion/ui";
import { ROLE_DESCRIPTION, ROLE_LABEL } from "@mando/core/labels";
import { seesAll, visibilityLabel } from "@mando/core/command";
import { getEventContext } from "@/lib/data";

export const metadata: Metadata = { title: "Más" };

export default async function MorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx) notFound();
  const { event, user, isTeam } = ctx;
  const base = `/eventos/${id}`;
  const isBackend = event.role === "backend";
  const express = [
    { href: base, label: "MANDO Express", hint: "El estado de tu evento y tus avisos." },
    { href: `${base}/aprobaciones`, label: "Aprobaciones", hint: "Casting, uniforme, utilería y referencias que te toca aprobar." },
    { href: `${base}/presupuesto`, label: "Presupuesto", hint: "El monto de tu evento, para aprobarlo o pedir un cambio." },
    { href: `${base}/aprendizajes`, label: "Ficha de satisfacción", hint: "Cuéntanos qué impresión te deja el evento." },
    { href: "/eventos", label: "Mis eventos", hint: "Cambiar de evento." },
  ];
  const team = [
    ...(isBackend ? [{ href: `${base}/backend`, label: "Backend", hint: "Instrucciones al productor, avisos al cliente, plazo y lo que espera tu revisión." }] : []),
    { href: `${base}/mando`, label: "Cadena de mando", hint: "Mando central y submandos: quién reporta a quién, qué ve cada uno, lista de ingreso y cambios de emergencia." },
    { href: `${base}/cierre`, label: "Estrellas y cierre", hint: "Cómo va el evento, los no negociables y el informe para guardar en PDF." },
    { href: `${base}/aprendizajes`, label: isTeam ? "Aprendizajes" : "Ficha de satisfacción", hint: isTeam ? "Lo que te llevas de este evento, en seis puntos." : "Cuéntanos qué impresión te deja el evento." },
    { href: `${base}/planificacion`, label: "Planificación", hint: "Los 5 elementos: legal, personal, técnico, presupuesto y aprobaciones. Desbloquean el timeline." },
    { href: `${base}/aprobaciones`, label: "Aprobaciones", hint: "Casting, uniforme, utilería y referencias: el cliente aprueba antes de empezar." },
    ...(isTeam && event.level !== null && event.level <= 2
      ? [{ href: `${base}/talentos`, label: "Banco de talentos", hint: "Tu gente guardada por documento, con foto y mini ficha. Del banco al casting con un toque." }]
      : []),
    ...(isTeam
      ? [
          { href: `${base}/tiempos`, label: "Tiempos", hint: "Estima cuánto toma cada actividad. MANDO avisa lo que no cuadra y recomienda márgenes." },
          { href: `${base}/expediente`, label: "Expediente", hint: "Documentos por subir: seguros, permisos, contratos, facturas. Con plazo y aviso." },
          { href: `${base}/locacion`, label: "Locación", hint: "Punto de encuentro, mapa, transporte y antecedentes del lugar." },
        ]
      : []),
    ...(isTeam ? [{ href: `${base}/citados`, label: "Citados", hint: "Hosts e invitados: recordatorio por WhatsApp o correo y hora de llegada." }] : []),
    { href: `${base}/bitacora`, label: "Bitácora", hint: "Todo lo que pasó, minuto a minuto. No se edita ni se borra." },
    { href: `${base}/evidencias`, label: "Evidencias", hint: "Fotos, audios, videos y documentos con hora del servidor." },
    ...(isTeam ? [{ href: `${base}/momentos`, label: "Momentos críticos", hint: "Prueba de sonido, montaje, puertas: prometido contra entregado." }] : []),
    { href: "/eventos", label: "Mis eventos", hint: "Cambiar de evento." },
  ];
  // Submando (decisión 60): ve su mando y lo que le toca. Lo demás no aparece, y la base tampoco se lo entrega.
  const full = isTeam && seesAll(event.role, event.visibility);
  const submando = [
    { href: `${base}/mando`, label: "Mi mando", hint: "A quién reportas, tu gente y los cambios de emergencia." },
    { href: `${base}/locacion`, label: "Locación", hint: "Punto de encuentro, mapa, transporte y antecedentes del lugar." },
    { href: `${base}/tecnico`, label: "Lista técnica", hint: "Los equipos y documentos técnicos del evento." },
    { href: `${base}/expediente`, label: "Mis documentos", hint: "Los documentos que te toca subir." },
    { href: `${base}/evidencias`, label: "Evidencias", hint: "Tus fotos, audios y videos, y los de tus actividades." },
    { href: `${base}/momentos`, label: "Momentos críticos", hint: "Prueba de sonido, montaje, puertas: prometido contra entregado." },
    { href: `${base}/bitacora`, label: "Bitácora", hint: "Lo que pasó en tu mando. No se edita ni se borra." },
    { href: `${base}/aprendizajes`, label: "Aprendizajes", hint: "Lo que te llevas de este evento, en seis puntos." },
    { href: "/eventos", label: "Mis eventos", hint: "Cambiar de evento." },
  ];
  const links = !isTeam ? express : full ? team : submando;
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
          {user.fullName} · {event.title ?? ROLE_LABEL[event.role]}
        </p>
        {isTeam && <p className="mt-1 font-mono text-xs uppercase tracking-wider text-gold-300">Ves: {visibilityLabel(event.role === "backend" ? "completa" : event.visibility)}</p>}
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
