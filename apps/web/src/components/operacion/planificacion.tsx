"use client";

import { useActionState, useRef, useState } from "react";
import type { CierreState } from "@/app/actions/cierre";
import {
  addBudgetLineAction,
  addTechItemAction,
  assignPersonAction,
  decideBudgetAction,
  removeBudgetLineAction,
  savePersonAction,
  setBudgetAction,
  setTechItemAction,
} from "@/app/actions/planificacion";
import { MAX_EVIDENCE_BYTES, personFilePath } from "@mando/core/evidence";
import { DOC_TYPES, cleanDocNumber, docType } from "@mando/core/casting";
import { getBrowserClient } from "@/lib/supabase/browser";
import { NextSteps, SelectWithAdd } from "./mando";
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

// --------------------------------------------------------------------------- Personal

async function uploadPersonFile(organizationId: string, kind: "foto" | "dni", file: File): Promise<string> {
  if (file.size > MAX_EVIDENCE_BYTES) throw new Error("El archivo pesa más de 50 MB.");
  const supabase = getBrowserClient();
  if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
  const path = personFilePath(organizationId, kind, crypto.randomUUID(), file.name);
  const { error } = await supabase.storage.from("evidences").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (error) throw new Error(/row-level|policy|permission/i.test(error.message) ? "No tienes permiso para subir archivos aquí." : `No se pudo subir: ${error.message}`);
  return path;
}

export type PersonValues = { id: string; fullName: string; docType: string; docNumber: string; docExpiresOn: string; phone: string; role: string };

/**
 * Ficha de una persona: nombre, cargo, documento con su vigencia, foto y copia del documento.
 * Sirve para registrar y para corregir. Al registrar no vuelve a cero: ofrece «Siguiente» y a dónde ir.
 */
