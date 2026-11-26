"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Iconos propios (decisión 38): rectos, con esquina viva.
const TABS = [
  { key: "hoy", label: "Hoy", path: "", icon: <><path d="M12 2.5 L20.5 7.2 V16.8 L12 21.5 L3.5 16.8 V7.2 Z" /><path d="M12 9 L15 12 L12 15 L9 12 Z" fill="currentColor" /></> },
  { key: "ruta", label: "Hoja de ruta", path: "/hoja-de-ruta", icon: <><path d="M3 4 H11 L13 8 H21 V14 H13 L11 10 H3 Z" /><path d="M3 15 H10 L12 19 H21" /></> },
  { key: "alertas", label: "Alertas", path: "/alertas", icon: <><path d="M8 2.5 H16 L21.5 8 V16 L16 21.5 H8 L2.5 16 V8 Z" /><path d="M12 7 V13" /><path d="M12 16.5 V17" /></> },
  { key: "mas", label: "Más", path: "/mas", icon: <><path d="M4 4 H10 V10 H4 Z" /><path d="M14 4 H20 V10 H14 Z" /><path d="M4 14 H10 V20 H4 Z" /><path d="M17 13.5 L20.5 17 L17 20.5 L13.5 17 Z" fill="currentColor" /></> },
];

/** Barra inferior: una sola pieza de mando con cuatro pestañas. */
export function BottomNav({ eventId, openAlerts }: { eventId: string; openAlerts: number }) {
  const pathname = usePathname();
  const base = `/eventos/${eventId}`;
  const active = (path: string) => {
    if (path === "") return pathname === base || pathname === `${base}/`;
    if (path === "/mas") return ["/mas", "/bitacora", "/momentos", "/evidencias", "/cierre", "/citados", "/expediente", "/locacion", "/aprobaciones", "/planificacion", "/personal", "/tecnico", "/presupuesto", "/tiempos", "/aprendizajes"].some((p) => pathname.startsWith(base + p));
    if (path === "/hoja-de-ruta") return pathname.startsWith(base + path) || pathname.startsWith(`${base}/actividad`);
    return pathname.startsWith(base + path);
  };
  return (
    <nav aria-label="Secciones del evento" className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-2xl">
      <ul className="barra-mando grid grid-cols-4 bg-[#0c1f3d] pb-[env(safe-area-inset-bottom)]">
        {TABS.map((t) => {
          const on = active(t.path);
          return (
            <li key={t.key}>
              <Link
                href={base + t.path}
                aria-current={on ? "page" : undefined}
                className={`relative flex min-h-[72px] flex-col items-center justify-center gap-1 px-1 text-[12.5px] ${on ? "font-semibold text-gold-300" : "font-medium text-[#d5e2f0]"}`}
              >
                <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square" strokeLinejoin="miter">
                  {t.icon}
                </svg>
                {t.label}
                {t.key === "alertas" && openAlerts > 0 && (
                  <span className="absolute left-[56%] top-2.5 flex size-5 rotate-45 items-center justify-center bg-critical font-mono text-xs font-semibold text-white">
                    <span className="-rotate-45">
                      {openAlerts}
                      <span className="sr-only"> alertas abiertas</span>
                    </span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Botón «+» flotante: crea según el contexto (evidencia, cambio, alerta, momento crítico). */
export function PlusButton({ eventId }: { eventId: string }) {
  const pathname = usePathname();
  // El menú se cierra solo al cambiar de pantalla: queda abierto solo en la ruta donde se abrió.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (value: boolean | ((v: boolean) => boolean)) =>
    setOpenAt((prev) => ((typeof value === "function" ? value(prev === pathname) : value) ? pathname : null));
  const ref = useRef<HTMLDivElement>(null);
  const base = `/eventos/${eventId}`;
  const itemMatch = pathname.match(/\/actividad\/([0-9a-f-]{36})/);
  const momentMatch = pathname.match(/\/momentos\/([0-9a-f-]{36})/);
  const evidenceHref = itemMatch
    ? `${base}/actividad/${itemMatch[1]}#evidencia`
    : momentMatch
      ? `${base}/momentos/${momentMatch[1]}#evidencia`
      : `${base}/evidencias#evidencia`;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpenAt(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpenAt(null);
    document.addEventListener("click", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const options = [
    { label: "Evidencia", hint: "Foto, audio, video o documento", href: evidenceHref },
    { label: "Cambio", hint: "«Dame una hora más»", href: itemMatch ? `${base}/actividad/${itemMatch[1]}#cambio` : `${base}/hoja-de-ruta` },
    { label: "Alerta", hint: "Reporta un problema", href: `${base}/alertas#reportar` },
    { label: "Momento crítico", hint: "Prueba de sonido, montaje, puertas…", href: `${base}/momentos#nuevo` },
  ];

  return (
    <div ref={ref} className="boton-mas fixed right-4 z-40">
      {open && (
        <ul className="absolute bottom-16 right-0 w-64 overflow-hidden rounded-card bg-surface-200" role="menu">
          {options.map((o) => (
            <li key={o.label} role="none">
              <Link role="menuitem" href={o.href} className="block min-h-12 px-4 py-3 hover:bg-surface-300">
                <span className="block font-display font-semibold">{o.label}</span>
                <span className="block text-xs text-ink-muted">{o.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        aria-label={open ? "Cerrar menú de crear" : "Crear: evidencia, cambio, alerta o momento crítico"}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="hexagono flex h-14 w-16 items-center justify-center bg-gold-300 text-3xl font-light text-navy-950"
      >
        <span aria-hidden className={`transition-transform ${open ? "rotate-45" : ""}`}>+</span>
      </button>
    </div>
  );
}
