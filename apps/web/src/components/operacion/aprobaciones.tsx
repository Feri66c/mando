"use client";

import { useActionState, useRef, useState } from "react";
import {
  addApprovalAction,
  decideApprovalAction,
  removeApprovalAction,
  replaceApprovalAction,
  setApprovalGroupsAction,
  type CierreState,
} from "@/app/actions/cierre";
import { MAX_EVIDENCE_BYTES, approvalPath, sha256Hex } from "@mando/core/evidence";
import { getBrowserClient } from "@/lib/supabase/browser";
import { buttonGhost, buttonPrimary, buttonSecondary, inputClass } from "./ui";

const INITIAL: CierreState = { ok: false, error: null };
type Working = CierreState & { working?: string };

function Feedback({ state }: { state: Working }) {
  if (state.working)
    return (
      <p role="status" className="mt-2 text-sm text-ink-muted">
        {state.working}
      </p>
    );
  if (state.error)
    return (
      <p role="alert" className="mt-2 rounded-2xl bg-[#3a1620] px-3 py-2 text-sm text-[#ffd3c9]">
        {state.error}
      </p>
    );
  if (state.ok && state.message)
    return (
      <p role="status" className="mt-2 text-sm text-[#8fe0b8]">
        {state.message}
      </p>
    );
  return null;
}

/** Sube la foto al cubo privado, en la carpeta de aprobaciones del evento, y devuelve su ruta y su huella. */
async function uploadPhoto(eventId: string, file: File, onStep: (text: string) => void): Promise<{ filePath: string; sha256: string }> {
  if (file.size > MAX_EVIDENCE_BYTES) throw new Error("La foto pesa más de 50 MB.");
  onStep("Calculando la huella de la foto…");
  const sha256 = await sha256Hex(await file.arrayBuffer());
  const supabase = getBrowserClient();
  if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
  const filePath = approvalPath(eventId, crypto.randomUUID(), file.name);
  onStep("Subiendo…");
  const { error } = await supabase.storage.from("evidences").upload(filePath, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (error) throw new Error(/row-level|policy|permission/i.test(error.message) ? "No tienes permiso para subir fotos aquí." : `No se pudo subir: ${error.message}`);
  return { filePath, sha256 };
}

/** El recuadro para subir un elemento: foto, nombre y detalle. */
export function AddApprovalForm({ eventId, group, groupName }: { eventId: string; group: string; groupName: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [state, setState] = useState<Working>(INITIAL);
  const busy = Boolean(state.working);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (!name.trim()) throw new Error("Escribe el nombre.");
      const file = fileRef.current?.files?.[0] ?? null;
      const uploaded = file ? await uploadPhoto(eventId, file, (working) => setState({ ...INITIAL, working })) : null;
      setState({ ...INITIAL, working: "Registrando…" });
      const result = await addApprovalAction({ eventId, group, name, detail, filePath: uploaded?.filePath ?? null, sha256: uploaded?.sha256 ?? null });
      setState(result);
      if (result.ok) {
        setName("");
        setDetail("");
        if (fileRef.current) fileRef.current.value = "";
      }
    } catch (err) {
      setState({ ok: false, error: err instanceof Error ? err.message : "No se pudo guardar." });
    }
  }

  return (
    <details className="mt-2 rounded-card border border-dashed border-line p-3">
      <summary className="cursor-pointer text-sm font-semibold text-ice-300">Subir a {groupName}</summary>
      <form onSubmit={submit} className="mt-3 grid gap-3">
        <div>
          <label htmlFor={`ap-foto-${group}`} className="block text-sm font-medium">
            Foto
          </label>
          <input ref={fileRef} id={`ap-foto-${group}`} type="file" accept="image/*,application/pdf" aria-label={`Foto para ${groupName}`} className="mt-1.5 block w-full text-sm text-ink-muted file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-surface-200 file:px-4 file:text-sm file:font-semibold file:text-ink" />
        </div>
        <div>
          <label htmlFor={`ap-nombre-${group}`} className="block text-sm font-medium">
            Nombre
          </label>
          <input id={`ap-nombre-${group}`} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} aria-label={`Nombre en ${groupName}`} className={`${inputClass} mt-1.5`} />
        </div>
        <div>
          <label htmlFor={`ap-detalle-${group}`} className="block text-sm font-medium">
            Detalle
          </label>
          <input id={`ap-detalle-${group}`} value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={200} aria-label={`Detalle en ${groupName}`} className={`${inputClass} mt-1.5`} />
        </div>
        <button type="submit" disabled={busy} className={`${buttonPrimary} justify-self-start`}>
          {busy ? "Subiendo…" : "Subir para aprobación"}
        </button>
        <Feedback state={state} />
      </form>
    </details>
  );
}

