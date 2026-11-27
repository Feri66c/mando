"use client";

import Link from "next/link";
import { useRef, useState } from "react";

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };
let audio: AudioContext | null = null;

/**
 * Sonido de tablero: un toque corto que sube al presionar y baja al soltar.
 * Se genera en el teléfono (no hay archivo de audio) y suena muy bajo. Si el navegador no deja, no pasa nada.
 */
export function playTap(direction: "up" | "down") {
  try {
    const Ctor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!Ctor) return;
    audio ??= new Ctor();
    if (audio.state === "suspended") void audio.resume();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const [from, to] = direction === "up" ? [520, 880] : [760, 440];
    osc.type = "sine";
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + 0.07);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.07, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  } catch {
    // sin sonido: la pantalla sigue igual
  }
}

/** Pieza del tablero: se enciende y sobresale al presionarla, con su sonido de subida y bajada. */
export function Pieza({
  href,
  label,
  done = false,
  children,
}: {
  href?: string;
  label?: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  const [pressed, setPressed] = useState(false);
  const down = useRef(false);
  const press = () => {
    down.current = true;
    setPressed(true);
    playTap("up");
  };
  const release = () => {
    if (!down.current) return;
    down.current = false;
    setPressed(false);
    playTap("down");
  };
  const props = {
    className: "pieza",
    "data-presionada": pressed ? "" : undefined,
    "data-lista": done ? "" : undefined,
  };
  if (!href) return <div {...props} data-cerrada="">{children}</div>;
  return (
    <Link href={href} aria-label={label} {...props} onPointerDown={press} onPointerUp={release} onPointerLeave={release} onPointerCancel={release}>
      {children}
    </Link>
  );
}
