"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  ackAlertAction,
  addCommitmentAction,
  answerCheckAction,
  checkCommitmentAction,
  confirmChangeAction,
  createMomentAction,
  markItemAction,
  raiseAlertAction,
  requestChangeAction,
  resolveAlertAction,
  resolveMomentAction,
  type ActionState,
  type ChangePreview,
} from "@/app/actions/operacion";
import { COMMITMENT_OUTCOME_LABEL, type CommitmentOutcome } from "@mando/core/labels";
import { formatShift } from "@mando/core/route";
import type { MomentTemplate } from "@mando/core/templates";
import { formatTime, wallTimeToIso } from "@mando/core/time";
import { buttonGhost, buttonPrimary, buttonSecondary, inputClass } from "./ui";

const INITIAL: ActionState = { ok: false, error: null };

function Feedback({ state }: { state: ActionState }) {
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

function Submit({
  children,
  className = buttonSecondary,
  name,
  value,
  pendingLabel = "Guardando…",
}: {
  children: React.ReactNode;
  className?: string;
  name?: string;
  value?: string;
  pendingLabel?: string;
}) {
  const { pending, data } = useFormStatus();
  const mine = !name || data?.get(name) === value;
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={className}>
      {pending && mine ? pendingLabel : children}
    </button>
  );
}

// --------------------------------------------------------------------------- Empezó / Terminó

/** Botones de un toque. En Modo En Vivo son grandes; el principal (oro) es la siguiente acción lógica. */
export function MarkButtons({
  itemId,
  started,
  big = false,
  allowRisk = true,
}: {
  itemId: string;
  started: boolean;
  big?: boolean;
  allowRisk?: boolean;
}) {
  const [state, action] = useActionState(markItemAction, INITIAL);
  const size = big ? "min-h-16 w-full text-lg" : "";
  return (
    <form action={action}>
      <input type="hidden" name="item_id" value={itemId} />
      <div className={big ? "grid gap-3" : "flex flex-wrap gap-2"}>
        {started ? (
          <Submit name="action" value="finish" className={`${big ? buttonPrimary : buttonSecondary} ${size}`} pendingLabel="Marcando…">
            Terminó
          </Submit>
        ) : (
          <Submit name="action" value="start" className={`${big ? buttonPrimary : buttonSecondary} ${size}`} pendingLabel="Marcando…">
            Empezó
          </Submit>
        )}
        {allowRisk && (
          <Submit name="action" value="at_risk" className={`${buttonGhost} ${big ? "min-h-12 w-full" : ""}`} pendingLabel="Marcando…">
            En riesgo
          </Submit>
        )}
      </div>
      <Feedback state={state} />
    </form>
  );
}

// --------------------------------------------------------------------------- Cambios con vista previa

const EMPTY_PREVIEW: ChangePreview = { ok: false, error: null, requestId: null, affected: [] };

/**
 * «Dame una hora más». Paso 1: elegir el cambio y ver qué arrastra. Paso 2: confirmar.
 * Nada se mueve hasta confirmar (la IA o la pantalla proponen; la persona confirma).
 */
