"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { answerBriefDoubt, type BriefState } from "@/app/actions/brief";
import {
  buildQuoteBreakdown,
  continueWithBrief,
  exportBriefDocx,
  processBrief,
  registerBriefDocument,
  reviewQuoteExcel,
  type BreakdownResult,
  type ProcessResult,
  type Recommendation,
} from "@/app/actions/brief-ia";
import { playTap } from "@/components/operacion/pieza";
import { buttonPrimary, inputClass } from "@/components/operacion/ui";
import type { BriefDocument, BriefDoubt } from "@mando/core/data";
import { BRIEF_MAX_CHARS, SYNOPSIS_MAX_CHARS } from "@mando/core/experience";
import { getBrowserClient } from "@/lib/supabase/browser";
import { AudioUpload } from "../nuevo/audio-upload";
import { MicIcon, useDictation } from "../nuevo/use-dictation";

const DOC_MAX_BYTES = 20 * 1024 * 1024;
const DOC_TYPES = /\.(pdf|png|jpe?g|webp|docx?|pptx?|xlsx?)$/i;

const initial: BriefState = { ok: false, error: null };
const label = "block text-sm font-medium";
const NIVEL: Record<Recommendation["nivel"], string> = { alto: "Riesgo alto", medio: "Riesgo medio", bajo: "A tener en cuenta" };

type Brief = { version: number; summary: string; objective: string | null; attendees: string | null; synopsis?: string | null; documentName?: string | null } | null;
type Processed = Extract<ProcessResult, { ok: true }>;

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="border border-critical/40 bg-critical/10 px-3 py-2 text-sm">
      {children}
    </p>
  );
}

