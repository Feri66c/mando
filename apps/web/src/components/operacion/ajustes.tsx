"use client";

// Piezas de los ajustes dictados por Fer (decisiones 42 a 48): documento y «No aplica» en Técnico,
// adicionales del presupuesto, y los formularios del backend.

import { useActionState, useRef, useState } from "react";
import {
  applyDeadlineAction,
  attachTechDocAction,
  decideBudgetExtraAction,
  openBudgetExtrasAction,
  requestBudgetExtraAction,
  requestTechNaAction,
  reviewRoleAction,
  reviewTechNaAction,
  sendClientNoticeAction,
  sendInstructionAction,
  setDeadlineAction,
} from "@/app/actions/planificacion";
import type { CierreState } from "@/app/actions/cierre";
import { MAX_EVIDENCE_BYTES, requirementPath } from "@mando/core/evidence";
import { BUDGET_EXTRA_LABEL, type BudgetExtraKind } from "@mando/core/data";
import { getBrowserClient } from "@/lib/supabase/browser";
import { buttonGhost, buttonPrimary, buttonSecondary, inputClass } from "./ui";

const INITIAL: CierreState = { ok: false, error: null };

function Feedback({ state }: { state: CierreState }) {
  if (state.error)
    return (
      <p role="alert" className="mt-2 border border-critical/40 bg-critical/10 px-3 py-2 text-sm">
        {state.error}
      </p>
    );
  if (state.ok && state.message)
    return (
      <p role="status" className="mt-2 text-sm text-ok">
        {state.message}
      </p>
    );
  return null;
}

// --------------------------------------------------------------------------- Técnico

