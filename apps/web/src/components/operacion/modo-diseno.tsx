"use client";

import { useState } from "react";
import { setDesignMode } from "@/app/actions/documento-ia";
import { buttonPrimary, buttonSecondary } from "./ui";

/** Interruptor del backend: mientras se diseña, nada bloquea; con «Listo, activa» todo vuelve a vigilar. */
export function DesignModeToggle({ eventId, on }: { eventId: string; on: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={`modo-diseno ${on ? "modo-diseno-on" : ""}`}>
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em]">{on ? "Modo diseño · encendido" : "Modo diseño"}</p>
      <p className="mt-1 text-sm">
        {on
          ? "Las red flags, los vencidos y los retrasos están en pausa, y la planificación no bloquea el timeline. Puedes avanzar con casillas en blanco."
          : "Enciéndelo para recorrer el evento completo mientras lo diseñas: pausa las alertas automáticas y los candados. Queda en la bitácora."}
      </p>
      <button
        type="button"
        disabled={busy}
        className={`${on ? buttonPrimary : buttonSecondary} mt-3`}
        onClick={async () => {
          setBusy(true);
          const r = await setDesignMode(eventId, !on);
          setError(r.ok ? null : r.error);
          setBusy(false);
        }}
      >
        {busy ? "Guardando…" : on ? "Listo, activa" : "Encender modo diseño"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-[#ffd3c9]">
          {error}
        </p>
      )}
    </div>
  );
}

/** Aviso en las pantallas del evento mientras el modo diseño está encendido. */
export function DesignModeBanner() {
  return (
    <p className="modo-diseno-banda" role="status">
      <span className="modo-diseno-punto" aria-hidden /> Modo diseño · alertas automáticas y candados en pausa
    </p>
  );
}
