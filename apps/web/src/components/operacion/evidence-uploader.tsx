"use client";

import { useRef, useState } from "react";
import { addEvidenceAction } from "@/app/actions/operacion";
import { MAX_EVIDENCE_BYTES, evidencePath, kindFromMime, sha256Hex } from "@mando/core/evidence";
import { EVIDENCE_KIND_LABEL } from "@mando/core/labels";
import { getBrowserClient } from "@/lib/supabase/browser";
import { buttonGhost, buttonPrimary, inputClass } from "./ui";

type Status = { kind: "idle" } | { kind: "working"; text: string } | { kind: "ok"; text: string } | { kind: "error"; text: string };

/**
 * Carga de evidencias desde el teléfono: cámara, micrófono o archivos.
 * 1) Se guarda la hora del teléfono al elegir el archivo. 2) Se calcula la huella SHA-256.
 * 3) Se sube directo al cubo privado. 4) El servidor la registra con su propia hora y la anota en la bitácora.
 */
export function EvidenceUploader({
  eventId,
  routeItemId = null,
  momentId = null,
  defaultVisible = true,
  suggested,
}: {
  eventId: string;
  routeItemId?: string | null;
  momentId?: string | null;
  defaultVisible?: boolean;
  suggested?: string[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [visible, setVisible] = useState(defaultVisible);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const pick = (accept: string, capture?: "environment" | "user") => {
    const input = fileRef.current;
    if (!input) return;
    input.accept = accept;
    if (capture) input.setAttribute("capture", capture);
    else input.removeAttribute("capture");
    input.click();
  };

  const reset = () => {
    setFile(null);
    setCapturedAt(null);
    setNote("");
    if (fileRef.current) fileRef.current.value = "";
  };

  async function save() {
    if (!file && !note.trim()) {
      setStatus({ kind: "error", text: "Toma una foto, elige un archivo o escribe una nota." });
      return;
    }
    try {
      let filePath: string | null = null;
      let sha: string | null = null;
      const kind = file ? kindFromMime(file.type) : "note";
      if (file) {
        if (file.size > MAX_EVIDENCE_BYTES) throw new Error("El archivo pesa más de 50 MB.");
        setStatus({ kind: "working", text: "Calculando la huella del archivo…" });
        sha = await sha256Hex(await file.arrayBuffer());
        const supabase = getBrowserClient();
        if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
        filePath = evidencePath(eventId, crypto.randomUUID(), file.name);
        setStatus({ kind: "working", text: "Subiendo…" });
        const { error } = await supabase.storage
          .from("evidences")
          .upload(filePath, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if (error) throw new Error(/row-level|policy|permission/i.test(error.message) ? "No tienes permiso para subir evidencias aquí." : `No se pudo subir: ${error.message}`);
      }
      setStatus({ kind: "working", text: "Registrando…" });
      const result = await addEvidenceAction({
        eventId,
        kind,
        filePath,
        note,
        sha256: sha,
        capturedAt: capturedAt ?? new Date().toISOString(),
        routeItemId,
        momentId,
        visible,
      });
      if (!result.ok) throw new Error(result.error ?? "No se pudo registrar.");
      setStatus({ kind: "ok", text: `${EVIDENCE_KIND_LABEL[kind]} guardada con hora del servidor.` });
      reset();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Algo falló.";
      setStatus({ kind: "error", text: /failed to fetch|network/i.test(message) ? "Sin señal: intenta de nuevo cuando vuelva la conexión." : message });
    }
  }

  const working = status.kind === "working";
  return (
    <div id="evidencia" className="scroll-mt-24 space-y-3">
      <input
        ref={fileRef}
        type="file"
        className="sr-only"
        aria-label="Archivo de evidencia"
        data-testid="evidence-file"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f);
          setCapturedAt(f ? new Date().toISOString() : null);
          setStatus({ kind: "idle" });
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={buttonGhost} onClick={() => pick("image/*", "environment")}>
          Foto
        </button>
        <button type="button" className={buttonGhost} onClick={() => pick("video/*", "environment")}>
          Video
        </button>
        <button type="button" className={buttonGhost} onClick={() => pick("audio/*")}>
          Audio
        </button>
        <button type="button" className={buttonGhost} onClick={() => pick("application/pdf,image/*,.doc,.docx,.xls,.xlsx")}>
          Documento
        </button>
      </div>
      {suggested && suggested.length > 0 && (
        <p className="text-xs text-ink-muted">Sugerido para este momento: {suggested.join(", ")}.</p>
      )}
      {file && (
        <p className="rounded-2xl bg-surface-200 px-3 py-2 text-sm">
          <span className="font-semibold">{EVIDENCE_KIND_LABEL[kindFromMime(file.type)]}:</span> {file.name}{" "}
          <span className="font-mono text-xs text-ink-muted">({Math.ceil(file.size / 1024)} KB)</span>
        </p>
      )}
      <label className="block text-sm">
        <span className="mb-1 block text-ink-muted">{file ? "Nota (opcional)" : "O escribe una nota"}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={`${inputClass} py-2`} placeholder="Qué se ve, qué pasó" />
      </label>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} className="size-5 accent-[#c9a227]" />
        La ve el cliente
      </label>
      <button type="button" onClick={save} disabled={working} className={`${buttonPrimary} w-full`}>
        {working ? status.text : "Guardar evidencia"}
      </button>
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
