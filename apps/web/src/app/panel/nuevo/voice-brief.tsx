"use client";

import { useTransition } from "react";
import { briefFromVoice, type VoiceBriefResult } from "@/app/actions/ia";
import { playTap } from "@/components/operacion/pieza";
import { MicIcon, useDictation } from "./use-dictation";
import { AudioUpload } from "./audio-upload";

/** «Cuéntame tu brief»: un botón que pulsa, escucha y entrega el dictado a la IA para ordenarlo. */
export function VoiceBrief({ onResult }: { onResult: (r: Extract<VoiceBriefResult, { ok: true }>) => void }) {
  const dictation = useDictation();
  const { listening, heard, error, setError } = dictation;
  const [thinking, startThinking] = useTransition();

  function build(said: string) {
    startThinking(async () => {
      const r = await briefFromVoice(said);
      if (!r.ok) return setError(r.error);
      onResult(r);
    });
  }

  function finish() {
    const said = dictation.stop();
    if (!said) return setError("No alcancé a escucharte. Toca el micrófono y cuéntame tu evento.");
    build(said);
  }

  const upload = (
    <AudioUpload
      label="O sube un audio de WhatsApp con la idea"
      onText={(text) => {
        setError(null);
        build(text);
      }}
      disabled={thinking || listening}
    />
  );

  if (!dictation.supported)
    return (
      <div className="cuentame">
        <p className="cuentame-nota">
          Este navegador no deja dictar. Ábrelo en Chrome (computadora) o Safari (iPhone), o usa el micrófono del teclado para escribir el brief.
        </p>
        {upload}
      </div>
    );

  const live = `${heard.final} ${heard.interim}`.trim();
  return (
    <div className="cuentame">
      <button
        type="button"
        className="cuentame-boton"
        data-escucha={listening ? "" : undefined}
        aria-pressed={listening}
        disabled={thinking}
        onClick={() => {
          playTap(listening ? "down" : "up");
          if (listening) finish();
          else dictation.start();
        }}
      >
        <span aria-hidden className="cuentame-mic">
          <MicIcon />
        </span>
        <span className="cuentame-texto">
          <span className="block font-display text-xl font-bold leading-tight">
            {thinking ? "La IA está armando tu brief…" : listening ? "Te escucho… toca para terminar" : "Cuéntame tu brief"}
          </span>
          <span className="mt-0.5 block text-sm font-normal opacity-80">
            {thinking ? "Ordena lo que dijiste y marca los componentes." : listening ? "Habla con calma: qué, dónde, con quién y qué llega de fuera." : "Toca y explícale a la IA tu evento, como se lo contarías a tu equipo."}
          </span>
        </span>
      </button>
      {upload}
      {(listening || thinking) && live && (
        <p className="cuentame-vivo" aria-live="polite">
          {heard.final}
          {heard.interim && <span className="opacity-60"> {heard.interim}</span>}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-[#ff6f86]">
          {error}
        </p>
      )}
    </div>
  );
}