export function ChangeForm({
  itemId,
  currentStart,
  timeZone,
  canMoveStart,
}: {
  itemId: string;
  currentStart: string;
  timeZone: string;
  canMoveStart: boolean;
}) {
  const [preview, requestAction, requesting] = useActionState(requestChangeAction, EMPTY_PREVIEW);
  const [confirmState, confirmAction] = useActionState(confirmChangeAction, INITIAL);
  const [kind, setKind] = useState<"extend" | "move">("extend");
  const [mode, setMode] = useState<"minutes" | "time">("minutes");
  const [time, setTime] = useState("");
  const [dismissed, setDismissed] = useState<string | null>(null);

  const done = confirmState.ok;
  const showPreview = preview.requestId && preview.requestId !== dismissed && !(done && confirmState.message);
  const newStartIso = kind === "move" && mode === "time" ? wallTimeToIso(time, currentStart, timeZone) : null;

  return (
    <div>
      <form action={requestAction} className="space-y-3" onSubmit={() => setDismissed(null)}>
        <input type="hidden" name="item_id" value={itemId} />
        <input type="hidden" name="kind" value={kind} />
        {newStartIso && <input type="hidden" name="new_start" value={newStartIso} />}
        <fieldset>
          <legend className="sr-only">Tipo de cambio</legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["extend", "Más o menos tiempo"],
                ["move", "Mover de hora"],
              ] as const
            ).map(([k, label]) => (
              <label
                key={k}
                className={`flex min-h-11 cursor-pointer items-center justify-center rounded-full px-3 text-sm font-semibold ${
                  kind === k ? "bg-ink text-navy-950" : "bg-surface-200 text-ink"
                } ${k === "move" && !canMoveStart ? "pointer-events-none opacity-50" : ""}`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  checked={kind === k}
                  disabled={k === "move" && !canMoveStart}
                  onChange={() => setKind(k)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {kind === "move" && (
          <div className="flex gap-2 text-sm">
            <button type="button" onClick={() => setMode("minutes")} className={mode === "minutes" ? buttonSecondary : buttonGhost}>
              Por minutos
            </button>
            <button type="button" onClick={() => setMode("time")} className={mode === "time" ? buttonSecondary : buttonGhost}>
              A una hora
            </button>
          </div>
        )}

        {kind === "move" && mode === "time" ? (
          <label className="block text-sm">
            <span className="mb-1 block text-ink-muted">Nueva hora de inicio</span>
            <input
              type="time"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          </label>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2" role="radiogroup" aria-label="Sentido">
              <label className="flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-full bg-surface-200 text-sm font-semibold has-checked:bg-ink has-checked:text-navy-950">
                <input type="radio" name="sign" value="+" defaultChecked className="sr-only" />
                {kind === "extend" ? "Agregar" : "Más tarde"}
              </label>
              <label className="flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-full bg-surface-200 text-sm font-semibold has-checked:bg-ink has-checked:text-navy-950">
                <input type="radio" name="sign" value="-" className="sr-only" />
                {kind === "extend" ? "Quitar" : "Más temprano"}
              </label>
            </div>
            <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Minutos">
              {[15, 30, 60, 90].map((m) => (
                <label
                  key={m}
                  className="flex min-h-11 cursor-pointer items-center justify-center rounded-full bg-surface-200 font-mono text-sm has-checked:bg-ink has-checked:text-navy-950"
                >
                  <input type="radio" name="minutes" value={m} defaultChecked={m === 60} className="sr-only" />
                  {m} min
                </label>
              ))}
            </div>
          </div>
        )}

        <label className="block text-sm">
          <span className="mb-1 block text-ink-muted">Motivo (opcional)</span>
          <input name="reason" placeholder="Ej.: el proveedor llegó tarde" className={inputClass} />
        </label>

        <button type="submit" disabled={requesting} className={`${buttonSecondary} w-full`}>
          {requesting ? "Calculando…" : "Ver cómo queda"}
        </button>
        <Feedback state={preview} />
      </form>

      {showPreview && (
        <div className="mt-4 rounded-card border border-gold-500/60 bg-surface-000 p-4" aria-live="polite">
          <p className="font-display text-base font-semibold">Así queda la hoja de ruta</p>
          <ul className="mt-3 space-y-2">
            {preview.affected.map((a) => {
              const shift = Math.round((Date.parse(a.new_start) - Date.parse(a.old_start)) / 60000);
              return (
                <li key={a.item_id} className="flex items-start justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium">{a.title}</span>
                    {a.is_milestone && <span className="ml-2 text-xs font-semibold uppercase text-gold-300">Hito</span>}
                    {!a.is_target && <span className="ml-2 text-xs text-ink-muted">se arrastra</span>}
                  </span>
                  <span className="shrink-0 text-right font-mono">
                    <span className="text-ink-muted line-through">{formatTime(a.old_start, timeZone)}–{formatTime(a.old_end, timeZone)}</span>
                    <br />
                    {formatTime(a.new_start, timeZone)}–{formatTime(a.new_end, timeZone)}
                    {shift !== 0 && <span className="ml-1 text-xs text-ink-muted">({formatShift(shift)})</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {preview.affected.length <= 1 && <p className="mt-2 text-sm text-ink-muted">No arrastra otras actividades.</p>}
          <form action={confirmAction} className="mt-4 grid grid-cols-2 gap-2">
            <input type="hidden" name="request_id" value={preview.requestId ?? ""} />
            <button type="button" className={buttonGhost} onClick={() => setDismissed(preview.requestId)}>
              Cancelar
            </button>
            <Submit className={buttonPrimary} pendingLabel="Aplicando…">
              Confirmar cambio
            </Submit>
          </form>
          <Feedback state={confirmState} />
        </div>
      )}
      {done && !showPreview && <Feedback state={confirmState} />}
    </div>
  );
}

// --------------------------------------------------------------------------- Momentos críticos

export function AnswerForm({ checkId, question, answer }: { checkId: string; question: string; answer: string | null }) {
  const [state, action] = useActionState(answerCheckAction, INITIAL);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="check_id" value={checkId} />
      <label className="block">
        <span className="mb-1 block font-medium">{question}</span>
        <textarea name="answer" rows={2} defaultValue={answer ?? ""} required className={`${inputClass} py-2`} />
      </label>
      <Submit className={buttonSecondary}>{answer ? "Actualizar respuesta" : "Guardar respuesta"}</Submit>
      <Feedback state={state} />
    </form>
  );
}

const OUTCOME_STYLE: Record<CommitmentOutcome, string> = {
  met: "has-checked:bg-[#4fbf8b] has-checked:text-navy-950",
  partial: "has-checked:bg-gold-500 has-checked:text-navy-950",
  unmet: "has-checked:bg-[#b3402e] has-checked:text-white",
};

/** Prometido contra entregado: lo encontrado y si se cumplió, fue parcial o no se cumplió. */
export function CommitmentForm({
  commitmentId,
  found,
  outcome,
}: {
  commitmentId: string;
  found: string | null;
  outcome: CommitmentOutcome | null;
}) {
  const [state, action] = useActionState(checkCommitmentAction, INITIAL);
  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="commitment_id" value={commitmentId} />
      <label className="block text-sm">
        <span className="mb-1 block text-ink-muted">Encontrado</span>
        <input name="found" defaultValue={found ?? ""} placeholder="Ej.: 24 canales" className={inputClass} />
      </label>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Resultado">
        {(["met", "partial", "unmet"] as const).map((o) => (
          <label
            key={o}
            className={`flex min-h-11 cursor-pointer items-center justify-center rounded-full bg-surface-200 text-sm font-semibold ${OUTCOME_STYLE[o]}`}
          >
            <input type="radio" name="outcome" value={o} defaultChecked={outcome === o} required className="sr-only" />
            {COMMITMENT_OUTCOME_LABEL[o]}
          </label>
        ))}
      </div>
      <Submit className={`${buttonSecondary} w-full`}>Registrar</Submit>
      <Feedback state={state} />
    </form>
  );
}

export function AddCommitmentForm({ momentId }: { momentId: string }) {
  const [state, action] = useActionState(addCommitmentAction, INITIAL);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="moment_id" value={momentId} />
      <input name="label" required placeholder="Qué (ej.: Consola)" className={inputClass} aria-label="Qué se prometió" />
      <input name="promised" required placeholder="Prometido (ej.: 32 canales)" className={inputClass} aria-label="Detalle de lo prometido" />
      <Submit className={buttonGhost}>Agregar compromiso</Submit>
      <Feedback state={state} />
    </form>
  );
}

export function ResolveMomentForm({ momentId }: { momentId: string }) {
  const [state, action] = useActionState(resolveMomentAction, INITIAL);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="moment_id" value={momentId} />
      <label className="block text-sm">
        <span className="mb-1 block text-ink-muted">¿Cómo terminó?</span>
        <textarea name="resolution" rows={2} required placeholder="Ej.: el proveedor trajo otra consola a las 15:40" className={`${inputClass} py-2`} />
      </label>
      <Submit className={buttonPrimary}>Resolver momento</Submit>
      <Feedback state={state} />
    </form>
  );
}

export function CreateMomentForm({
  eventId,
  templates,
  items,
  defaultItemId,
  defaultTemplate,
}: {
  eventId: string;
  templates: MomentTemplate[];
  items: { id: string; title: string }[];
  defaultItemId?: string | null;
  defaultTemplate?: string | null;
}) {
  const [state, action] = useActionState(createMomentAction, INITIAL);
  const [key, setKey] = useState(defaultTemplate ?? templates[0]?.clave ?? "");
  const template = templates.find((t) => t.clave === key) ?? null;
  if (state.ok && state.momentId) {
    return (
      <p role="status" className="text-sm text-[#8fe0b8]">
        Momento abierto.{" "}
        <a className="font-semibold underline" href={`/eventos/${eventId}/momentos/${state.momentId}`}>
          Ir a responder las preguntas
        </a>
      </p>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="event_id" value={eventId} />
      <label className="block text-sm">
        <span className="mb-1 block text-ink-muted">Plantilla</span>
        <select name="template_key" value={key} onChange={(e) => setKey(e.target.value)} className={inputClass}>
          {templates.map((t) => (
            <option key={t.clave} value={t.clave}>
              {t.nombre} · {t.area}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-ink-muted">Actividad</span>
        <select name="route_item_id" defaultValue={defaultItemId ?? ""} className={inputClass}>
          <option value="">Sin actividad</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.title}
            </option>
          ))}
        </select>
      </label>
      {template && (
        <div className="space-y-2">
          <p className="text-sm text-ink-muted">
            Preguntas: {template.preguntas.length}. ¿Qué prometió el proveedor? (deja vacío lo que no aplique)
          </p>
          {template.compromisos_tipicos.map((label) => (
            <label key={label} className="block text-sm">
              <span className="mb-1 block">{label}</span>
              <input name={`promised:${label}`} placeholder="Prometido" className={inputClass} />
            </label>
          ))}
        </div>
      )}
      <Submit className={buttonPrimary} pendingLabel="Abriendo…">
        Abrir momento crítico
      </Submit>
      <Feedback state={state} />
    </form>
  );
}

// --------------------------------------------------------------------------- Alertas

export function AlertActions({ alertId, status }: { alertId: string; status: "open" | "acknowledged" | "resolved" }) {
  const [ackState, ack] = useActionState(ackAlertAction, INITIAL);
  const [resState, resolve] = useActionState(resolveAlertAction, INITIAL);
  const [showNote, setShowNote] = useState(false);
  if (status === "resolved") return null;
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {status === "open" && (
          <form action={ack}>
            <input type="hidden" name="alert_id" value={alertId} />
            <Submit className={buttonSecondary}>Reconocer</Submit>
          </form>
        )}
        {!showNote && (
          <button type="button" className={buttonGhost} onClick={() => setShowNote(true)}>
            Resolver
          </button>
        )}
      </div>
      {showNote && (
        <form action={resolve} className="mt-2 space-y-2">
          <input type="hidden" name="alert_id" value={alertId} />
          <input name="note" placeholder="Cómo se resolvió (opcional)" className={inputClass} aria-label="Cómo se resolvió" />
          <Submit className={buttonSecondary}>Marcar resuelta</Submit>
        </form>
      )}
      <Feedback state={ackState.error ? ackState : resState} />
    </div>
  );
}

export function RaiseAlertForm({
  eventId,
  levels,
  items,
}: {
  eventId: string;
  levels: { nivel: number; nombre: string; descripcion: string }[];
  items: { id: string; title: string }[];
}) {
  const [state, action] = useActionState(raiseAlertAction, INITIAL);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="event_id" value={eventId} />
      <label className="block text-sm">
        <span className="mb-1 block text-ink-muted">¿Qué pasa?</span>
        <input name="title" required placeholder="Ej.: no llegó el técnico de sala" className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-ink-muted">Detalle (opcional)</span>
        <textarea name="detail" rows={2} className={`${inputClass} py-2`} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-ink-muted">Actividad (opcional)</span>
        <select name="route_item_id" defaultValue="" className={inputClass}>
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
              <input type="radio" name="level" value={l.nivel} defaultChecked={l.nivel === 2} className="size-4 accent-[#f7f9fc]" />
              <span>
                <span className="font-semibold">{l.nombre}</span>
                <span className="block text-xs text-ink-muted">{l.descripcion}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Submit className={buttonPrimary} pendingLabel="Levantando…">
        Levantar alerta
      </Submit>
      <Feedback state={state} />
    </form>
  );
}
