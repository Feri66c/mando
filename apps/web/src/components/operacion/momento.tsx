"use client";

import { useRef, useState } from "react";
import { markMomentAction } from "@/app/actions/operacion";
import { MAX_EVIDENCE_BYTES, evidencePath, sha256Hex } from "@mando/core/evidence";
import { getBrowserClient } from "@/lib/supabase/browser";
import { buttonGhost, buttonPrimary, inputClass } from "./ui";

type Tag = "wow" | "eventualidad";
type Status = { kind: "idle" } | { kind: "working"; text: string } | { kind: "ok"; text: string } | { kind: "error"; text: string };

/**
 * Momento wow y Eventualidad, de un toque (decisión 67).
 * Momento wow: abre la cámara, se guarda la foto y el cliente la ve. Eventualidad: una línea de lo que pasó, solo para el equipo.
 * Los dos quedan marcados para el cierre del evento.
 */
export function MomentButtons({ eventId }: { eventId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [tag, setTag] = useState<Tag | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const open = (next: Tag) => {
    setTag(next);
    setStatus({ kind: "idle" });
    if (next === "wow") fileRef.current?.click(); // el toque abre la cámara directo
  };
  const close = () => {
    setTag(null);
    setFile(null);
    setCapturedAt(null);
    setNote("");
    if (fileRef.current) fileRef.current.value = "";
  };

  async function save() {
    if (!tag) return;
    if (tag === "eventualidad" && !note.trim()) return setStatus({ kind: "error", text: "Cuenta en una línea qué pasó." });
    if (tag === "wow" && !file && !note.trim()) return setStatus({ kind: "error", text: "Toma la foto del momento." });
    try {
      let filePath: string | null = null;
      let sha: string | null = null;
      if (file) {
        if (file.size > MAX_EVIDENCE_BYTES) throw new Error("El archivo pesa más de 50 MB.");
        setStatus({ kind: "working", text: "Subiendo la foto…" });
        sha = await sha256Hex(await file.arrayBuffer());
        const supabase = getBrowserClient();
        if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
        filePath = evidencePath(eventId, crypto.randomUUID(), file.name);
        const { error } = await supabase.storage.from("evidences").upload(filePath, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if (error) throw new Error(/row-level|policy|permission/i.test(error.message) ? "No tienes permiso para subir fotos aquí." : `No se pudo subir: ${error.message}`);
      }
      setStatus({ kind: "working", text: "Guardando…" });
      const result = await markMomentAction({ eventId, tag, note, filePath, sha256: sha, capturedAt: capturedAt ?? new Date().toISOString() });
      if (!result.ok) throw new Error(result.error ?? "No se pudo guardar.");
      setStatus({ kind: "ok", text: result.message ?? "Guardado." });
      close();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Algo falló.";
      setStatus({ kind: "error", text: /failed to fetch|network/i.test(message) ? "Sin señal: intenta de nuevo cuando vuelva la conexión." : message });
    }
  }

  const working = status.kind === "working";
  return (
    <div className="space-y-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Foto del momento"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f);
          setCapturedAt(f ? new Date().toISOString() : null);
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => open("wow")}
          aria-pressed={tag === "wow"}
          className="corte flex min-h-[72px] flex-col items-start justify-center bg-gold-300 px-4 text-left text-navy-950"
        >
          <span className="font-display text-lg font-bold leading-none">Momento wow</span>
          <span className="mt-1 text-xs font-medium">Foto de un toque. La ve el cliente.</span>
        </button>
        <button
          type="button"
          onClick={() => open("eventualidad")}
          aria-pressed={tag === "eventualidad"}
          className="corte flex min-h-[72px] flex-col items-start justify-center border border-[var(--naranja)] bg-surface-100 px-4 text-left"
        >
          <span className="font-display text-lg font-bold leading-none text-[var(--naranja)]">Eventualidad</span>
          <span className="mt-1 text-xs text-ink-muted">Algo no previsto. Solo el equipo.</span>
        </button>
      </div>

      {tag && (
        <div className="rounded-card bg-surface-100 p-4">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink-muted">{tag === "wow" ? "Momento wow" : "Eventualidad"}</p>
          {file ? (
            <p className="mt-2 text-sm">
              <span className="font-semibold">Foto lista:</span> {file.name}
            </p>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} className={`${buttonGhost} mt-2`}>
              {tag === "wow" ? "Tomar la foto" : "Agregar una foto (opcional)"}
            </button>
          )}
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-ink-muted">{tag === "wow" ? "Qué pasó (opcional)" : "Qué pasó"}</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              className={inputClass}
              placeholder={tag === "wow" ? "La entrada del artista" : "Se cortó la luz dos minutos"}
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={save} disabled={working} className={`${buttonPrimary} flex-1`}>
              {working ? status.text : "Guardar"}
            </button>
            <button type="button" onClick={close} disabled={working} className={buttonGhost}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {status.kind === "error" && (
        <p role="alert" className="rounded-2xl bg-[#3a1620] px-3 py-2 text-sm text-[#ffd3c9]">
          {status.text}
        </p>
      )}
      {status.kind === "ok" && (
        <p role="status" className="text-sm text-[#8fe0b8]">
          {status.text}
        </p>
      )}
    </div>
  );
}
