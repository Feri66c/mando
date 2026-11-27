"use client";

import { useEffect, useState } from "react";
import { countdown } from "@mando/core/requirements";

const two = (n: number) => String(n).padStart(2, "0");

/** Reloj grande del plazo: cuenta regresiva a la fecha tope de los documentos (48 horas antes del evento). */
export function DeadlineClock({ capIso, capLabel, pending }: { capIso: string; capLabel: string; pending: number }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(new Date()), 0);
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  const c = now ? countdown(capIso, now) : null;
  const tone = pending === 0 ? "var(--ok)" : !c ? "var(--gold-300)" : c.past || c.days < 3 ? "var(--critical)" : c.days < 8 ? "var(--naranja)" : "var(--gold-300)";
  return (
    <div className="plazo" style={{ "--tono": tone } as React.CSSProperties} data-urgente={pending > 0 && c && (c.past || c.days < 3) ? "" : undefined}>
      <p className="plazo-rotulo">
        <i aria-hidden />
        {pending === 0 ? "Expediente completo" : c?.past ? "El plazo tope ya pasó hace" : "El plazo se cierra en"}
      </p>
      <p className="plazo-reloj" role="timer" aria-live="off" suppressHydrationWarning>
        {c ? (
          <>
            <span>{c.days}</span>
            <small>{c.days === 1 ? "día" : "días"}</small>
            <span>
              {two(c.hours)}:{two(c.minutes)}:{two(c.seconds)}
            </span>
          </>
        ) : (
          <span>--:--:--</span>
        )}
      </p>
      <p className="plazo-nota">
        Fecha tope: <strong>{capLabel}</strong>. No es el día del evento: los documentos cierran 48 horas antes.
      </p>
    </div>
  );
}

/** Aviso al entrar: «No olvides, te quedan N días». Una vez por visita y por evento. */
export function DeadlineReminder({ eventId, capIso, capLabel, pending, mandatoryPending }: { eventId: string; capIso: string; capLabel: string; pending: number; mandatoryPending: number }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  useEffect(() => {
    if (pending === 0) return;
    const key = `mando-plazo-${eventId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // sin memoria del navegador: el aviso sale igual
    }
    const c = countdown(capIso, new Date());
    const first = setTimeout(() => {
      setText(
        c.past
          ? `El plazo tope venció hace ${c.days === 0 ? "menos de 1 día" : c.days === 1 ? "1 día" : `${c.days} días`}.`
          : c.days === 0
            ? "Te queda menos de 1 día de plazo."
            : `Te ${c.days === 1 ? "queda 1 día" : `quedan ${c.days} días`} de plazo.`,
      );
      setOpen(true);
    }, 0);
    return () => clearTimeout(first);
  }, [eventId, capIso, pending]);
  if (!open) return null;
  return (
    <div className="aviso-fondo" role="dialog" aria-modal="true" aria-labelledby="aviso-plazo-titulo">
      <div className="aviso">
        <p className="aviso-eyebrow">No olvides</p>
        <p id="aviso-plazo-titulo" className="aviso-titulo">{text}</p>
        <p className="aviso-texto">
          Faltan <strong>{pending}</strong> {pending === 1 ? "documento" : "documentos"}
          {mandatoryPending > 0 ? `, ${mandatoryPending} no ${mandatoryPending === 1 ? "negociable" : "negociables"}` : ""}. La fecha tope es {capLabel}, 48 horas antes del evento. MANDO anota
          la presión en la bitácora.
        </p>
        <button type="button" autoFocus onClick={() => setOpen(false)} className="inline-flex min-h-14 w-full items-center justify-center rounded-full bg-gold-500 px-5 text-base font-semibold text-navy-950">
          Entendido, tengo el mando
        </button>
      </div>
    </div>
  );
}

/** Cuenta regresiva al evento, para «Hoy». */
export function EventCountdown({ startsAt, label }: { startsAt: string; label: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(new Date()), 0);
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  const c = now ? countdown(startsAt, now) : null;
  if (c?.past) return null;
  const tone = !c ? "var(--gold-300)" : c.days < 2 ? "var(--critical)" : c.days < 8 ? "var(--naranja)" : "var(--gold-300)";
  return (
    <div className="plazo" style={{ "--tono": tone } as React.CSSProperties} data-urgente={c && c.days < 2 ? "" : undefined}>
      <p className="plazo-rotulo">
        <i aria-hidden />
        Faltan para el evento
      </p>
      <p className="plazo-reloj" role="timer" aria-live="off" suppressHydrationWarning>
        {c ? (
          <>
            <span>{c.days}</span>
            <small>{c.days === 1 ? "día" : "días"}</small>
            <span>
              {two(c.hours)}:{two(c.minutes)}:{two(c.seconds)}
            </span>
          </>
        ) : (
          <span>--:--:--</span>
        )}
      </p>
      <p className="plazo-nota">{label}</p>
    </div>
  );
}
