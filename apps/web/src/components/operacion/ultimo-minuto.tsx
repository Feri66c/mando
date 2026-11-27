"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { lastMinuteAction } from "@/app/actions/operacion";
import { LAST_MINUTE_KINDS, MAX_EVIDENCE_BYTES, evidencePath, sha256Hex } from "@mando/core/evidence";
import { getBrowserClient } from "@/lib/supabase/browser";
import { buttonGhost, buttonPrimary, inputClass } from "./ui";

type Status = { kind: "idle" } | { kind: "working"; text: string } | { kind: "ok"; text: string; goTo: string | null; goName: string } | { kind: "error"; text: string };

/**
 * Último minuto (decisión 80): un botón grande. Se elige qué llegó, se cuenta en una línea y, si hay, se adjunta el comprobante.
 * Todo queda en la bitácora marcado como «Último minuto», para evidenciar las eventualidades del evento.
 */
export function UltimoMinuto({ eventId }: { eventId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const chosen = LAST_MINUTE_KINDS.find((k) => k.clave === kind) ?? null;

  const reset = () => {
    setOpen(false);
    setKind(null);
    setNote("");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  async function save() {
    if (!chosen) return;
    if (!note.trim()) return setStatus({ kind: "error", text: "Cuenta en una línea qué llegó de último minuto." });
    try {
      let filePath: string | null = null;
      let sha: string | null = null;
      if (file) {
        if (file.size > MAX_EVIDENCE_BYTES) throw new Error("El archivo pesa más de 50 MB.");
        setStatus({ kind: "working", text: "Subiendo el comprobante…" });
        sha = await sha256Hex(await file.arrayBuffer());
        const supabase = getBrowserClient();
        if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
        filePath = evidencePath(eventId, crypto.randomUUID(), file.name);
        const { error } = await supabase.storage.from("evidences").upload(filePath, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if (error) throw new Error(/row-level|policy|permission/i.test(error.message) ? "No tienes permiso para subir archivos aquí." : `No se pudo subir: ${error.message}`);
      }
      setStatus({ kind: "working", text: "Anotando en la bitácora…" });
      const result = await lastMinuteAction({ eventId, kind: chosen.clave, note, filePath, sha256: sha, capturedAt: new Date().toISOString() });
      if (!result.ok) throw new Error(result.error ?? "No se pudo guardar.");
      setStatus({ kind: "ok", text: result.message ?? "Anotado.", goTo: chosen.ir_a, goName: chosen.nombre });
      reset();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Algo falló.";
      setStatus({ kind: "error", text: /failed to fetch|network/i.test(message) ? "Sin señal: intenta de nuevo cuando vuelva la conexión." : message });
    }
  }

  const working = status.kind === "working";
  return (
    <div>
      <button type="button" onClick={() => { setOpen(true); setStatus({ kind: "idle" }); }} className="ultimo-minuto" aria-haspopup="dialog">
        <span aria-hidden className="ultimo-minuto-icono">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="square">
            <path d="M12 2.5 L21.5 12 L12 21.5 L2.5 12 Z" />
            <path d="M12 7.5 V12.5 H15.5" />
          </svg>
        </span>
        <span className="min-w-0 text-left">
          <span className="block font-display text-2xl font-bold leading-none">Último minuto</span>
          <span className="mt-1 block text-sm font-medium opacity-80">Lo que llegó a última hora. Queda en la bitácora.</span>
        </span>
      </button>

      {status.kind === "ok" && (
        <p role="status" className="mt-2 text-sm text-ok">
          {status.text}{" "}
          {status.goTo && (
            <Link href={`/eventos/${eventId}/${status.goTo}`} className="font-semibold underline underline-offset-4">
              Completar el cambio ahora
            </Link>
          )}
        </p>
      )}

      {open && (
        <div className="aviso-fondo" role="dialog" aria-modal="true" aria-labelledby="um-titulo">
          <div className="aviso max-h-[88dvh] overflow-y-auto">
            <p className="aviso-eyebrow">Último minuto</p>
            <p id="um-titulo" className="aviso-titulo">{chosen ? chosen.nombre : "¿Qué quieres ingresar?"}</p>
            {!chosen ? (
              <ul className="mt-3 grid gap-2">
                {LAST_MINUTE_KINDS.map((k) => (
                  <li key={k.clave}>
                    <button type="button" onClick={() => setKind(k.clave)} className="um-opcion">
                      <span className="font-display text-lg font-semibold leading-tight">{k.nombre}</span>
                      <span className="mt-0.5 block text-sm text-ink-muted">{k.ejemplo}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-3">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Qué llegó</span>
                  <textarea autoFocus rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={chosen.ejemplo} className={`${inputClass} py-2`} />
                </label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="sr-only"
                  tabIndex={-1}
                  aria-label="Comprobante"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <button type="button" onClick={() => fileRef.current?.click()} className={`${buttonGhost} mt-3 w-full`}>
                  {file ? `Comprobante: ${file.name}` : "Adjuntar comprobante o foto (opcional)"}
                </button>
                {status.kind === "error" && (
                  <p role="alert" className="mt-3 border border-critical/50 bg-critical/10 px-3 py-2 text-sm">
                    {status.text}
                  </p>
                )}
                <button type="button" onClick={save} disabled={working} className={`${buttonPrimary} mt-3 w-full`}>
                  {working ? status.text : "Anotar en la bitácora"}
                </button>
              </div>
            )}
            <button type="button" onClick={chosen ? () => setKind(null) : reset} disabled={working} className={`${buttonGhost} mt-2 w-full`}>
              {chosen ? "Volver" : "Cancelar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