/** Reemplazar la foto (vuelve a «por aprobar») o retirar el elemento. */
export function ApprovalTeamActions({ eventId, itemId, label }: { eventId: string; itemId: string; label: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<Working>(INITIAL);
  const [removeState, removeAction, removing] = useActionState(removeApprovalAction, INITIAL);
  const busy = Boolean(state.working) || removing;

  async function replace(file: File | null) {
    if (!file) return;
    try {
      const uploaded = await uploadPhoto(eventId, file, (working) => setState({ ...INITIAL, working }));
      setState({ ...INITIAL, working: "Registrando…" });
      setState(await replaceApprovalAction({ itemId, ...uploaded }));
    } catch (err) {
      setState({ ok: false, error: err instanceof Error ? err.message : "No se pudo guardar." });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="sr-only" tabIndex={-1} aria-label={`Nueva foto para ${label}`} onChange={(e) => void replace(e.target.files?.[0] ?? null)} />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} aria-label={`Reemplazar: ${label}`} className={buttonGhost}>
          Reemplazar
        </button>
        <form action={removeAction}>
          <input type="hidden" name="item_id" value={itemId} />
          <button type="submit" disabled={busy} aria-label={`Retirar: ${label}`} className={buttonGhost}>
            Retirar
          </button>
        </form>
      </div>
      <Feedback state={state} />
      <Feedback state={removeState} />
    </div>
  );
}

/**
 * La decisión. El cliente aprueba con un toque o pide un cambio contando qué cambiar.
 * El productor general puede registrar lo que el cliente decidió por otro medio, y debe decir cómo lo supo.
 */
export function ApprovalDecision({ itemId, label, status, onBehalf }: { itemId: string; label: string; status: "pending" | "approved" | "changes_requested"; onBehalf: boolean }) {
  const [state, action, pending] = useActionState(decideApprovalAction, INITIAL);
  const [mode, setMode] = useState<null | "approve" | "change">(null);
  const needsNote = mode === "change" || (mode === "approve" && onBehalf);
  return (
    <form action={action}>
      <input type="hidden" name="item_id" value={itemId} />
      {needsNote ? (
        <div>
          <input type="hidden" name="decision" value={mode === "approve" ? "approve" : "change"} />
          <label htmlFor={`ap-nota-${itemId}`} className="block text-sm font-medium">
            {mode === "change" ? "¿Qué hay que cambiar?" : "¿Cómo te dio el cliente su aprobación?"}
          </label>
          <textarea id={`ap-nota-${itemId}`} name="note" rows={2} required maxLength={300} placeholder={mode === "approve" ? "Por WhatsApp, hoy a las 10:15." : ""} className={`${inputClass} mt-1.5 py-2`} />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={buttonSecondary}>
              {mode === "change" ? "Enviar pedido de cambio" : "Registrar aprobación"}
            </button>
            <button type="button" onClick={() => setMode(null)} className={buttonGhost}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {status !== "approved" &&
            (onBehalf ? (
              <button type="button" onClick={() => setMode("approve")} aria-label={`Registrar aprobación del cliente: ${label}`} className={buttonSecondary}>
                Registrar aprobación del cliente
              </button>
            ) : (
              <button type="submit" name="decision" value="approve" disabled={pending} aria-label={`Aprobar: ${label}`} className={buttonPrimary}>
                Aprobar
              </button>
            ))}
          {status !== "changes_requested" && (
            <button type="button" onClick={() => setMode("change")} aria-label={`Pedir cambio: ${label}`} className={buttonGhost}>
              Pedir cambio
            </button>
          )}
        </div>
      )}
      <Feedback state={state} />
    </form>
  );
}

/** Qué grupos pide este evento, según el brief. Niveles 1 y 2. */
export function ApprovalGroupsForm({ eventId, groups, active }: { eventId: string; groups: { clave: string; nombre: string; descripcion: string }[]; active: string[] }) {
  const [state, action, pending] = useActionState(setApprovalGroupsAction, INITIAL);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="event_id" value={eventId} />
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Según el brief, el cliente aprueba:</legend>
        {groups.map((g) => (
          <label key={g.clave} className="mt-2 flex items-start gap-3 text-sm">
            <input type="checkbox" name="grupo" value={g.clave} defaultChecked={active.includes(g.clave)} className="mt-0.5 size-5 accent-[var(--gold-300)]" />
            <span>
              <span className="font-semibold">{g.nombre}</span>
              <span className="block text-ink-muted">{g.descripcion}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={pending} className={`${buttonSecondary} justify-self-start`}>
        {pending ? "Guardando…" : "Guardar"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
