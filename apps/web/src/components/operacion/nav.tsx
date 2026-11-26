"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const TABS = [
  { key: "hoy", label: "Hoy", path: "", icon: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { key: "ruta", label: "Hoja de ruta", path: "/hoja-de-ruta", icon: "M4 6h16M4 12h16M4 18h10" },
  { key: "alertas", label: "Alertas", path: "/alertas", icon: "M12 4 2.5 20h19zM12 10v4m0 3v.5" },
  { key: "mas", label: "Más", path: "/mas", icon: "M5 12h.01M12 12h.01M19 12h.01" },
];

/** Barra inferior flotante en forma de píldora, con cuatro pestañas. */
export function BottomNav({ eventId, openAlerts }: { eventId: string; openAlerts: number }) {
  const pathname = usePathname();
  const base = `/eventos/${eventId}`;
  const active = (path: string) => {
    if (path === "") return pathname === base || pathname === `${base}/`;
    if (path === "/mas") return ["/mas", "/bitacora", "/momentos", "/evidencias", "/cierre", "/citados", "/expediente", "/locacion", "/aprobaciones", "/planificacion", "/personal", "/tecnico", "/presupuesto"].some((p) => pathname.startsWith(base + p));
    if (path === "/hoja-de-ruta") return pathname.startsWith(base + path) || pathname.startsWith(`${base}/actividad`);
    return pathname.startsWith(base + path);
  };
  return (
    <nav
      aria-label="Secciones del evento"
      className="barra-inferior fixed inset-x-3 z-30 mx-auto max-w-md rounded-full border border-line bg-[#0b1f3a]/95 p-1.5 shadow-2xl backdrop-blur"
    >
      <ul className="grid grid-cols-4">
        {TABS.map((t) => {
          const on = active(t.path);
          return (
            <li key={t.key}>
              <Link
                href={base + t.path}
                aria-current={on ? "page" : undefined}
                className={`relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-full px-1 text-[11px] font-semibold ${
                  on ? "bg-surface-200 text-ink" : "text-ink-muted"
                }`}
              >
                <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={t.key === "mas" ? 3 : 1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d={t.icon} />
                </svg>
                {t.label}
                {t.key === "alertas" && openAlerts > 0 && (
                  <span className="absolute right-3 top-1 min-w-5 rounded-full bg-[#ff7a5c] px-1 text-center font-mono text-[10px] leading-5 text-navy-950">
                    {openAlerts}
                    <span className="sr-only"> alertas abiertas</span>
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
        <ul className="absolute bottom-16 right-0 w-64 overflow-hidden rounded-card border border-line bg-surface-100 shadow-2xl" role="menu">
          {options.map((o) => (
            <li key={o.label} role="none">
              <Link role="menuitem" href={o.href} className="block min-h-12 px-4 py-3 hover:bg-surface-200">
                <span className="block font-semibold">{o.label}</span>
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
        className="flex size-14 items-center justify-center rounded-full border-2 border-ink bg-surface-200 text-3xl font-light text-ink shadow-2xl"
      >
        <span aria-hidden className={`transition-transform ${open ? "rotate-45" : ""}`}>+</span>
      </button>
    </div>
  );
}
