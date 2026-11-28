"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { raiseAlertAction, addEvidenceAction, type ActionState } from "@/app/actions/operacion";
import { interpretAlert, liftAlert, noteOnAlert, transcribeForEvent, type ChatLine } from "@/app/actions/alerta-voz";
import { MicIcon, useDictation } from "@/app/panel/nuevo/use-dictation";
import { AudioUpload } from "@/app/panel/nuevo/audio-upload";
import { MAX_EVIDENCE_BYTES, evidencePath, kindFromMime, sha256Hex } from "@mando/core/evidence";
import { getBrowserClient } from "@/lib/supabase/browser";
import { playTap } from "./pieza";
import { buttonGhost, buttonPrimary, inputClass } from "./ui";

type Level = { nivel: number; nombre: string; descripcion: string };
const INITIAL: ActionState = { ok: false, error: null };

/** El aviso que acompaña cada reporte y cada alerta levantada (decisión 94). */
export function HonorNotice() {
  return (
    <p className="honor-aviso">
      <strong>Todo productor es responsable de lo que informa.</strong> Tu palabra y tu evidencia quedan en la bitácora como prueba clara. MANDO es IA y cree en
      las personas con honor: filtramos los procesos con el mayor rigor posible, pero no somos abogados ni fiscalizadores, y no avalamos a nadie.
    </p>
  );
}

/** Lo que MANDO responde al levantar la alerta, según el nivel. */
function afterRaise(level: number, name: string): string {
  if (level <= 1) return `Muy bien, ${name}. Cumpliste, quedó en la bitácora. Sigamos avanzando.`;
  if (level === 2) return `Anotado, ${name}. ¿Por qué sigue el retraso? Cuando sepas más, mándanos un audio desde la alerta.`;
  return `Alerta encendida, ${name}. El equipo ya la ve. Para levantarla vas a necesitar una evidencia, por ejemplo la captura del mensaje del cliente.`;
}

/**
 * «Reportar un problema» por audio: se graba «¿Qué pasa?», luego «Detalle», y la IA contesta al estilo WhatsApp
 * y llena la ficha. La ficha queda a la vista para corregir antes de levantar la alerta.
 */
