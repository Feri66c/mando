"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { briefFromVoice, type VoiceBriefResult } from "@/app/actions/ia";
import { playTap } from "@/components/operacion/pieza";

// El dictado lo hace el propio navegador (Chrome en la computadora, Safari en el iPhone):
// el audio no pasa por MANDO, solo el texto que el navegador entendió.
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const MIC_ERRORS: Record<string, string> = {
  "not-allowed": "El navegador no dio permiso al micrófono. Toca el candado junto a la dirección, permite el micrófono y vuelve a intentar.",
  "service-not-allowed": "El navegador no dio permiso al micrófono. Toca el candado junto a la dirección, permite el micrófono y vuelve a intentar.",
  "audio-capture": "No encontré un micrófono. Revisa que esté conectado.",
  network: "Para dictar se necesita internet. Revisa la conexión y vuelve a intentar.",
};

/** «Cuéntame tu brief»: un botón que pulsa, escucha y entrega el dictado a la IA para ordenarlo. */
export function VoiceBrief({ onResult }: { onResult: (r: Extract<VoiceBriefResult, { ok: true }>) => void }) {
  const canDictate = useSyncExternalStore(
    () => () => {},
    () => recognitionCtor() !== null,
    () => true,
  );
  const [blocked, setBlocked] = useState(false);
  const supported = canDictate && !blocked;
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState({ final: "", interim: "" });
  const [error, setError] = useState<string | null>(null);
  const [thinking, startThinking] = useTransition();
  const rec = useRef<Recognition | null>(null);
  const wanted = useRef(false); // el productor sigue hablando: si el navegador corta, se reanuda
  const finalText = useRef("");

  useEffect(() => {
    return () => {
      wanted.current = false;
      rec.current?.abort();
    };
  }, []);

  function begin() {
    const Ctor = recognitionCtor();
    if (!Ctor) return setBlocked(true);
    setError(null);
    finalText.current = "";
    setHeard({ final: "", interim: "" });
    const r = new Ctor();
    r.lang = "es-PE";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const piece = e.results[i];
        if (piece.isFinal) finalText.current = `${finalText.current} ${piece[0].transcript}`.trim();
        else interim += piece[0].transcript;
      }
      setHeard({ final: finalText.current, interim });
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      wanted.current = false;
      setListening(false);
      setError(MIC_ERRORS[e.error] ?? "El dictado se cortó. Toca el micrófono para seguir.");
    };
    r.onend = () => {
      if (wanted.current) {
        try {
          r.start(); // Safari y Chrome cortan tras un silencio: seguimos escuchando
          return;
        } catch {
          /* cae abajo */
        }
      }
      setListening(false);
    };
    rec.current = r;
    wanted.current = true;
    try {
      r.start();
      setListening(true);
    } catch {
      wanted.current = false;
      setError("No pude abrir el micrófono. Intenta de nuevo.");
    }
  }

  function finish() {
    wanted.current = false;
    rec.current?.stop();
    setListening(false);
    const said = `${finalText.current} ${heard.interim}`.trim();
    if (!said) return setError("No alcancé a escucharte. Toca el micrófono y cuéntame tu evento.");
    startThinking(async () => {
      const r = await briefFromVoice(said);
      if (!r.ok) return setError(r.error);
      onResult(r);
    });
  }

  if (!supported)
    return (
      <p className="cuentame-nota">
        Este navegador no deja dictar. Ábrelo en Chrome (computadora) o Safari (iPhone), o usa el micrófono del teclado para escribir el brief.
      </p>
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
          else begin();
        }}
      >
        <span aria-hidden className="cuentame-mic">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
          </svg>
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
