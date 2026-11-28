"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { answerBriefDoubt, saveBrief, type BriefState } from "@/app/actions/brief";
import { writeSynopsis } from "@/app/actions/ia";
import { buttonPrimary, inputClass } from "@/components/operacion/ui";
import type { BriefDoubt } from "@mando/core/data";
import { BRIEF_MAX_CHARS, SYNOPSIS_MAX_CHARS } from "@mando/core/experience";
import { getBrowserClient } from "@/lib/supabase/browser";

const DOC_MAX_BYTES = 20 * 1024 * 1024;
const DOC_TYPES = /\.(pdf|docx?|pptx?|xlsx?|png|jpe?g)$/i;

const initial: BriefState = { ok: false, error: null };
const label = "block text-sm font-medium";

/** El backend carga o corrige el brief. Cada cambio sube la versión y el equipo lo vuelve a leer. */
export function BriefForm({
  eventId,
  brief,
}: {
  eventId: string;
  brief: { version: number; summary: string; objective: string | null; attendees: string | null; synopsis?: string | null; documentName?: string | null } | null;
}) {
  const [state, action, pending] = useActionState(saveBrief, initial);
  const [chars, setChars] = useState((brief?.summary ?? "").length);
  const [doc, setDoc] = useState<{ path: string; name: string } | null>(null);
  const [upload, setUpload] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const formRef = useRef<HTMLFormElement>(null);
  const synopsisRef = useRef<HTMLTextAreaElement>(null);
  const [ai, setAi] = useState<{ error: string | null; done: boolean }>({ error: null, done: false });
  const [writing, startWriting] = useTransition();

  /** La IA lee el brief escrito (aunque aún no esté guardado) y propone la sinopsis. */
  function draftSynopsis() {
    const form = formRef.current;
    if (!form) return;
    const value = (n: string) => String(new FormData(form).get(n) ?? "");
    setAi({ error: null, done: false });
    startWriting(async () => {
      const r = await writeSynopsis({ brief: value("resumen"), objective: value("objetivo"), attendees: value("asistentes") });
      if (!r.ok) return setAi({ error: r.error, done: false });
      if (synopsisRef.current) synopsisRef.current.value = r.synopsis;
      setAi({ error: null, done: true });
    });
  }

  /** El documento se sube directo al cubo privado, en la carpeta del brief de este evento. */
  async function attach(file: File | null) {
    setDoc(null);
    if (!file) return setUpload({ busy: false, error: null });
    if (!DOC_TYPES.test(file.name)) return setUpload({ busy: false, error: "Adjunta un PDF, Word, PowerPoint, Excel o una imagen." });
    if (file.size > DOC_MAX_BYTES) return setUpload({ busy: false, error: "El documento pesa más de 20 MB." });
    const supabase = getBrowserClient();
    if (!supabase) return setUpload({ busy: false, error: "La app aún no está conectada a Supabase." });
    setUpload({ busy: true, error: null });
    const ext = (file.name.split(".").pop() ?? "pdf").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${eventId}/brief/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("evidences").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (error) return setUpload({ busy: false, error: /row-level|policy|permission/i.test(error.message) ? "No tienes permiso para adjuntar documentos aquí." : `No se pudo subir: ${error.message}` });
    setDoc({ path, name: file.name });
    setUpload({ busy: false, error: null });
  }

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <input type="hidden" name="evento" value={eventId} />
      {doc && (
        <>
          <input type="hidden" name="documento_ruta" value={doc.path} />
          <input type="hidden" name="documento_nombre" value={doc.name} />
        </>
      )}
      <div className="space-y-1.5">
        <label htmlFor="brief-sinopsis" className={label}>
          Sinopsis
        </label>
        <textarea ref={synopsisRef} id="brief-sinopsis" name="sinopsis" rows={3} maxLength={SYNOPSIS_MAX_CHARS} defaultValue={brief?.synopsis ?? ""} className={`${inputClass} py-2`} placeholder="Lo esencial en dos o tres líneas. Es lo primero que lee cada persona." />
        <button type="button" onClick={draftSynopsis} disabled={writing} className="leer-brief">
          {writing ? "La IA está escribiendo…" : "Escribir la sinopsis con IA"}
        </button>
        {ai.error && (
          <p role="alert" className="border border-critical/40 bg-critical/10 px-3 py-2 text-sm">
            {ai.error}
          </p>
        )}
        {ai.done && (
          <p role="status" className="text-sm text-ink-muted">
            La IA escribió la sinopsis con el brief de abajo. Revísala y corrígela antes de guardar.
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="brief-resumen" className={label}>
            Brief del evento
          </label>
          <span className={`font-mono text-xs ${chars > BRIEF_MAX_CHARS * 0.95 ? "text-[var(--naranja)]" : "text-ink-muted"}`} aria-live="polite">
            {chars.toLocaleString("es-PE")} de {BRIEF_MAX_CHARS.toLocaleString("es-PE")}
          </span>
        </div>
        <textarea
          id="brief-resumen"
          name="resumen"
          rows={8}
          required
          maxLength={BRIEF_MAX_CHARS}
          defaultValue={brief?.summary ?? ""}
          onChange={(e) => setChars(e.target.value.length)}
          className={`${inputClass} py-2`}
          placeholder="Qué es el evento, para quién y qué no puede fallar."
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="brief-documento" className={label}>
          Documento del brief (opcional)
        </label>
        <input
          id="brief-documento"
          type="file"
          accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,image/png,image/jpeg"
          onChange={(e) => attach(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:min-h-11 file:border-0 file:bg-surface-200 file:px-4 file:font-semibold file:text-ink"
        />
        <p className="text-xs text-ink-muted" aria-live="polite">
          {upload.busy
            ? "Subiendo el documento…"
            : doc
              ? `Listo para guardar: ${doc.name}`
              : brief?.documentName
                ? `Documento actual: ${brief.documentName}. Si no adjuntas otro, se conserva.`
                : "PDF, Word, PowerPoint, Excel o imagen, hasta 20 MB. Lo puede abrir todo el equipo."}
        </p>
        {upload.error && (
          <p role="alert" className="border border-critical/40 bg-critical/10 px-3 py-2 text-sm">
            {upload.error}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="brief-objetivo" className={label}>
          Objetivo
        </label>
        <input id="brief-objetivo" name="objetivo" maxLength={1000} defaultValue={brief?.objective ?? ""} className={inputClass} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="brief-asistentes" className={label}>
          Asistentes
        </label>
        <input id="brief-asistentes" name="asistentes" maxLength={200} defaultValue={brief?.attendees ?? ""} className={inputClass} placeholder="Ejemplo: 800 personas" />
      </div>
      {state.error && (
        <p role="alert" className="border border-critical/40 bg-critical/10 px-3 py-2 text-sm">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="text-sm text-ok">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending || upload.busy} className={`${buttonPrimary} w-full`}>
        {pending ? "Guardando…" : brief ? `Corregir el brief (pasa a versión ${brief.version + 1})` : "Cargar el brief"}
      </button>
    </form>
  );
}

/** Una duda del equipo sobre el brief: el backend la responde y la persona puede avanzar. */
export function DoubtAnswer({ doubt }: { doubt: BriefDoubt }) {
  const [state, action, pending] = useActionState(answerBriefDoubt, initial);
  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="duda" value={doubt.id} />
      <label htmlFor={`resp-${doubt.id}`} className={label}>
        Tu respuesta
      </label>
      <textarea id={`resp-${doubt.id}`} name="respuesta" rows={2} required maxLength={1000} className={`${inputClass} py-2`} placeholder="Confirma o corrige. Si el brief estaba mal, corrígelo primero arriba." />
      {state.error && (
        <p role="alert" className="border border-critical/40 bg-critical/10 px-3 py-2 text-sm">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "Enviando…" : "Responder"}
      </button>
    </form>
  );
}