export function VoiceAlertForm({ eventId, levels, items, firstName }: { eventId: string; levels: Level[]; items: { id: string; title: string }[]; firstName: string }) {
  const dictation = useDictation();
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [thinking, startThinking] = useTransition();
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [backup, setBackup] = useState("");
  const [routeItemId, setRouteItemId] = useState("");
  const [level, setLevel] = useState(2);
  const [done, setDone] = useState<string | null>(null);
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await raiseAlertAction(prev, fd);
    if (r.ok) {
      setDone(afterRaise(level, firstName));
      setChat([]);
      setTitle("");
      setDetail("");
      setBackup("");
      setRouteItemId("");
      setLevel(2);
    }
    return r;
  }, INITIAL);

  const spoken = chat.filter((l) => l.from === "yo").length;
  const step = spoken === 0 ? "¿Qué pasa?" : spoken === 1 ? "Detalle" : "Responder";
  const hint =
    spoken === 0 ? "Graba qué pasa, en una frase. Ej.: «El técnico no llegó»." : spoken === 1 ? "Ahora el detalle: qué pasó y qué estás haciendo." : "Contesta a MANDO por audio.";

  function send(said: string) {
    const text = said.trim();
    if (!text) return dictation.setError("No alcancé a escucharte. Toca el micrófono y vuelve a grabar.");
    setDone(null);
    const next: ChatLine[] = [...chat, { from: "yo", text }];
    setChat(next);
    startThinking(async () => {
      const r = await interpretAlert({ eventId, chat: next, levels, items });
      if (!r.ok) return dictation.setError(r.error);
      setChat((c) => [...c, { from: "mando", text: r.reply }]);
      if (r.draft.title) setTitle(r.draft.title);
      setDetail(r.draft.detail);
      if (r.draft.backup) setBackup(r.draft.backup);
      if (r.draft.routeItemId) setRouteItemId(r.draft.routeItemId);
      setLevel(r.draft.level);
    });
  }

  const live = `${dictation.heard.final} ${dictation.heard.interim}`.trim();
  const fullDetail = [detail.trim(), backup.trim() && `Reemplazo o plan B: ${backup.trim()}.`, spoken > 0 && "(Reportado por audio.)"].filter(Boolean).join(" ");

  return (
    <div className="space-y-4">
      <div className="cuentame">
        {dictation.supported ? (
          <button
            type="button"
            className="cuentame-boton"
            data-escucha={dictation.listening ? "" : undefined}
            aria-pressed={dictation.listening}
            disabled={thinking}
            onClick={() => {
              playTap(dictation.listening ? "down" : "up");
              if (dictation.listening) send(dictation.stop());
              else dictation.start();
            }}
          >
            <span aria-hidden className="cuentame-mic">
              <MicIcon />
            </span>
            <span className="cuentame-texto">
              <span className="block font-display text-xl font-bold leading-tight">
                {thinking ? "MANDO está leyendo…" : dictation.listening ? "Te escucho… toca para enviar" : `Grabar · ${step}`}
              </span>
              <span className="mt-0.5 block text-sm font-normal opacity-80">{dictation.listening ? "Habla como en WhatsApp. Toca de nuevo para cortar." : hint}</span>
            </span>
          </button>
        ) : (
          <p className="cuentame-nota">Este navegador no deja grabar aquí. Usa Chrome o Safari, o sube un audio de WhatsApp.</p>
        )}
        <AudioUpload
          label="O sube un audio de WhatsApp"
          disabled={thinking || dictation.listening}
          transcriber={(fd) => transcribeForEvent(eventId, fd)}
          onText={send}
        />
        {dictation.listening && live && (
          <p className="cuentame-vivo" aria-live="polite">
            {live}
          </p>
        )}
        {dictation.error && (
          <p role="alert" className="text-sm text-[#ff6f86]">
            {dictation.error}
          </p>
        )}
      </div>

      {chat.length > 0 && (
        <ol className="chat-mando" aria-label="Conversación con MANDO">
          {chat.map((l, i) => {
            const n = chat.slice(0, i).filter((x) => x.from === "yo").length;
            return (
            <li key={i} className={l.from === "yo" ? "chat-yo" : "chat-ia"}>
              <span className="chat-quien">{l.from === "yo" ? (n === 0 ? "¿Qué pasa?" : n === 1 ? "Detalle" : firstName) : "MANDO"}</span>
              {l.text}
            </li>
            );
          })}
          {thinking && <li className="chat-ia chat-escribe">MANDO está escribiendo…</li>}
        </ol>
      )}

      {done && (
        <p role="status" className="chat-ia rounded-2xl px-3 py-2">
          <span className="chat-quien">MANDO</span>
          {done}
        </p>
      )}

      <form action={action} className="space-y-3">
        <p className="etiqueta-mando text-ink-muted">{spoken > 0 ? "La ficha · revísala antes de levantar" : "O escríbelo"}</p>
        <input type="hidden" name="event_id" value={eventId} />
        <input type="hidden" name="detail" value={fullDetail} />
        <label className="block text-sm">
          <span className="mb-1 block text-ink-muted">¿Qué pasa?</span>
          <input name="title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: no llegó el técnico de sala" className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-ink-muted">Detalle (opcional)</span>
          <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} className={`${inputClass} py-2`} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-ink-muted">Reemplazo o plan B (opcional)</span>
          <input value={backup} onChange={(e) => setBackup(e.target.value)} placeholder="Ej.: entra Carlos, el técnico de respaldo" className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-ink-muted">Actividad (opcional)</span>
          <select name="route_item_id" value={routeItemId} onChange={(e) => setRouteItemId(e.target.value)} className={inputClass}>
            <option value="">Ninguna</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="mb-1 text-sm text-ink-muted">Nivel</legend>
          <div className="grid gap-2">
            {levels.map((l) => (
              <label key={l.nivel} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl bg-surface-200 px-3 py-2 text-sm has-checked:ring-2 has-checked:ring-ink">
                <input type="radio" name="level" value={l.nivel} checked={level === l.nivel} onChange={() => setLevel(l.nivel)} className="size-4 accent-[#f7f9fc]" />
                <span>
                  <span className="font-semibold">{l.nombre}</span>
                  <span className="block text-xs text-ink-muted">{l.descripcion}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <RaiseButton />
        {state.error && (
          <p role="alert" className="rounded-2xl bg-[#3a1620] px-3 py-2 text-sm text-[#ffd3c9]">
            {state.error}
          </p>
        )}
        <HonorNotice />
      </form>
    </div>
  );
}

function RaiseButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
      {pending ? "Levantando…" : "Levantar alerta"}
    </button>
  );
}

