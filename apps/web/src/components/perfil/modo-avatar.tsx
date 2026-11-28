"use client";

// Modo avatar (decisión 96): si la pantalla del evento queda 2 minutos sin tocar, aparece tu avatar
// moviéndose con el reloj del evento y lo que viene. Un toque y vuelves al tablero.
// Regla: una alerta nueva rompe el modo avatar al instante. El protector nunca esconde un problema.

import { useEffect, useRef, useState } from "react";
import { LiveClock } from "@/components/operacion/live";
import { playTap } from "@/components/operacion/pieza";
import { Cara } from "./cara";

const IDLE_MS = 2 * 60 * 1000;

export function ModoAvatar({
  face,
  name,
  eventName,
  timeZone,
  next,
  openAlerts,
  alertKey,
}: {
  face: string | null;
  name: string;
  eventName: string;
  timeZone: string;
  next: { title: string; time: string } | null;
  openAlerts: number;
  alertKey: string;
}) {
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAlertKey = useRef(alertKey);

  useEffect(() => {
    const arm = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (document.visibilityState === "visible") setIdle(true);
      }, IDLE_MS);
    };
    const wake = () => {
      setIdle(false);
      arm();
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    document.addEventListener("visibilitychange", wake);
    arm();
    return () => {
      for (const e of events) window.removeEventListener(e, wake);
      document.removeEventListener("visibilitychange", wake);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Entra una alerta nueva: se acaba el modo avatar.
  useEffect(() => {
    const before = new Set(lastAlertKey.current.split(",").filter(Boolean));
    const isNew = alertKey.split(",").some((id) => id && !before.has(id));
    lastAlertKey.current = alertKey;
    if (isNew) setIdle(false);
  }, [alertKey]);

  if (!idle) return null;
  const firstName = name.split(" ")[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Modo avatar. Toca para volver."
      className="modo-avatar"
      onPointerDown={() => {
        playTap("down");
        setIdle(false);
      }}
    >
      <div className="modo-avatar-escena">
        <div className="modo-avatar-figura">
          <span aria-hidden className="modo-avatar-aura" />
          <Cara url={face} name={name} size={196} className="cara-grande" />
        </div>
        <p className="mt-6 font-display text-3xl font-bold uppercase tracking-wide">{firstName} al mando</p>
        <p className="mt-1 text-lg text-ink-muted">{eventName}</p>
        <LiveClock timeZone={timeZone} className="reloj-evento mt-5 block" />
        {next && (
          <p className="mt-4 font-display text-xl font-semibold">
            <span className="luz-naranja font-mono">{next.time}</span> · {next.title}
          </p>
        )}
        {openAlerts > 0 && (
          <p className="modo-avatar-alerta mt-5">
            {openAlerts === 1 ? "1 alerta abierta" : `${openAlerts} alertas abiertas`}
          </p>
        )}
        <p className="mt-8 font-mono text-sm uppercase tracking-[0.2em] text-ink-muted">Toca para volver</p>
      </div>
    </div>
  );
}
