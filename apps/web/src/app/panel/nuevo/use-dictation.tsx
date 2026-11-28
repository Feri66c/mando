"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

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

/** Dictado en español de Perú que sigue escuchando aunque el navegador corte tras un silencio. */
export function useDictation() {
  const canDictate = useSyncExternalStore(
    () => () => {},
    () => recognitionCtor() !== null,
    () => true,
  );
  const [blocked, setBlocked] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState({ final: "", interim: "" });
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const finalText = useRef("");
  const interimText = useRef("");

  useEffect(
    () => () => {
      wanted.current = false;
      rec.current?.abort();
    },
    [],
  );

  function start() {
    const Ctor = recognitionCtor();
    if (!Ctor) return setBlocked(true);
    setError(null);
    finalText.current = "";
    interimText.current = "";
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
      interimText.current = interim;
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

  /** Termina y devuelve todo lo que se entendió. */
  function stop(): string {
    wanted.current = false;
    rec.current?.stop();
    setListening(false);
    return `${finalText.current} ${interimText.current}`.trim();
  }

  return { supported: canDictate && !blocked, listening, heard, error, setError, start, stop };
}

/** El micrófono rojo de MANDO: late en reposo y lanza ondas mientras escucha. */
export function MicIcon({ size = 30 }: { size?: number }) {
  // Ícono de voz MANDO (decisión 96): una onda viva de cinco barras. Mientras se graba, las barras
  // bailan (ver .onda-voz en globals.css); en reposo respiran despacio.
  const bars = [
    { x: 3, h: 6 },
    { x: 7.5, h: 12 },
    { x: 12, h: 18 },
    { x: 16.5, h: 12 },
    { x: 21, h: 6 },
  ];
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="onda-voz" aria-hidden>
      {bars.map((b, i) => (
        <rect key={i} className={`onda-barra onda-${i}`} x={b.x - 1.4} y={12 - b.h / 2} width="2.8" height={b.h} rx="1.4" fill="currentColor" />
      ))}
    </svg>
  );
}
