"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/brand";
import { playTap } from "./pieza";

/** Flecha de la cabecera: dentro del evento vuelve a «Hoy»; solo desde «Hoy» sale a Mis eventos. */
export function EventBack({ eventId }: { eventId: string }) {
  const path = usePathname();
  const home = `/eventos/${eventId}`;
  const atHome = path === home;
  return (
    <Link href={atHome ? "/eventos" : home} className="flex min-h-11 items-center gap-3" aria-label={atHome ? "Volver a Mis eventos" : "Volver a Hoy, en este evento"}>
      <span aria-hidden className="text-2xl text-ink-muted">←</span>
      <Logo className="h-10 w-auto" />
    </Link>
  );
}

export type MesaPiece = { key: string; name: string; route: string; done: boolean; open: boolean };

/**
 * La mesa (decisión 78): las cinco piezas de la planificación siempre a la mano.
 * Aparece en la planificación y dentro de cada pieza, para pasar de una a otra sin salir ni volver.
 */
export function Mesa({ eventId, pieces }: { eventId: string; pieces: MesaPiece[] }) {
  const path = usePathname();
  const base = `/eventos/${eventId}`;
  const current = pieces.find((p) => path === `${base}/${p.route}` || path.startsWith(`${base}/${p.route}/`));
  if (!current && path !== `${base}/planificacion`) return null;
  return (
    <nav aria-label="Piezas de la planificación" className="mesa">
      <ol>
        {pieces.map((p, i) => {
          const active = current?.key === p.key;
          const inner = (
            <>
              <span aria-hidden className="mesa-numero">{p.done ? "✓" : i + 1}</span>
              <span className="mesa-nombre">{p.name}</span>
            </>
          );
          return (
            <li key={p.key}>
              {p.open ? (
                <Link href={`${base}/${p.route}`} className="mesa-pieza" data-activa={active ? "" : undefined} data-lista={p.done ? "" : undefined} aria-current={active ? "page" : undefined}>
                  {inner}
                </Link>
              ) : (
                <span className="mesa-pieza" data-cerrada="">{inner}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Sonido de tablero en todos los botones del evento: sube al presionar, baja al soltar. */
export function TapSounds() {
  useEffect(() => {
    const SELECTOR = "button, a.rounded-full, a.mesa-pieza, summary";
    let pressed = false;
    const down = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.(SELECTOR);
      if (!el || el.closest(".pieza") || (el as HTMLButtonElement).disabled) return;
      pressed = true;
      playTap("up");
    };
    const up = () => {
      if (!pressed) return;
      pressed = false;
      playTap("down");
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
    };
  }, []);
  return null;
}
