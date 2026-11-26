"use client";

// El control grande de tiempos (decisión 34): se arrastra para decir cuánto toma una actividad
// y se guarda solo al soltar.
import { useEffect, useRef, useState } from "react";
import { setEstimateAction } from "@/app/actions/planificacion";
import { DURATION_STEPS, formatDuration, marginFor, nearestStep } from "@mando/core/timeline";

export function DurationDial({ itemId, title, planned, estimated, canEdit }: { itemId: string; title: string; planned: number; estimated: number | null; canEdit: boolean }) {
  const [index, setIndex] = useState(() => nearestStep(estimated ?? planned));
  const [saved, setSaved] = useState<number | null>(estimated);
  const [note, setNote] = useState<{ tone: "ok" | "error" | "working"; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const minutes = DURATION_STEPS[index]!;
  const touched = saved !== null || minutes !== DURATION_STEPS[nearestStep(planned)];

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function move(next: number) {
    setIndex(next);
    if (timer.current) clearTimeout(timer.current);
    const value = DURATION_STEPS[next]!;
    if (value === saved) return;
    setNote({ tone: "working", text: "Guardando…" });
    timer.current = setTimeout(async () => {
      const result = await setEstimateAction(itemId, value);
      if (result.ok) {
        setSaved(value);
        setNote({ tone: "ok", text: "Guardado" });
      } else {
        setNote({ tone: "error", text: result.error ?? "No se pudo guardar." });
      }
    }, 600);
  }

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-3">
        <output aria-live="polite" className={`whitespace-nowrap font-mono text-3xl font-semibold leading-none ${touched ? "text-gold-300" : "text-ink-muted"}`}>
          {formatDuration(minutes)}
        </output>
        <span className="text-right text-xs text-ink-muted">
          {saved === null ? "Sugerido por el plan" : "Tu estimación"}
          <br />
          <span className="font-mono">+ {formatDuration(marginFor(minutes))}</span> de margen
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={DURATION_STEPS.length - 1}
        step={1}
        value={index}
        disabled={!canEdit}
        onChange={(e) => move(Number(e.target.value))}
        aria-label={`Tiempo de ${title}`}
        aria-valuetext={formatDuration(minutes)}
        className="mando-dial mt-4 w-full"
      />
      <div aria-hidden className="mt-1 flex justify-between font-mono text-[11px] text-ink-muted">
        <span>{formatDuration(DURATION_STEPS[0]!)}</span>
        <span>{formatDuration(DURATION_STEPS[DURATION_STEPS.length - 1]!)}</span>
      </div>
      {note && (
        <p role={note.tone === "error" ? "alert" : "status"} className={`mt-1 text-xs ${note.tone === "error" ? "text-[#ff8f7a]" : note.tone === "ok" ? "text-[#8fe0b8]" : "text-ink-muted"}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}