export function PersonForm({ eventId, organizationId, roles, person }: { eventId: string; organizationId: string; roles: readonly string[]; person?: PersonValues }) {
  const photoRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<Working>(INITIAL);
  const [round, setRound] = useState(0);
  const [type, setType] = useState(docType(person?.docType).clave);
  const [number, setNumber] = useState(person?.docNumber ?? "");
  const busy = Boolean(state.working);
  const uid = person?.id ?? "nueva";
  const doc = docType(type);
  const short = number.length > 0 && number.length < doc.largo_min;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      const photo = photoRef.current?.files?.[0];
      const copy = docRef.current?.files?.[0];
      if (photo || copy) setState({ ...INITIAL, working: "Subiendo…" });
      const photoPath = photo ? await uploadPersonFile(organizationId, "foto", photo) : null;
      const docPath = copy ? await uploadPersonFile(organizationId, "dni", copy) : null;
      setState({ ...INITIAL, working: "Guardando…" });
      setState(
        await savePersonAction({
          eventId,
          personId: person?.id ?? null,
          fullName: String(fd.get("nombre") ?? ""),
          docType: type,
          docNumber: number,
          docExpiresOn: String(fd.get("vence") ?? ""),
          phone: String(fd.get("telefono") ?? ""),
          role: String(fd.get("rol") ?? ""),
          photoPath,
          docPath,
          assign: !person,
          proposeRole: fd.get("rol_nuevo") === "si",
        }),
      );
    } catch (err) {
      setState({ ok: false, error: err instanceof Error ? err.message : "No se pudo guardar." });
    }
  }

  function next() {
    setState(INITIAL);
    setNumber("");
    setRound((r) => r + 1);
  }

  if (!person && state.ok && state.message)
    return <NextSteps eventId={eventId} message={state.message} nextLabel="Siguiente persona" onNext={next} current="personal" />;

  const fileClass = "mt-1.5 block w-full text-sm text-ink-muted file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-surface-200 file:px-4 file:text-sm file:font-semibold file:text-ink";
  return (
    <form key={round} onSubmit={submit} className="grid gap-3">
      <div>
        <label htmlFor={`p-nombre-${uid}`} className="block text-sm font-medium">
          Nombre completo
        </label>
        <input id={`p-nombre-${uid}`} name="nombre" required maxLength={120} defaultValue={person?.fullName} autoComplete="off" autoFocus={!person && round > 0} className={`${inputClass} mt-1.5`} />
      </div>
      <div>
        <label htmlFor={`p-rol-${uid}`} className="block text-sm font-medium">
          Cargo
        </label>
        <div className="mt-1.5">
          <SelectWithAdd id={`p-rol-${uid}`} name="rol" options={roles} defaultValue={person?.role ?? ""} placeholder="Elige el cargo" addLabel="Agregar otro cargo" required={!person} ariaLabel="Cargo" />
        </div>
        <p className="mt-1 text-xs text-ink-muted">Si no está en la lista, agrégalo. El backend lo aprueba y queda para todos.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`p-tipo-${uid}`} className="block text-sm font-medium">
            Documento
          </label>
          <select
            id={`p-tipo-${uid}`}
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setNumber(cleanDocNumber(e.target.value, number));
            }}
            className={`${inputClass} mt-1.5`}
          >
            {DOC_TYPES.map((d) => (
              <option key={d.clave} value={d.clave}>
                {d.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`p-dni-${uid}`} className="block text-sm font-medium">
            Número
          </label>
          <input
            id={`p-dni-${uid}`}
            name="dni"
            value={number}
            onChange={(e) => setNumber(cleanDocNumber(type, e.target.value))}
            inputMode={doc.solo_numeros ? "numeric" : "text"}
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={doc.largo_max}
            aria-describedby={`p-dni-ayuda-${uid}`}
            aria-invalid={short}
            className={`${inputClass} mt-1.5 font-mono ${short ? "border-[#ff6f86]" : ""}`}
          />
        </div>
        <p id={`p-dni-ayuda-${uid}`} className={`col-span-2 -mt-1.5 font-mono text-xs ${short ? "text-[#ff6f86]" : "text-ink-muted"}`}>
          {doc.ayuda} · {number.length} de {doc.largo_max}
        </p>
      </div>
      <div>
        <label htmlFor={`p-vence-${uid}`} className="block text-sm font-medium">
          Vence el
        </label>
        <input id={`p-vence-${uid}`} name="vence" type="date" defaultValue={person?.docExpiresOn} className={`${inputClass} mt-1.5 font-mono`} />
      </div>
      <div>
        <label htmlFor={`p-tel-${uid}`} className="block text-sm font-medium">
          Teléfono
        </label>
        <input id={`p-tel-${uid}`} name="telefono" type="tel" inputMode="tel" maxLength={30} defaultValue={person?.phone} className={`${inputClass} mt-1.5`} />
      </div>
      <div>
        <label htmlFor={`p-foto-${uid}`} className="block text-sm font-medium">
          Foto (basta una del celular)
        </label>
        <input ref={photoRef} id={`p-foto-${uid}`} type="file" accept="image/*" className={fileClass} />
      </div>
      <div>
        <label htmlFor={`p-copia-${uid}`} className="block text-sm font-medium">
          Copia del {doc.nombre === "DNI" ? "DNI" : doc.nombre.toLowerCase()}
        </label>
        <input ref={docRef} id={`p-copia-${uid}`} type="file" accept="image/*,application/pdf" className={fileClass} />
      </div>
      <button type="submit" disabled={busy || short} className={`${person ? buttonSecondary : buttonPrimary} justify-self-start`}>
        {busy ? "Guardando…" : person ? "Guardar ficha" : "Registrar y sumar al evento"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/** El check: sumar al evento a alguien que ya está en la base, o quitarlo. */
export function AssignToggle({ eventId, personId, name, assigned, role }: { eventId: string; personId: string; name: string; assigned: boolean; role: string | null }) {
  const [state, action, pending] = useActionState(assignPersonAction, INITIAL);
  return (
    <form action={action}>
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="person_id" value={personId} />
      <input type="hidden" name="role" value={role ?? ""} />
      <input type="hidden" name="assigned" value={assigned ? "no" : "si"} />
      <button
        type="submit"
        role="checkbox"
        aria-checked={assigned}
        aria-label={`${name} va a este evento`}
        disabled={pending}
        className={`grid size-11 place-items-center border-2 font-mono text-xl ${assigned ? "border-gold-300 bg-gold-300 text-navy-950" : "border-line text-transparent"}`}
      >
        ✓
      </button>
      <Feedback state={state} />
    </form>
  );
}

// --------------------------------------------------------------------------- Técnico

export function TechItemActions({ itemId, title, status, canRemove }: { itemId: string; title: string; status: "pending" | "confirmed" | "not_applicable"; canRemove: boolean }) {
  const [state, action, pending] = useActionState(setTechItemAction, INITIAL);
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="item_id" value={itemId} />
      {status === "pending" && (
        <input name="detail" maxLength={200} placeholder="Modelo, medidas o cantidad (opcional)" aria-label={`Detalle de ${title}`} className={`${inputClass} mb-2`} />
      )}
      <div className="flex flex-wrap gap-2">
        {status === "pending" ? (
          <>
            <button type="submit" name="status" value="confirmed" disabled={pending} aria-label={`Confirmar: ${title}`} className={buttonPrimary}>
              Confirmar
            </button>
            {canRemove && (
              <button type="submit" name="status" value="not_applicable" disabled={pending} aria-label={`No aplica: ${title}`} className={buttonGhost}>
                No aplica
              </button>
            )}
          </>
        ) : (
          <button type="submit" name="status" value="pending" disabled={pending} aria-label={`Volver a pendiente: ${title}`} className={buttonGhost}>
            Volver a pendiente
          </button>
        )}
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function AddTechItemForm({ eventId, categories }: { eventId: string; categories: readonly { clave: string; nombre: string }[] }) {
  const [state, action, pending] = useActionState(addTechItemAction, INITIAL);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="event_id" value={eventId} />
      <div>
        <label htmlFor="tec-titulo" className="block text-sm font-medium">
          Equipo
        </label>
        <input id="tec-titulo" name="titulo" required maxLength={120} placeholder="Consola de 32 canales" className={`${inputClass} mt-1.5`} />
      </div>
      <div>
        <label htmlFor="tec-detalle" className="block text-sm font-medium">
          Modelo sugerido o detalle
        </label>
        <input id="tec-detalle" name="detalle" maxLength={200} className={`${inputClass} mt-1.5`} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="tec-categoria" className="block text-sm font-medium">
            Grupo
          </label>
          <select id="tec-categoria" name="categoria" className={`${inputClass} mt-1.5`}>
            {categories.map((c) => (
              <option key={c.clave} value={c.clave}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tec-cantidad" className="block text-sm font-medium">
            Cantidad
          </label>
          <input id="tec-cantidad" name="cantidad" type="number" min={1} defaultValue={1} inputMode="numeric" className={`${inputClass} mt-1.5 font-mono`} />
        </div>
      </div>
      <div>
        <label htmlFor="tec-plazo" className="block text-sm font-medium">
          ¿Para cuándo?
        </label>
        <select id="tec-plazo" name="plazo" className={`${inputClass} mt-1.5`}>
          <option value="obligatorio">Obligatorio para desbloquear</option>
          <option value="24">Por completar hasta 24 horas antes</option>
          <option value="2">Por completar hasta 2 horas antes</option>
        </select>
      </div>
      <button type="submit" disabled={pending} className={`${buttonSecondary} justify-self-start`}>
        {pending ? "Guardando…" : "Agregar a la lista"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

// --------------------------------------------------------------------------- Presupuesto

export function BudgetForm({ eventId, total, breakdownVisible }: { eventId: string; total: number | null; breakdownVisible: boolean }) {
  const [state, action, pending] = useActionState(setBudgetAction, INITIAL);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="event_id" value={eventId} />
      <div>
        <label htmlFor="pre-total" className="block text-sm font-medium">
          Monto global (S/)
        </label>
        <input id="pre-total" name="total" required inputMode="decimal" defaultValue={total ?? ""} placeholder="18500.00" className={`${inputClass} mt-1.5 font-mono text-lg`} />
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="desglose" value="si" defaultChecked={breakdownVisible} className="mt-0.5 size-5 accent-[var(--gold-300)]" />
        <span>
          <span className="font-semibold">La productora ve el desglose</span>
          <span className="block text-ink-muted">Para una productora de confianza. Si no, solo ve el monto global.</span>
        </span>
      </label>
      <button type="submit" disabled={pending} className={`${buttonPrimary} justify-self-start`}>
        {pending ? "Guardando…" : total ? "Guardar cambios" : "Cargar presupuesto"}
      </button>
      {total !== null && <p className="text-xs text-ink-muted">Si cambias el monto, el cliente tiene que aprobarlo de nuevo.</p>}
      <Feedback state={state} />
    </form>
  );
}

export function BudgetLineForm({ eventId, concepts }: { eventId: string; concepts: readonly { clave: string; nombre: string; unidad: string }[] }) {
  const [state, action, pending] = useActionState(addBudgetLineAction, INITIAL);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="event_id" value={eventId} />
      <div>
        <label htmlFor="par-titulo" className="block text-sm font-medium">
          Partida
        </label>
        <input id="par-titulo" name="titulo" required maxLength={120} placeholder="Transporte del equipo" className={`${inputClass} mt-1.5`} />
      </div>
      <div>
        <label htmlFor="par-concepto" className="block text-sm font-medium">
          Comparar con
        </label>
        <select id="par-concepto" name="concepto" className={`${inputClass} mt-1.5`}>
          <option value="">Sin referencia</option>
          {concepts.map((c) => (
            <option key={c.clave} value={c.clave}>
              {c.nombre} (por {c.unidad})
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="par-cantidad" className="block text-sm font-medium">
            Cantidad
          </label>
          <input id="par-cantidad" name="cantidad" required inputMode="decimal" defaultValue="1" className={`${inputClass} mt-1.5 font-mono`} />
        </div>
        <div>
          <label htmlFor="par-costo" className="block text-sm font-medium">
            Costo de cada uno (S/)
          </label>
          <input id="par-costo" name="costo" required inputMode="decimal" className={`${inputClass} mt-1.5 font-mono`} />
        </div>
      </div>
      <button type="submit" disabled={pending} className={`${buttonSecondary} justify-self-start`}>
        {pending ? "Guardando…" : "Agregar partida"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function RemoveBudgetLine({ lineId, title }: { lineId: string; title: string }) {
  const [, action, pending] = useActionState(removeBudgetLineAction, INITIAL);
  return (
    <form action={action}>
      <input type="hidden" name="line_id" value={lineId} />
      <button type="submit" disabled={pending} aria-label={`Quitar partida: ${title}`} className="min-h-11 px-2 text-sm text-ink-muted underline underline-offset-4">
        Quitar
      </button>
    </form>
  );
}

/** El cliente aprueba el monto o pide un cambio. El productor general registra lo que el cliente dijo por otro medio. */
export function BudgetDecision({ eventId, status, onBehalf }: { eventId: string; status: "sent" | "approved" | "changes_requested"; onBehalf: boolean }) {
  const [state, action, pending] = useActionState(decideBudgetAction, INITIAL);
  const [mode, setMode] = useState<null | "approve" | "change">(null);
  const needsNote = mode === "change" || (mode === "approve" && onBehalf);
  return (
    <form action={action}>
      <input type="hidden" name="event_id" value={eventId} />
      {needsNote ? (
        <div>
          <input type="hidden" name="decision" value={mode === "approve" ? "approve" : "change"} />
          <label htmlFor="pre-nota" className="block text-sm font-medium">
            {mode === "change" ? "¿Qué hay que cambiar?" : "¿Cómo te dio el cliente su aprobación?"}
          </label>
          <textarea id="pre-nota" name="note" rows={2} required maxLength={300} className={`${inputClass} mt-1.5 py-2`} />
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
              <button type="button" onClick={() => setMode("approve")} className={buttonSecondary}>
                Registrar aprobación del cliente
              </button>
            ) : (
              <button type="submit" name="decision" value="approve" disabled={pending} className={buttonPrimary}>
                Aprobar presupuesto
              </button>
            ))}
          {status !== "changes_requested" && (
            <button type="button" onClick={() => setMode("change")} className={buttonGhost}>
              Pedir cambio
            </button>
          )}
        </div>
      )}
      <Feedback state={state} />
    </form>
  );
}
