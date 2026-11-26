"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { takeControl } from "@/app/actions/panel";
import { Logo } from "@/components/brand";
import { buttonPrimary } from "@/components/operacion/ui";

type Props = {
  eventId: string;
  firstName: string;
  inviter: string | null;
  eventName: string;
  typeLabel: string;
  cargo: string;
  isViewer: boolean;
  keyLabel: string;
  keyTimeIso: string | null;
  dateText: string | null;
  timeText: string | null;
  zone: string;
  pieces: number;
  mandatories: { titulo: string; detalle: string }[];
};

const VIEWER_PROMISES = [
  { titulo: "Ves cada movimiento en vivo", detalle: "La hoja de ruta se actualiza sola, minuto a minuto. No necesitas llamar." },
  { titulo: "Si algo cambia, te enteras primero", detalle: "Cualquier ajuste al horario aparece aquí con su hora nueva." },
  { titulo: "Las alertas que te tocan llegan a ti", detalle: "Solo lo que afecta lo que te prometieron. Sin ruido." },
];

/** Cuánto falta para la hora clave: «2 d 03:15:20», o null si ya pasó. */
function remaining(targetMs: number, nowMs: number): string | null {
  const s = Math.floor((targetMs - nowMs) / 1000);
  if (s <= 0) return null;
  const d = Math.floor(s / 86400);
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = `${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return d > 0 ? `${d} d ${clock}` : clock;
}

type Stage = "gracias" | "reglas" | "reto" | "cuenta" | "accion";

export function Welcome(props: Props) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("gracias");
  const [count, setCount] = useState(3);
  const [now, setNow] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const target = props.keyTimeIso ? new Date(props.keyTimeIso).getTime() : null;
  const rules = props.isViewer ? VIEWER_PROMISES : props.mandatories;

  // Al cambiar de paso, el título recibe el foco: los lectores de pantalla anuncian el paso nuevo.
  useEffect(() => {
    headingRef.current?.focus();
  }, [stage]);

  // Cuenta regresiva 3, 2, 1 y arranca el reloj.
  useEffect(() => {
    if (stage !== "cuenta") return;
    if (count === 0) {
      const t = setTimeout(() => setStage("accion"), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setCount((c) => c - 1), 800);
    return () => clearTimeout(t);
  }, [stage, count]);

  // En «acción» corre el reloj y, a los pocos segundos, se abre el evento.
  useEffect(() => {
    if (stage !== "accion") return;
    const first = setTimeout(() => setNow(Date.now()), 0);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const go = setTimeout(() => router.replace(`/eventos/${props.eventId}`), 3600);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
      clearTimeout(go);
    };
  }, [stage, router, props.eventId]);

  async function start() {
    setBusy(true);
    setError(null);
    const result = await takeControl(props.eventId);
    if (!result.ok) {
      setBusy(false);
      setError(result.error ?? "No se pudo tomar el mando. Intenta de nuevo.");
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) setStage("accion");
    else {
      setCount(3);
      setStage("cuenta");
    }
  }

  const eyebrow = "font-mono text-xs uppercase tracking-[0.16em] text-gold-300";
  const title = "mt-3 font-display text-4xl font-bold leading-[1.02] outline-none sm:text-5xl";
  const left = target !== null && now !== null ? remaining(target, now) : null;

  return (
    <div className="tema-operacion flex min-h-dvh flex-col">
      <header className="mx-auto w-full max-w-md px-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <Logo className="h-9 w-auto" />
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-8">
        {stage === "gracias" && (
          <section className="flex flex-1 flex-col motion-safe:animate-[entrada_.5s_ease-out]">
            <p className={eyebrow}>Invitación activada</p>
            <h1 ref={headingRef} tabIndex={-1} className={title}>
              Gracias, {props.firstName}, por sumarte a MANDO.
            </h1>
            <p className="mt-4 text-lg text-ink-muted">
              {props.inviter ? `${props.inviter} te ` : "Te "}
              {props.isViewer ? "invitó a ver esta experiencia en vivo." : "dio el mando de esta experiencia."}
            </p>

            <div className="corte mt-6 bg-surface-100 p-5">
              <p className="font-display text-2xl font-semibold leading-tight">{props.eventName}</p>
              <dl className="mt-4 space-y-2 text-sm">
                {props.dateText && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-muted">Fecha</dt>
                    <dd className="text-right font-medium">{props.dateText}</dd>
                  </div>
                )}
                {props.timeText && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-muted">{props.keyLabel}</dt>
                    <dd className="text-right font-mono font-medium">
                      {props.timeText} <span className="text-ink-muted">· {props.zone}</span>
                    </dd>
                  </div>
                )}
                {props.typeLabel && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-muted">Tipo</dt>
                    <dd className="text-right font-medium">{props.typeLabel}</dd>
                  </div>
                )}
              </dl>
              <p className="mt-4 inline-block bg-gold-300 px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-navy-950">
                {props.isViewer ? "Estás invitado como" : "Tu cargo"}: {props.cargo}
              </p>
            </div>

            <button type="button" onClick={() => setStage(rules.length > 0 ? "reglas" : "reto")} className={`${buttonPrimary} mt-auto w-full`}>
              Continuar
            </button>
          </section>
        )}

        {stage === "reglas" && (
          <section className="flex flex-1 flex-col motion-safe:animate-[entrada_.5s_ease-out]">
            <p className={eyebrow}>{props.isViewer ? "Así funciona" : "Antes de empezar"}</p>
            <h1 ref={headingRef} tabIndex={-1} className={title}>
              {props.isViewer ? "No necesitas llamar a nadie." : "Esto no se negocia."}
            </h1>
            <ul className="mt-6 space-y-2">
              {rules.map((m) => (
                <li key={m.titulo} className="corte flex gap-3 bg-surface-100 p-4">
                  <span aria-hidden="true" className={`mt-0.5 font-mono text-lg leading-none ${props.isViewer ? "text-ice-300" : "text-[#ff8f7a]"}`}>
                    {props.isViewer ? "○" : "✕"}
                  </span>
                  <div>
                    <p className="font-medium leading-snug">{m.titulo}</p>
                    <p className="mt-0.5 text-sm text-ink-muted">{m.detalle}</p>
                  </div>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setStage("reto")} className={`${buttonPrimary} mt-auto w-full`}>
              {props.isViewer ? "Continuar" : "Entendido"}
            </button>
          </section>
        )}

        {stage === "reto" && (
          <section className="flex flex-1 flex-col motion-safe:animate-[entrada_.5s_ease-out]">
            <p className={eyebrow}>{props.isViewer ? "Tu lugar en primera fila" : "Tu reto"}</p>
            <h1 ref={headingRef} tabIndex={-1} className={title}>
              {props.isViewer ? "Todo lo que pase, lo verás aquí." : "Producción impecable. Buen People Experience."}
            </h1>
            <p className="mt-4 text-lg text-ink-muted">
              {props.isViewer
                ? "Cuando entres, el reloj del evento ya estará corriendo para ti."
                : props.pieces > 0
                  ? `${props.pieces} piezas hasta el cierre. Cada hito a tiempo suma estrellas. Cuando tomes el mando, el cliente verá tu reloj.`
                  : "Cada hito a tiempo suma estrellas. Cuando tomes el mando, el cliente verá tu reloj."}
            </p>
            {error && (
              <p role="alert" className="mt-4 border border-critical/40 bg-critical/10 px-3 py-2 text-sm">
                {error}
              </p>
            )}
            <button type="button" onClick={start} disabled={busy} className={`${buttonPrimary} mt-auto min-h-14 w-full text-lg uppercase tracking-wide`}>
              {busy ? "Un momento…" : props.isViewer ? "Entrar a ver en vivo" : "Tomar el mando"}
            </button>
          </section>
        )}

        {stage === "cuenta" && (
          <section className="grid flex-1 place-items-center" aria-live="assertive">
            <h1 ref={headingRef} tabIndex={-1} className="sr-only">
              Empieza en
            </h1>
            <p key={count} className="font-display text-[11rem] font-bold leading-none text-gold-300 motion-safe:animate-[golpe_.8s_ease-out]">
              {count > 0 ? count : ""}
            </p>
          </section>
        )}

        {stage === "accion" && (
          <section className="flex flex-1 flex-col justify-center motion-safe:animate-[entrada_.4s_ease-out]" aria-live="polite">
            <p className="inline-block self-start bg-critical px-2.5 py-1 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white">
              En acción
            </p>
            <h1 ref={headingRef} tabIndex={-1} className={title}>
              Se inició la acción.
            </h1>
            {target !== null && (
              <div className="mt-8">
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink-muted">
                  {left ? `Faltan para: ${props.keyLabel.toLowerCase()}` : props.keyLabel}
                </p>
                <p className="mt-2 font-mono text-5xl font-medium tabular-nums sm:text-6xl" suppressHydrationWarning>
                  {left ?? (now === null ? "--:--:--" : "Ya empezó")}
                </p>
                <div className="mt-5 h-1 bg-surface-200">
                  <div className="h-full w-full origin-left bg-gold-300 shadow-[0_0_14px_var(--gold-300)] motion-safe:animate-[barra_3.6s_linear]" />
                </div>
              </div>
            )}
            <p className="mt-6 text-ink-muted">Abriendo {props.eventName}…</p>
          </section>
        )}
      </main>
    </div>
  );
}