/** Un audio corto sobre una alerta abierta. En «Atención» la pregunta es por qué sigue el retraso. */
export function AlertVoiceNote({ alertId, eventId, level }: { alertId: string; eventId: string; level: number }) {
  const dictation = useDictation();
  const [busy, startBusy] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const label = level === 2 ? "¿Por qué sigue el retraso? Mándanos un audio" : "Mandar un audio sobre esta alerta";

  function save(said: string) {
    if (!said.trim()) return setMsg({ ok: false, text: "No alcancé a escucharte. Vuelve a grabar." });
    startBusy(async () => {
      const r = await noteOnAlert(alertId, said);
      setMsg(r.ok ? { ok: true, text: `${r.message} «${said.trim().slice(0, 120)}»` } : { ok: false, text: r.error });
    });
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {dictation.supported && (
          <button
            type="button"
            className="nota-voz"
            data-escucha={dictation.listening ? "" : undefined}
            aria-pressed={dictation.listening}
            disabled={busy}
            onClick={() => {
              playTap(dictation.listening ? "down" : "up");
              if (dictation.listening) save(dictation.stop());
              else {
                setMsg(null);
                dictation.start();
              }
            }}
          >
            <MicIcon size={18} />
            {busy ? "Guardando…" : dictation.listening ? "Te escucho… toca para enviar" : label}
          </button>
        )}
        <AudioUpload label="Subir audio" disabled={busy || dictation.listening} transcriber={(fd) => transcribeForEvent(eventId, fd)} onText={save} />
      </div>
      {dictation.listening && dictation.heard.final && <p className="text-sm text-white/70">{dictation.heard.final}</p>}
      {(msg || dictation.error) && (
        <p role={msg?.ok ? "status" : "alert"} className={`text-sm ${msg?.ok ? "text-[#8fe0b8]" : "text-[#ffd3c9]"}`}>
          {msg?.text ?? dictation.error}
        </p>
      )}
    </div>
  );
}

type LiftStatus = { kind: "idle" } | { kind: "working"; text: string } | { kind: "error"; text: string } | { kind: "ok"; text: string };

/**
 * Levantar una alerta: sin evidencia no pasa. Se adjunta la captura del mensaje del cliente o una foto,
 * se cuenta (escrito o por audio) cómo se resolvió, y la persona da su palabra.
 */