/** «Adjuntar»: abre de inmediato la ventana para elegir el archivo, lo sube y deja el concepto confirmado. */
export function TechDocUpload({ eventId, itemId, title, docName }: { eventId: string; itemId: string; title: string; docName: string | null }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<CierreState & { working?: string }>(INITIAL);

  async function save(file: File | null) {
    if (!file) return;
    try {
      if (file.size > MAX_EVIDENCE_BYTES) throw new Error("El archivo pesa más de 50 MB.");
      const supabase = getBrowserClient();
      if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
      const filePath = requirementPath(eventId, crypto.randomUUID(), file.name);
      setState({ ...INITIAL, working: "Subiendo…" });
      const { error } = await supabase.storage.from("evidences").upload(filePath, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (error) throw new Error(/row-level|policy|permission/i.test(error.message) ? "No tienes permiso para subir documentos aquí." : `No se pudo subir: ${error.message}`);
      setState(await attachTechDocAction({ itemId, filePath, fileName: file.name }));
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
        aria-label={`Documento de ${title}`}
        accept="application/pdf,image/*,.xls,.xlsx,.csv,.doc,.docx"
        onChange={(e) => void save(e.target.files?.[0] ?? null)}
      />
      <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} aria-label={`${docName ? "Cambiar el documento" : "Adjuntar"}: ${title}`} className={`${docName ? buttonGhost : buttonPrimary} w-full`}>
        {busy ? "Subiendo…" : docName ? "Cambiar" : "Adjuntar"}
      </button>
      <Feedback state={state} />
    </div>
  );
}

/** «No aplica», al costado de cada concepto: va al backend para su revisión. */
export function TechNaButton({ itemId, title, requested }: { itemId: string; title: string; requested: boolean }) {
  const [state, action, pending] = useActionState(requestTechNaAction, INITIAL);
  return (
    <form action={action}>
      <input type="hidden" name="item_id" value={itemId} />
      <button type="submit" disabled={pending || requested} aria-label={`No aplica: ${title}`} aria-pressed={requested} className={`${buttonSecondary} w-full !text-[var(--naranja)]`}>
        {requested ? "No aplica ✓" : "No aplica"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/** El backend revisa un «No aplica»: sí aplica (sigue bloqueando) o lo acepta. */
export function TechNaReview({ itemId, title }: { itemId: string; title: string }) {
  const [state, action, pending] = useActionState(reviewTechNaAction, INITIAL);
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="item_id" value={itemId} />
      <div className="flex gap-2">
        <button type="submit" name="aplica" value="si" disabled={pending} aria-label={`Sí aplica: ${title}`} className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full bg-critical px-4 text-sm font-semibold text-white disabled:opacity-60">
          Sí aplica
        </button>
        <button type="submit" name="aplica" value="no" disabled={pending} aria-label={`Aceptar que no aplica: ${title}`} className={`${buttonSecondary} flex-1`}>
          Aceptar
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

/** El backend aprueba un cargo propuesto: pasa al catálogo de toda la organización. */
export function RoleReview({ roleId, name }: { roleId: string; name: string }) {
  const [state, action, pending] = useActionState(reviewRoleAction, INITIAL);
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="role_id" value={roleId} />
      <div className="flex gap-2">
        <button type="submit" name="decision" value="approve" disabled={pending} aria-label={`Aprobar cargo: ${name}`} className={`${buttonPrimary} flex-1`}>
          Aprobar
        </button>
        <button type="submit" name="decision" value="reject" disabled={pending} aria-label={`No aprobar cargo: ${name}`} className={`${buttonGhost} flex-1`}>
          No aprobar
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

// --------------------------------------------------------------------------- Presupuesto

type Extra = { id: string; kind: BudgetExtraKind; note: string | null; status: "requested" | "approved" | "rejected" };
const EXTRA_STATE = { requested: "Solicitado", approved: "Aprobado", rejected: "No aprobado" } as const;

/** El productor marca los adicionales que necesita. Solo aparece si el backend abrió la opción. */
export function BudgetExtrasRequest({ eventId, extras }: { eventId: string; extras: Extra[] }) {
  const [state, action, pending] = useActionState(requestBudgetExtraAction, INITIAL);
  const kinds: BudgetExtraKind[] = ["personal", "tecnico", "locacion"];
  return (
    <form action={action}>
      <input type="hidden" name="event_id" value={eventId} />
      <ul className="divide-y divide-line">
        {kinds.map((k) => {
          const last = [...extras].reverse().find((x) => x.kind === k);
          const open = last?.status === "requested";
          return (
            <li key={k} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1 text-base font-medium">{BUDGET_EXTRA_LABEL[k]}</span>
              {last && <span className={`font-mono text-xs font-semibold uppercase tracking-wider ${last.status === "approved" ? "text-ok" : last.status === "rejected" ? "text-[#ff6f86]" : "text-gold-300"}`}>{EXTRA_STATE[last.status]}</span>}
              {!open && (
                <button type="submit" name="tipo" value={k} disabled={pending} aria-label={`Solicitar: ${BUDGET_EXTRA_LABEL[k]}`} className={buttonSecondary}>
                  Solicitar
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-sm text-ink-muted">Lo que solicites va al backend para que lo apruebe y actualice el monto.</p>
      <Feedback state={state} />
    </form>
  );
}

/** El backend abre o cierra la opción de adicionales. */
export function BudgetExtrasToggle({ eventId, open }: { eventId: string; open: boolean }) {
  const [state, action, pending] = useActionState(openBudgetExtrasAction, INITIAL);
  return (
    <form action={action}>
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="abrir" value={open ? "no" : "si"} />
      <button type="submit" disabled={pending} className={open ? buttonGhost : buttonSecondary}>
        {open ? "Cerrar adicionales" : "Abrir adicionales"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/** El backend aprueba o rechaza un adicional solicitado. */
export function BudgetExtraDecision({ extraId, label }: { extraId: string; label: string }) {
  const [state, action, pending] = useActionState(decideBudgetExtraAction, INITIAL);
  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="extra_id" value={extraId} />
      <div className="flex gap-2">
        <button type="submit" name="decision" value="aprobar" disabled={pending} aria-label={`Aprobar: ${label}`} className={`${buttonPrimary} flex-1`}>
          Aprobar
        </button>
        <button type="submit" name="decision" value="rechazar" disabled={pending} aria-label={`No aprobar: ${label}`} className={`${buttonSecondary} flex-1`}>
          No aprobar
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

// --------------------------------------------------------------------------- Backend

/** Plazo de la planificación: el backend lo fija y lo aplica. */
export function DeadlineForm({ eventId, hours }: { eventId: string; hours: number }) {
  const [saved, save, saving] = useActionState(setDeadlineAction, INITIAL);
  const [applied, apply, applying] = useActionState(applyDeadlineAction, INITIAL);
  return (
    <div>
      <form action={save} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="event_id" value={eventId} />
        <div className="min-w-0 flex-1">
          <label htmlFor="plazo-horas" className="block text-sm font-medium">
            Horas antes del evento
          </label>
          <input id="plazo-horas" name="horas" type="number" inputMode="numeric" min={1} max={72} defaultValue={hours} className={`${inputClass} mt-1.5 font-mono`} />
        </div>
        <button type="submit" disabled={saving} className={buttonSecondary}>
          Guardar plazo
        </button>
      </form>
      <Feedback state={saved} />
      <form action={apply} className="mt-3">
        <input type="hidden" name="event_id" value={eventId} />
        <button type="submit" disabled={applying} className={`${buttonSecondary} w-full`}>
          Aplicar el plazo ahora
        </button>
      </form>
      <Feedback state={applied} />
    </div>
  );
}

/** Instrucción al productor: le llega como aviso y queda en la bitácora. */
export function InstructionForm({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState(sendInstructionAction, INITIAL);
  return (
    <form action={action} key={state.ok ? "enviada" : "nueva"}>
      <input type="hidden" name="event_id" value={eventId} />
      <label htmlFor="instruccion" className="sr-only">
        Instrucción
      </label>
      <textarea id="instruccion" name="texto" rows={2} maxLength={500} required placeholder="Ejemplo: adelanta la prueba de sonido 30 minutos." className={`${inputClass} py-2`} />
      <button type="submit" disabled={pending} className={`${buttonPrimary} mt-3 w-full`}>
        {pending ? "Enviando…" : "Enviar al productor"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/** Observaciones para el cliente y el aviso propio, que se despliega con un botón. */
export function ClientNoticeForm({ eventId, presets }: { eventId: string; presets: readonly string[] }) {
  const [state, action, pending] = useActionState(sendClientNoticeAction, INITIAL);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-[var(--naranja)]">Observaciones</p>
      <p className="mt-1 text-sm text-ink-muted">Lo que impide que la barra complete su color.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {presets.map((p) => (
          <form action={action} key={p}>
            <input type="hidden" name="event_id" value={eventId} />
            <input type="hidden" name="tipo" value="observation" />
            <input type="hidden" name="texto" value={p} />
            <button type="submit" disabled={pending} className={buttonSecondary}>
              {p}
            </button>
          </form>
        ))}
      </div>
      {open ? (
        <form action={action} className="mt-4" key={state.ok ? "enviado" : "nuevo"}>
          <input type="hidden" name="event_id" value={eventId} />
          <label htmlFor="aviso-propio" className="block text-sm font-medium">
            Tu propio aviso
          </label>
          <input id="aviso-propio" name="texto" maxLength={500} required placeholder="Ejemplo: falta la orden de compra" className={`${inputClass} mt-1.5`} />
          <div className="mt-3 flex gap-2">
            <button type="submit" name="tipo" value="ok" disabled={pending} className={`${buttonPrimary} flex-1`}>
              Todo OK
            </button>
            <button type="submit" name="tipo" value="unconfirmed" disabled={pending} className={`${buttonSecondary} flex-1 !text-[var(--naranja)]`}>
              Sin confirmación
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={`${buttonGhost} mt-4`}>
          Escribir mi propio aviso
        </button>
      )}
      <Feedback state={state} />
    </div>
  );
}