/** Baja al teléfono o la computadora un archivo que armó el servidor. */
function download(file: { name: string; base64: string; mime: string }) {
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Un campo de texto que también se dicta con el micrófono o se llena con un audio de WhatsApp. */
function VoiceField({
  id,
  value,
  onChange,
  rows,
  max,
  placeholder,
  micLabel,
  audioLabel,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  max: number;
  placeholder: string;
  micLabel: string;
  audioLabel: string;
  disabled?: boolean;
}) {
  const dictation = useDictation();
  const live = `${dictation.heard.final} ${dictation.heard.interim}`.trim();
  const add = (text: string) => onChange(`${value.trim()}${value.trim() ? "\n" : ""}${text}`.slice(0, max));
  function toggle() {
    playTap(dictation.listening ? "down" : "up");
    if (!dictation.listening) return dictation.start();
    const said = dictation.stop();
    if (said) add(said);
  }
  return (
    <div className="space-y-2">
      <div className="revision-caja">
        <textarea
          id={id}
          rows={rows}
          maxLength={max}
          value={dictation.listening && live ? `${value} ${live}`.trim() : value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={dictation.listening || disabled}
          placeholder={placeholder}
          className={`${inputClass} py-2`}
        />
        {dictation.supported && (
          <button
            type="button"
            className="revision-mic"
            data-escucha={dictation.listening ? "" : undefined}
            aria-pressed={dictation.listening}
            aria-label={dictation.listening ? "Terminar de dictar" : micLabel}
            disabled={disabled}
            onClick={toggle}
          >
            <MicIcon size={22} />
          </button>
        )}
      </div>
      <AudioUpload label={audioLabel} disabled={disabled || dictation.listening} onText={add} />
      {dictation.error && <Alert>{dictation.error}</Alert>}
    </div>
  );
}

/**
 * El brief del evento (decisión 89): se escribe o dicta, se suman correcciones y documentos complementarios,
 * y «Procesar» devuelve la sinopsis, el brief enriquecido y las recomendaciones. «Continuar» lo guarda y deja
 * en la bitácora que el productor general leyó las recomendaciones.
 */
export function BriefForm({ eventId, brief, documents = [] }: { eventId: string; brief: Brief; documents?: BriefDocument[] }) {
  const [text, setText] = useState(brief?.summary ?? "");
  const [extra, setExtra] = useState("");
  const [docs, setDocs] = useState<{ name: string; url: string | null }[]>(documents.map((d) => ({ name: d.name, url: d.url })));
  const [upload, setUpload] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [result, setResult] = useState<Processed | null>(null);
  const [synopsis, setSynopsis] = useState(brief?.synopsis ?? "");
  const [processed, setProcessed] = useState("");
  const [read, setRead] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [working, startWorking] = useTransition();
  const [saving, startSaving] = useTransition();
  const reviewRef = useRef<HTMLDivElement>(null);
  // Mientras el productor lee las recomendaciones, el desglose para cotizar ya se va armando.
  const [prebuilt, setPrebuilt] = useState<BreakdownResult | "armando" | null>(null);
  const busy = working || saving;

  /** Cada documento va directo al cubo privado, en la carpeta del brief, y queda registrado. */
  async function attach(files: FileList | null) {
    const list = [...(files ?? [])];
    if (!list.length) return;
    const supabase = getBrowserClient();
    if (!supabase) return setUpload({ busy: false, error: "La app aún no está conectada a Supabase." });
    setUpload({ busy: true, error: null });
    for (const file of list.slice(0, 10)) {
      if (!DOC_TYPES.test(file.name)) {
        setUpload({ busy: false, error: `${file.name}: sube un PDF, una foto, Word, PowerPoint o Excel.` });
        continue;
      }
      if (file.size > DOC_MAX_BYTES) {
        setUpload({ busy: false, error: `${file.name} pesa más de 20 MB.` });
        continue;
      }
      const ext = (file.name.split(".").pop() ?? "pdf").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${eventId}/brief/${crypto.randomUUID()}.${ext}`;
      const { error: up } = await supabase.storage.from("evidences").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (up) {
        setUpload({ busy: false, error: /row-level|policy|permission/i.test(up.message) ? "No tienes permiso para adjuntar documentos aquí." : `No se pudo subir ${file.name}: ${up.message}` });
        continue;
      }
      const r = await registerBriefDocument(eventId, path, file.name.slice(0, 200));
      if (!r.ok) {
        setUpload({ busy: false, error: r.error });
        continue;
      }
      setDocs((prev) => [...prev, { name: file.name, url: null }]);
    }
    setUpload((u) => ({ ...u, busy: false }));
  }

  function process() {
    playTap("up");
    setError(null);
    setSaved(null);
    startWorking(async () => {
      const r = await processBrief({ eventId, brief: text, extra });
      if (!r.ok) return setError(r.error);
      setResult(r);
      setProcessed(r.brief);
      setSynopsis(r.synopsis || synopsis);
      setRead(false);
      requestAnimationFrame(() => reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      setPrebuilt("armando");
      buildQuoteBreakdown({ eventId, brief: r.brief, synopsis: r.synopsis })
        .then(setPrebuilt)
        .catch(() => setPrebuilt(null));
    });
  }

  /** «Modificar»: el brief procesado vuelve al campo de arriba para corregirlo o sumarle algo. */
  function modify() {
    playTap("down");
    if (processed.trim()) setText(processed.slice(0, BRIEF_MAX_CHARS));
    setExtra("");
    setResult(null);
    setRead(false);
    setPrebuilt(null);
    requestAnimationFrame(() => document.getElementById("brief-resumen")?.focus());
  }

  function proceed() {
    if (!result) return;
    playTap("up");
    setError(null);
    startSaving(async () => {
      const r = await continueWithBrief({
        eventId,
        brief: processed,
        synopsis,
        objective: result.objective,
        attendees: result.attendees,
        recommendations: result.recommendations,
      });
      if (!r.ok) return setError(r.error);
      setText(processed);
      setSaved(
        `Brief guardado (versión ${r.version}). ` +
          (result.recommendations.length ? `Quedó en la bitácora que leíste las ${result.recommendations.length} recomendaciones y decidiste continuar. ` : "") +
          "El equipo tiene que leerlo de nuevo.",
      );
      setExtra("");
      setResult(null);
    });
  }

  const currentBrief = result ? processed : text;

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="brief-resumen" className={label}>
            Brief del evento
          </label>
          <span className={`font-mono text-xs ${text.length > BRIEF_MAX_CHARS * 0.95 ? "text-[var(--naranja)]" : "text-ink-muted"}`} aria-live="polite">
            {text.length.toLocaleString("es-PE")} de {BRIEF_MAX_CHARS.toLocaleString("es-PE")}
          </span>
        </div>
        <VoiceField
          id="brief-resumen"
          value={text}
          onChange={setText}
          rows={8}
          max={BRIEF_MAX_CHARS}
          disabled={busy || !!result}
          placeholder="Qué es el evento, para quién, dónde y cuándo, cuántas personas y qué no puede fallar. Escríbelo o díctalo."
          micLabel="Dictar el brief"
          audioLabel="Subir un audio con el brief"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="brief-extra" className={label}>
          Corrección o algo adicional
        </label>
        <p className="text-xs text-ink-muted">Si en los envíos anteriores algo se nos fue, cuéntalo aquí. La IA lo suma al procesar.</p>
        <VoiceField
          id="brief-extra"
          value={extra}
          onChange={setExtra}
          rows={3}
          max={4000}
          disabled={busy || !!result}
          placeholder="Ejemplo: el cliente sumó un photocall y la entrada ahora es por la avenida."
          micLabel="Dictar la corrección"
          audioLabel="Subir un audio con la corrección"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="brief-documentos" className={label}>
          Documentos complementarios
        </label>
        <p className="text-xs text-ink-muted">
          Lo que debes conocer: noticias del local, notas policiales, una directiva municipal, planos o fotos del recinto. La IA lee los PDF y las fotos al procesar.
        </p>
        <input
          id="brief-documentos"
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,image/png,image/jpeg,image/webp"
          disabled={upload.busy || busy}
          onChange={(e) => {
            attach(e.target.files);
            e.target.value = "";
          }}
          className="block w-full text-sm file:mr-3 file:min-h-11 file:border-0 file:bg-surface-200 file:px-4 file:font-semibold file:text-ink"
        />
        {upload.busy && <p className="text-xs text-ink-muted">Subiendo…</p>}
        {upload.error && <Alert>{upload.error}</Alert>}
        {docs.length > 0 && (
          <ul className="space-y-1 text-sm">
            {docs.map((d, i) => (
              <li key={i} className="flex items-center gap-2">
                <span aria-hidden className="text-gold-300">▪</span>
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                    {d.name}
                  </a>
                ) : (
                  <span>{d.name}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {brief?.documentName && <p className="text-xs text-ink-muted">Documento anterior del brief: {brief.documentName}.</p>}
      </div>

      {!result && (
        <button type="button" onClick={process} disabled={busy || upload.busy || text.trim().length < 40} className={`${buttonPrimary} w-full`}>
          {working ? "La IA está leyendo todo y buscando en internet… (1 a 3 minutos)" : "Procesar"}
        </button>
      )}
      {!result && text.trim().length < 40 && <p className="text-xs text-ink-muted">Escribe o dicta el brief (al menos un par de líneas) para poder procesarlo.</p>}
      {error && <Alert>{error}</Alert>}
      {saved && (
        <p role="status" className="text-sm text-ok">
          {saved}
        </p>
      )}

      {result && (
        <div ref={reviewRef} className="space-y-4 scroll-mt-4">
          <div className="space-y-1.5">
            <p className="bloque-titulo">Sinopsis</p>
            <textarea aria-label="Sinopsis" rows={3} maxLength={SYNOPSIS_MAX_CHARS} value={synopsis} onChange={(e) => setSynopsis(e.target.value)} className={`${inputClass} py-2`} />
          </div>
          <div className="space-y-1.5">
            <p className="bloque-titulo">Brief procesado</p>
            <textarea aria-label="Brief procesado" rows={14} maxLength={BRIEF_MAX_CHARS} value={processed} onChange={(e) => setProcessed(e.target.value)} className={`${inputClass} py-2 text-sm`} />
            {result.changes.length > 0 && (
              <div className="revision-cambios">
                <p className="font-semibold text-ink">Lo que sumó o corrigió la IA</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {result.changes.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <section aria-label="Recomendaciones" className="space-y-2">
            <p className="bloque-titulo">Mis recomendaciones: posibles puntos ciegos</p>
            <p className="text-sm text-ink-muted">
              Esto es lo que noto y podría ser un punto ciego para tu evento.
              {result.searched ? " Revisé también noticias y fuentes en internet." : " Esta vez no pude buscar en internet."}
            </p>
            {result.recommendations.length === 0 && <p className="text-sm">No encontré puntos ciegos importantes.</p>}
            <ol className="space-y-2">
              {result.recommendations.map((r, i) => (
                <li key={i} className="punto-ciego" data-nivel={r.nivel}>
                  <p className="punto-ciego-nivel">{NIVEL[r.nivel]}</p>
                  <p className="font-semibold text-ink">{r.titulo}</p>
                  <p className="mt-0.5 text-sm text-ink-muted">{r.detalle}</p>
                  {r.fuente && <p className="mt-1 font-mono text-xs text-ink-muted">Fuente: {r.fuente}</p>}
                </li>
              ))}
            </ol>
            {result.skipped.length > 0 && <p className="text-xs text-ink-muted">No leí: {result.skipped.join(", ")}.</p>}
          </section>

          <div className="revision space-y-3">
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--gold-300)]" />
              <span>Leí el brief procesado y todas las recomendaciones.</span>
            </label>
            <p className="text-sm text-ink-muted">¿Deseas continuar o quieres modificar el documento? Si continúas, queda en la bitácora que leíste estas recomendaciones.</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="revision-accion" onClick={modify} disabled={saving}>
                Modificar
              </button>
              <button type="button" className={buttonPrimary} onClick={proceed} disabled={!read || saving || !processed.trim()}>
                {saving ? "Guardando…" : "Continuar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {currentBrief.trim().length >= 40 && (
        <BriefTools
          eventId={eventId}
          brief={currentBrief}
          synopsis={synopsis}
          recommendations={result?.recommendations ?? []}
          documents={docs.map((d) => d.name)}
          prebuilt={prebuilt}
        />
      )}
    </div>
  );
}

/** Después del brief: exportarlo en Word, armar el Excel para cotizar y revisar el Excel recortado. */
function BriefTools({
  eventId,
  brief,
  synopsis,
  recommendations,
  documents,
  prebuilt,
}: {
  eventId: string;
  brief: string;
  synopsis: string;
  recommendations: Recommendation[];
  documents: string[];
  prebuilt: BreakdownResult | "armando" | null;
}) {
  const [busy, setBusy] = useState<null | "word" | "excel" | "review">(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [review, setReview] = useState<Awaited<ReturnType<typeof reviewQuoteExcel>> | null>(null);
  const excelInput = useRef<HTMLInputElement>(null);

  async function run<T extends { ok: boolean }>(kind: "word" | "excel" | "review", fn: () => Promise<T>, done: (r: T) => void) {
    playTap("up");
    setBusy(kind);
    setError(null);
    setNote(null);
    try {
      const r = await fn();
      if (!r.ok) setError((r as unknown as { error: string }).error);
      else done(r);
    } catch {
      setError("Algo falló. Intenta de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Exportar y cotizar" className="revision">
      <p className="bloque-titulo">Exportar y cotizar</p>
      <button
        type="button"
        className="revision-accion"
        disabled={!!busy}
        onClick={() =>
          run("word", () => exportBriefDocx({ eventId, brief, synopsis, recommendations, documents }), (r) => {
            if (r.ok) download(r);
            setNote("Listo: el brief en Word se descargó.");
          })
        }
      >
        {busy === "word" ? "Armando el Word…" : "Exportar el brief en Word"}
      </button>
      {prebuilt && prebuilt !== "armando" && prebuilt.ok ? (
        <button
          type="button"
          className="leer-brief"
          disabled={!!busy}
          onClick={() => {
            playTap("up");
            download(prebuilt);
            setNote(`Listo: ${prebuilt.count} ítems en ${prebuilt.rubros} rubros. Recórtalo en Excel y vuelve a subirlo abajo para que la IA lo revise.`);
          }}
        >
          Descargar el desglose para cotizar ({prebuilt.count} ítems)
        </button>
      ) : (
        <button
          type="button"
          className="leer-brief"
          disabled={!!busy || prebuilt === "armando"}
          onClick={() =>
            run("excel", () => buildQuoteBreakdown({ eventId, brief, synopsis }), (r) => {
              if (!r.ok) return;
              download(r);
              setNote(`Listo: ${r.count} ítems en ${r.rubros} rubros. Recórtalo en Excel y vuelve a subirlo abajo para que la IA lo revise.`);
            })
          }
        >
          {busy === "excel" || prebuilt === "armando" ? "La IA está armando el desglose… (1 a 3 minutos)" : "Armar el desglose para cotizar (Excel)"}
        </button>
      )}
      {prebuilt && prebuilt !== "armando" && !prebuilt.ok && <p className="text-xs text-ink-muted">El desglose automático no salió: {prebuilt.error} Pulsa el botón para intentarlo de nuevo.</p>}
      <input
        ref={excelInput}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const fd = new FormData();
          fd.append("evento", eventId);
          fd.append("brief", brief);
          fd.append("excel", file);
          run("review", () => reviewQuoteExcel(fd), (r) => {
            setReview(r);
            if (r.ok) download(r);
          });
        }}
      />
      <button type="button" className="subir-audio" disabled={!!busy} onClick={() => excelInput.current?.click()}>
        {busy === "review" ? "La IA está revisando tu Excel…" : "Subir mi Excel recortado para revisarlo"}
      </button>
      {error && <Alert>{error}</Alert>}
      {note && (
        <p role="status" className="text-sm text-ok">
          {note}
        </p>
      )}
      {review?.ok && (
        <div aria-live="polite" className="revision-cambios">
          <p className="font-semibold text-ink">
            Tu Excel: {review.kept} ítems. Quitaste {review.removed}, cambiaste {review.changed} y sumaste {review.added}.
          </p>
          {review.findings.length === 0 ? (
            <p className="mt-1">La IA no encontró omisiones ni cosas que no cuadren.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {review.findings.map((f, i) => (
                <li key={i}>
                  <span className="font-semibold text-ink">{f.item}:</span> {f.mensaje} <span className="text-ink">{f.sugerencia}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs">Se descargó tu Excel con una hoja nueva «Revisión IA».</p>
        </div>
      )}
    </section>
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
