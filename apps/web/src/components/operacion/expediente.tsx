"use client";

import { useActionState, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  addRequirementAction,
  completeRequirementAction,
  planRequirementAction,
  setLocationAction,
  setRequirementStatusAction,
  type CierreState,
} from "@/app/actions/cierre";
import { MAX_EVIDENCE_BYTES, requirementPath, sha256Hex } from "@mando/core/evidence";
import { SWORN_STATEMENT } from "@mando/core/requirements";
import { getBrowserClient } from "@/lib/supabase/browser";
import { reviewRequirementDocument, type ReviewResult } from "@/app/actions/documento-ia";
import { buttonGhost, buttonPrimary, buttonSecondary, inputClass } from "./ui";

const INITIAL: CierreState = { ok: false, error: null };

function Feedback({ state }: { state: CierreState }) {
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

/**
 * Subir un documento del expediente: se calcula su huella, se sube al cubo privado y el servidor lo registra.
 * Si el dato no es un archivo (una placa, un número de póliza), se puede escribir.
 */
export function RequirementUpload({
  eventId,
  requirementId,
  title,
  done,
  label,
}: {
  eventId: string;
  requirementId: string;
  title: string;
  done: boolean;
  /** Texto del botón principal (en una red flag: «Adjuntar documento»). */
  label?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<(ReviewResult & { fileName: string }) | null>(null);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [swearing, setSwearing] = useState(false);
  const [state, setState] = useState<CierreState & { working?: string }>(INITIAL);

  async function save(file: File | null) {
    try {
      let filePath: string | null = null;
      let sha: string | null = null;
      if (file) {
        if (file.size > MAX_EVIDENCE_BYTES) throw new Error("El archivo pesa más de 50 MB.");
        setState({ ...INITIAL, working: "Calculando la huella del archivo…" });
        sha = await sha256Hex(await file.arrayBuffer());
        const supabase = getBrowserClient();
        if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
        filePath = requirementPath(eventId, crypto.randomUUID(), file.name);
        setState({ ...INITIAL, working: "Subiendo…" });
        const { error } = await supabase.storage
          .from("evidences")
          .upload(filePath, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if (error) throw new Error(/row-level|policy|permission/i.test(error.message) ? "No tienes permiso para subir documentos aquí." : `No se pudo subir: ${error.message}`);
      } else if (!note.trim()) {
        throw new Error("Elige el archivo o escribe el dato.");
      }
      setState({ ...INITIAL, working: "Registrando…" });
      // Llega aquí solo después de aceptar la declaración jurada en pantalla.
      const result = await completeRequirementAction({ requirementId, filePath, fileName: file?.name ?? null, sha256: sha, note, sworn: true });
      if (result.ok && file) {
        // La IA de MANDO revisa lo que se acaba de adjuntar: vigencia y que sea lo que se pide.
        setState({ ...INITIAL, working: "La IA de MANDO está revisando el documento…" });
        const r = await reviewRequirementDocument(requirementId);
        setReview({ ...r, fileName: file.name });
        setState({ ok: true, error: null });
      } else {
        setState(result);
      }
      if (result.ok) {
        setNote("");
        setOpen(false);
      }
    } catch (e) {
      setState({ ok: false, error: e instanceof Error ? e.message : "No se pudo guardar." });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const busy = Boolean(state.working);
  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label={`Archivo para ${title}`}
        accept="application/pdf,image/*,text/xml,application/xml,.xml,.doc,.docx,.xls,.xlsx"
        onChange={(e) => void save(e.target.files?.[0] ?? null)}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => setSwearing(true)} aria-label={`${done ? "Reemplazar" : "Subir"}: ${title}`} className={done ? buttonGhost : buttonPrimary}>
          {done ? "Reemplazar archivo" : (label ?? "Subir documento")}
        </button>
        {!done && !label && (
          <button type="button" disabled={busy} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`Escribir el dato: ${title}`} className={buttonGhost}>
            Escribir el dato
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2">
          <label htmlFor={`dato-${requirementId}`} className="block text-sm font-medium">
            Dato de «{title}»
          </label>
          <textarea id={`dato-${requirementId}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputClass} mt-1.5 py-2`} />
          <p className="mt-2 text-xs text-ink-muted">{SWORN_STATEMENT}</p>
          <button type="button" disabled={busy} onClick={() => void save(null)} className={`${buttonSecondary} mt-2`}>
            Declaro y guardo el dato
          </button>
        </div>
      )}
      {swearing && createPortal(
        <div className="aviso-fondo" role="dialog" aria-modal="true" aria-labelledby={`jurada-${requirementId}`}>
          <div className="aviso">
            <p className="aviso-eyebrow">{label ? "Adjunta el documento · declaración jurada" : "Declaración jurada"}</p>
            <p id={`jurada-${requirementId}`} className="aviso-titulo">{title}</p>
            <p className="aviso-texto">{SWORN_STATEMENT}</p>
            <p className="aviso-texto ia-aviso">
              Este expediente lo administra la IA de MANDO: revisa que sea el documento que se pide, que se lea bien y que esté
              vigente para la fecha del evento. Si todo está bien, te da el pase. Adjunta el PDF, una foto o una captura.
            </p>
            <button
              type="button"
              autoFocus
              onClick={() => {
                setSwearing(false);
                fileRef.current?.click();
              }}
              className={`${buttonPrimary} w-full`}
            >
              Declaro y elijo el archivo
            </button>
            <button type="button" onClick={() => setSwearing(false)} className={`${buttonGhost} mt-2 w-full`}>
              Cancelar
            </button>
          </div>
        </div>,
        document.body,
      )}
      {state.working && (
        <p role="status" className="mt-2 text-sm text-ink-muted">
          {state.working}
        </p>
      )}
      <Feedback state={state} />
      {review &&
        createPortal(
          <ReviewDialog title={title} review={review} onClose={() => setReview(null)} onRetry={() => { setReview(null); setSwearing(true); }} />,
          document.body,
        )}
    </div>
  );
}

const VERDICT_TEXT: Record<NonNullable<ReviewResult["verdict"]>, { head: string; tone: "ok" | "warn" | "bad" }> = {
  vigente: { head: "Pase concedido · vigente", tone: "ok" },
  sin_fecha: { head: "Sin fecha de vencimiento a la vista", tone: "warn" },
  ilegible: { head: "No se lee bien · vuelve a tomar la foto", tone: "bad" },
  vencido: { head: "Documento vencido", tone: "bad" },
  no_corresponde: { head: "No es el documento que se pide", tone: "bad" },
};

const day = (iso: string | null | undefined) => (iso ? iso.split("-").reverse().join("/") : null);

/** Pop-up después de adjuntar: «Adjuntado» y lo que vio la IA. Si lo rechaza, invita a subir otro. */
function ReviewDialog({ title, review, onClose, onRetry }: { title: string; review: ReviewResult & { fileName: string }; onClose: () => void; onRetry: () => void }) {
  const v = review.verdict ? VERDICT_TEXT[review.verdict] : null;
  const rejected = v?.tone === "bad";
  return (
    <div className="aviso-fondo" role="dialog" aria-modal="true" aria-labelledby={`adjuntado-${title}`}>
      <div className={`aviso ${rejected ? "aviso-rechazo" : ""}`}>
        <p className="aviso-eyebrow">{rejected ? "No aceptado" : "Adjuntado"}</p>
        <p id={`adjuntado-${title}`} className="aviso-titulo">{title}</p>
        <p className="aviso-texto">{review.fileName}</p>
        {review.reviewed && v ? (
          <div className={`ia-veredicto ia-${v.tone}`}>
            <p className="font-semibold">
              Revisión de la IA de MANDO: {v.head}
              {review.verdict === "vigente" && review.expiresOn ? ` hasta el ${day(review.expiresOn)}` : ""}
              {review.verdict === "vencido" && review.expiresOn ? ` desde el ${day(review.expiresOn)}` : ""}
            </p>
            {review.summary && <p className="mt-1 text-sm">{review.summary}</p>}
            <p className="mt-2 text-xs opacity-80">
              {rejected
                ? "El documento vuelve a pendiente y la red flag sigue encendida. Quedó en la bitácora."
                : "Quedó en el expediente bajo tu declaración jurada y en la bitácora."}
            </p>
          </div>
        ) : (
          <p className="aviso-texto">{review.note ?? "Quedó en el expediente bajo tu declaración jurada."}</p>
        )}
        {rejected ? (
          <>
            <button type="button" autoFocus onClick={onRetry} className={`${buttonPrimary} w-full`}>
              Adjuntar otro documento
            </button>
            <button type="button" onClick={onClose} className={`${buttonGhost} mt-2 w-full`}>
              Cerrar
            </button>
          </>
        ) : (
          <button type="button" autoFocus onClick={onClose} className={`${buttonPrimary} w-full`}>
            Listo
          </button>
        )}
      </div>
    </div>
  );
}

/** «No aplica» y «Volver a pendiente». Un no negociable pide la razón. */
export function RequirementStatusButton({ requirementId, title, status, mandatory }: { requirementId: string; title: string; status: "pending" | "done" | "not_applicable"; mandatory: boolean }) {
  const [state, action, pending] = useActionState(setRequirementStatusAction, INITIAL);
  const [asking, setAsking] = useState(false);
  const reopen = status !== "pending";
  return (
    <form action={action}>
      <input type="hidden" name="requirement_id" value={requirementId} />
      <input type="hidden" name="status" value={reopen ? "pending" : "not_applicable"} />
      {asking ? (
        <div className="mt-2">
          <label htmlFor={`razon-${requirementId}`} className="block text-sm font-medium">
            ¿Por qué no aplica en este evento?
          </label>
          <textarea id={`razon-${requirementId}`} name="note" rows={2} required maxLength={300} className={`${inputClass} mt-1.5 py-2`} />
          <div className="mt-2 flex gap-2">
            <button type="submit" disabled={pending} className={buttonSecondary}>
              Confirmar que no aplica
            </button>
            <button type="button" onClick={() => setAsking(false)} className={buttonGhost}>
              Cancelar
            </button>
          </div>
        </div>
      ) : reopen ? (
        <button type="submit" disabled={pending} aria-label={`Volver a pendiente: ${title}`} className={buttonGhost}>
          Volver a pendiente
        </button>
      ) : mandatory ? (
        <button type="button" onClick={() => setAsking(true)} aria-label={`No aplica: ${title}`} className={buttonGhost}>
          No aplica
        </button>
      ) : (
        <button type="submit" disabled={pending} aria-label={`No aplica: ${title}`} className={buttonGhost}>
          No aplica
        </button>
      )}
      <Feedback state={state} />
    </form>
  );
}

/** Responsable y plazo de un documento. */
export function RequirementPlanForm({
  requirementId,
  title,
  timezone,
  ownerId,
  dueDate,
  team,
  ownerLocked = false,
  maxDate,
}: {
  requirementId: string;
  title: string;
  timezone: string;
  ownerId: string | null;
  dueDate: string;
  team: { id: string; name: string }[];
  /** Ya tiene responsable y quien mira no es backend: no puede cambiarlo. */
  ownerLocked?: boolean;
  /** Fecha tope (48 horas antes del evento), para los documentos previos. */
  maxDate?: string;
}) {
  const [state, action, pending] = useActionState(planRequirementAction, INITIAL);
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-medium text-ice-300">Responsable y plazo</summary>
      <form action={action} className="mt-2 grid gap-2">
        <input type="hidden" name="requirement_id" value={requirementId} />
        <input type="hidden" name="timezone" value={timezone} />
        <div>
          <label htmlFor={`resp-${requirementId}`} className="block font-medium">
            Quién lo sube
          </label>
          {ownerLocked && <input type="hidden" name="owner" value={ownerId ?? ""} />}
          <select id={`resp-${requirementId}`} name={ownerLocked ? undefined : "owner"} disabled={ownerLocked} defaultValue={ownerId ?? ""} aria-label={`Quién sube ${title}`} className={`${inputClass} mt-1`}>
            <option value="">Quien lo suba queda como responsable</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-muted">
            {ownerLocked
              ? "La línea legal no se quiebra: al responsable solo lo cambia el backend."
              : "Elige bien: una vez asignado, solo esa persona sube el documento y solo el backend puede cambiarla."}
          </p>
        </div>
        <div>
          <label htmlFor={`plazo-${requirementId}`} className="block font-medium">
            Plazo
          </label>
          <input id={`plazo-${requirementId}`} name="fecha" type="date" defaultValue={dueDate} max={maxDate} aria-label={`Plazo de ${title}`} className={`${inputClass} mt-1 font-mono`} />
          {maxDate && <p className="mt-1 text-xs text-ink-muted">Tope: 48 horas antes del evento.</p>}
        </div>
        <button type="submit" disabled={pending} className={`${buttonSecondary} justify-self-start`}>
          {pending ? "Guardando…" : "Guardar"}
        </button>
        <Feedback state={state} />
      </form>
    </details>
  );
}

export function AddRequirementForm({ eventId, timezone, categories }: { eventId: string; timezone: string; categories: { clave: string; nombre: string }[] }) {
  const [state, action, pending] = useActionState(addRequirementAction, INITIAL);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="timezone" value={timezone} />
      <div>
        <label htmlFor="doc-titulo" className="block text-sm font-medium">
          Documento
        </label>
        <input id="doc-titulo" name="titulo" required maxLength={120} placeholder="Permiso de la junta de vecinos" className={`${inputClass} mt-1.5`} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="doc-categoria" className="block text-sm font-medium">
            Grupo
          </label>
          <select id="doc-categoria" name="categoria" className={`${inputClass} mt-1.5`}>
            {categories.map((c) => (
              <option key={c.clave} value={c.clave}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="doc-fecha" className="block text-sm font-medium">
            Plazo
          </label>
          <input id="doc-fecha" name="fecha" type="date" className={`${inputClass} mt-1.5 font-mono`} />
        </div>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" name="no_negociable" value="si" className="size-5 accent-[var(--gold-300)]" />
        Es no negociable
      </label>
      <button type="submit" disabled={pending} className={`${buttonSecondary} justify-self-start`}>
        {pending ? "Guardando…" : "Agregar al expediente"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

// --------------------------------------------------------------------------- Locación

export type LocationValues = {
  meetingPoint: string;
  mapUrl: string;
  coordinator: string;
  coordinatorPhone: string;
  transportPlate: string;
  transportDetail: string;
  antecedents: string[];
  killerZones: string;
  blindSpots: string;
};

export function LocationForm({ eventId, values }: { eventId: string; values: LocationValues }) {
  const [state, action, pending] = useActionState(setLocationAction, INITIAL);
  const slots = [0, 1, 2].map((i) => values.antecedents[i] ?? "");
  const field = (id: string, name: string, label: string, value: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input id={id} name={name} defaultValue={value} maxLength={300} autoComplete="off" className={`${inputClass} mt-1.5`} {...extra} />
    </div>
  );
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="event_id" value={eventId} />
      {field("loc-punto", "punto", "Punto de encuentro", values.meetingPoint, { placeholder: "Puerta 3, frente al estacionamiento" })}
      {field("loc-mapa", "mapa", "Enlace del mapa", values.mapUrl, { type: "url", inputMode: "url", placeholder: "https://maps.app.goo.gl/…", maxLength: 500 })}
      <div className="grid grid-cols-2 gap-3">
        {field("loc-coordina", "coordina", "Quién coordina", values.coordinator)}
        {field("loc-telefono", "telefono", "Su teléfono", values.coordinatorPhone, { type: "tel", inputMode: "tel", maxLength: 30 })}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {field("loc-placa", "placa", "Placa del transporte", values.transportPlate, { maxLength: 15, className: `${inputClass} mt-1.5 font-mono uppercase` })}
        {field("loc-transporte", "transporte", "Vehículo y conductor", values.transportDetail)}
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Antecedentes del lugar</legend>
        <p className="mt-0.5 text-xs text-ink-muted">Lo que ya pasó antes en esta locación, contado por el cliente o por el equipo.</p>
        <div className="mt-1.5 grid gap-2">
          {slots.map((value, i) => (
            <input
              key={i}
              name="antecedente"
              defaultValue={value}
              maxLength={300}
              aria-label={`Antecedente ${i + 1}`}
              placeholder={i === 0 ? "No hay cajas de luz cerca del punto" : i === 1 ? "El colegio de al lado prohíbe sonido antes de las 3 p. m." : ""}
              className={inputClass}
            />
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="loc-killer" className="block text-sm font-medium">
          Zonas killer
        </label>
        <textarea id="loc-killer" name="zonas_killer" rows={2} maxLength={500} defaultValue={values.killerZones} placeholder="Dónde no funciona la activación o está prohibido." className={`${inputClass} mt-1.5 py-2`} />
      </div>
      <div>
        <label htmlFor="loc-ciegos" className="block text-sm font-medium">
          Puntos ciegos
        </label>
        <textarea id="loc-ciegos" name="puntos_ciegos" rows={2} maxLength={500} defaultValue={values.blindSpots} placeholder="Lo que no se ve desde el puesto de mando." className={`${inputClass} mt-1.5 py-2`} />
      </div>
      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "Guardando…" : "Guardar locación"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