export function LiftAlert({ alertId, eventId, onClose }: { alertId: string; eventId: string; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dictation = useDictation();
  const [file, setFile] = useState<File | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [explanation, setExplanation] = useState("");
  const [honor, setHonor] = useState(false);
  const [status, setStatus] = useState<LiftStatus>({ kind: "idle" });

  async function submit() {
    if (!file) return setStatus({ kind: "error", text: "Adjunta la evidencia: la captura del mensaje del cliente o una foto." });
    if (!honor) return setStatus({ kind: "error", text: "Marca que respondes por lo que informas." });
    try {
      if (file.size > MAX_EVIDENCE_BYTES) throw new Error("El archivo pesa más de 50 MB.");
      setStatus({ kind: "working", text: "Calculando la huella…" });
      const sha = await sha256Hex(await file.arrayBuffer());
      const supabase = getBrowserClient();
      if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
      const path = evidencePath(eventId, crypto.randomUUID(), file.name);
      setStatus({ kind: "working", text: "Subiendo la evidencia…" });
      const { error } = await supabase.storage.from("evidences").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (error) throw new Error(/row-level|policy|permission/i.test(error.message) ? "No tienes permiso para subir evidencias aquí." : `No se pudo subir: ${error.message}`);
      const kind = kindFromMime(file.type);
      const saved = await addEvidenceAction({
        eventId,
        kind,
        filePath: path,
        note: "Evidencia para levantar la alerta",
        sha256: sha,
        capturedAt: capturedAt ?? new Date().toISOString(),
        alertId,
        visible: false,
      });
      if (!saved.ok) throw new Error(saved.error ?? "No se pudo registrar la evidencia.");
      setStatus({ kind: "working", text: "La IA de MANDO está leyendo la evidencia…" });
      const r = await liftAlert(alertId, explanation);
      if (!r.ok) throw new Error(r.error);
      setStatus({ kind: "ok", text: r.message });
    } catch (e) {
      const m = e instanceof Error ? e.message : "Algo falló.";
      setStatus({ kind: "error", text: /failed to fetch|network/i.test(m) ? "Sin señal: intenta de nuevo cuando vuelva la conexión." : m });
    }
  }

  const working = status.kind === "working";
  if (status.kind === "ok")
    return (
      <p role="status" className="mt-3 text-sm text-[#8fe0b8]">
        {status.text}
      </p>
    );

  return (
    <div className="levantar mt-3 space-y-3">
      <p className="ia-aviso">
        Para levantar la alerta adjunta una evidencia: la captura del WhatsApp del cliente («avanza nomás, regularizo después») o una foto de que ya se
        resolvió. La IA de MANDO la lee. Sin evidencia no pasa.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="sr-only"
        aria-label="Evidencia"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f);
          setCapturedAt(f ? new Date().toISOString() : null);
          setStatus({ kind: "idle" });
        }}
      />
      <button type="button" className={`${buttonGhost} w-full`} onClick={() => fileRef.current?.click()} disabled={working}>
        {file ? `Evidencia: ${file.name}` : "Adjuntar captura o foto"}
      </button>
      <label className="block text-sm">
        <span className="mb-1 flex items-center justify-between gap-2 text-white/70">
          Cómo se resolvió (opcional)
          {dictation.supported && (
            <button
              type="button"
              className="nota-voz nota-voz-chica"
              data-escucha={dictation.listening ? "" : undefined}
              aria-pressed={dictation.listening}
              onClick={() => {
                if (dictation.listening) {
                  const said = dictation.stop();
                  if (said) setExplanation((t) => `${t} ${said}`.trim());
                } else dictation.start();
              }}
            >
              <MicIcon size={16} />
              {dictation.listening ? "Toca para terminar" : "Contar por audio"}
            </button>
          )}
        </span>
        <textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={2} className={`${inputClass} py-2`} placeholder="Ej.: el cliente autorizó seguir por WhatsApp" />
      </label>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" checked={honor} onChange={(e) => setHonor(e.target.checked)} className="mt-1 size-5 flex-none accent-[#c9a227]" />
        <span>Respondo por lo que informo: esta evidencia es real y la tomo como prueba ante el cliente y la producción.</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={submit} disabled={working} className={buttonPrimary}>
          {working ? status.text : "Levantar con evidencia"}
        </button>
        <button type="button" onClick={onClose} disabled={working} className="min-h-11 px-2 text-sm text-white/70 underline-offset-4 hover:underline">
          Cancelar
        </button>
      </div>
      {status.kind === "error" && (
        <p role="alert" className="rounded-2xl bg-[#3a1620] px-3 py-2 text-sm text-[#ffd3c9]">
          {status.text}
        </p>
      )}
      <HonorNotice />
    </div>
  );
}
