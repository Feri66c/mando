"use client";

import { useActionState, useState } from "react";
import {
  addGuestAction,
  closeEventAction,
  markCriterionAction,
  noteReminderAction,
  rateProductionAction,
  setPublishUrlAction,
  updateGuestAction,
  type CierreState,
} from "@/app/actions/cierre";
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

/** Cumplido / Falló para un no negociable; Logrado / No logrado para un hito estrella. */
export function CriterionButtons({
  criterionId,
  kind,
  status,
  title,
}: {
  criterionId: string;
  kind: "no_negociable" | "hito_estrella";
  status: "pending" | "ok" | "failed";
  title: string;
}) {
  const [state, action, pending] = useActionState(markCriterionAction, INITIAL);
  const [failing, setFailing] = useState(false);
  const mandatory = kind === "no_negociable";
  const yes = mandatory ? "Cumplido" : "Logrado";
  const no = mandatory ? "Falló" : "No logrado";
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="criterion_id" value={criterionId} />
      {failing && mandatory ? (
        <div>
          <label htmlFor={`nota-${criterionId}`} className="block text-sm font-medium">
            ¿Qué pasó con «{title}»?
          </label>
          <textarea id={`nota-${criterionId}`} name="note" rows={2} required maxLength={500} className={`${inputClass} mt-1.5 py-2`} />
          <p className="mt-1.5 text-xs text-ink-muted">Levanta una Red Flag que el cliente ve y deja el evento sin estrellas.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="submit" name="result" value="failed" disabled={pending} className={buttonSecondary}>
              {pending ? "Guardando…" : "Confirmar que falló"}
            </button>
            <button type="button" onClick={() => setFailing(false)} className={buttonGhost}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            name="result"
            value="ok"
            disabled={pending || status === "ok"}
            aria-label={`${yes}: ${title}`}
            className={status === "ok" ? buttonGhost : buttonSecondary}
          >
            {yes}
          </button>
          {mandatory ? (
            <button type="button" onClick={() => setFailing(true)} disabled={status === "failed"} aria-label={`${no}: ${title}`} className={buttonGhost}>
              {no}
            </button>
          ) : (
            <button type="submit" name="result" value="failed" disabled={pending || status === "failed"} aria-label={`${no}: ${title}`} className={buttonGhost}>
              {no}
            </button>
          )}
        </div>
      )}
      <Feedback state={state} />
    </form>
  );
}

export function RatingForm({ eventId, current }: { eventId: string; current: { stars: number; comment: string | null } | null }) {
  const [state, action, pending] = useActionState(rateProductionAction, INITIAL);
  return (
    <form action={action}>
      <input type="hidden" name="event_id" value={eventId} />
      <fieldset>
        <legend className="text-sm font-medium">¿Cómo estuvo la producción para ti?</legend>
        <div className="mt-2 flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer">
              <input type="radio" name="stars" value={n} defaultChecked={current?.stars === n} required className="peer sr-only" />
              <span className="grid size-12 place-items-center rounded-full bg-surface-200 font-mono text-lg font-semibold peer-checked:bg-gold-500 peer-checked:text-navy-950 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-ice-300">
                {n}
              </span>
              <span className="sr-only">{n === 1 ? "1 estrella" : `${n} estrellas`}</span>
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-ink-muted">1 es muy mala y 5 es impecable. Solo el productor general ve tu nota.</p>
      </fieldset>
      <label htmlFor="valoracion-comentario" className="mt-3 block text-sm font-medium">
        Comentario <span className="font-normal text-ink-muted">(opcional)</span>
      </label>
      <textarea id="valoracion-comentario" name="comment" rows={2} maxLength={500} defaultValue={current?.comment ?? ""} className={`${inputClass} mt-1.5 py-2`} />
      <button type="submit" disabled={pending} className={`${buttonSecondary} mt-3`}>
        {pending ? "Guardando…" : current ? "Actualizar mi valoración" : "Enviar mi valoración"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function PublishUrlForm({ eventId, current }: { eventId: string; current: string | null }) {
  const [state, action, pending] = useActionState(setPublishUrlAction, INITIAL);
  return (
    <form action={action}>
      <input type="hidden" name="event_id" value={eventId} />
      <label htmlFor="enlace-publicacion" className="block text-sm font-medium">
        Enlace de publicación
      </label>
      <input
        id="enlace-publicacion"
        name="url"
        type="url"
        inputMode="url"
        defaultValue={current ?? ""}
        placeholder="https://youtu.be/…"
        maxLength={500}
        className={`${inputClass} mt-1.5`}
      />
      <p className="mt-1.5 text-xs text-ink-muted">Por ejemplo, el episodio en YouTube. Sale en el informe y el cliente lo ve.</p>
      <button type="submit" disabled={pending} className={`${buttonSecondary} mt-3`}>
        {pending ? "Guardando…" : "Guardar enlace"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function CloseEventForm({ eventId, pendingMandatories }: { eventId: string; pendingMandatories: number }) {
  const [state, action, pending] = useActionState(closeEventAction, INITIAL);
  if (pendingMandatories > 0) {
    return (
      <p className="text-sm text-ink-muted">
        Para cerrar, primero marca {pendingMandatories === 1 ? "el no negociable que falta" : `los ${pendingMandatories} no negociables que faltan`}.
      </p>
    );
  }
  return (
    <form action={action}>
      <input type="hidden" name="event_id" value={eventId} />
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="confirm" value="si" required className="mt-0.5 size-5 accent-[var(--gold-300)]" />
        <span>Entiendo que al cerrar ya no se podrá marcar ni cambiar nada. La bitácora y las estrellas quedan como están.</span>
      </label>
      <button type="submit" disabled={pending} className={`${buttonPrimary} mt-3 w-full`}>
        {pending ? "Cerrando…" : "Cerrar el evento"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/** Abre el diálogo de impresión del teléfono o la computadora, donde se elige «Guardar como PDF». */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={`${buttonSecondary} no-imprimir`}>
      Guardar como PDF
    </button>
  );
}

// --------------------------------------------------------------------------- Citados

export function GuestForm({ eventId, timezone, defaultDate, roles }: { eventId: string; timezone: string; defaultDate: string; roles: string[] }) {
  const [state, action, pending] = useActionState(addGuestAction, INITIAL);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="timezone" value={timezone} />
      <div>
        <label htmlFor="citado-nombre" className="block text-sm font-medium">
          Nombre
        </label>
        <input id="citado-nombre" name="nombre" required maxLength={120} autoComplete="off" className={`${inputClass} mt-1.5`} />
      </div>
      <div>
        <label htmlFor="citado-rol" className="block text-sm font-medium">
          Viene como
        </label>
        <select id="citado-rol" name="rol" className={`${inputClass} mt-1.5`}>
          {roles.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Citación</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="citado-fecha" className="sr-only">
              Día de citación
            </label>
            <input id="citado-fecha" name="fecha" type="date" required defaultValue={defaultDate} className={`${inputClass} font-mono`} />
          </div>
          <div>
            <label htmlFor="citado-hora" className="sr-only">
              Hora de citación
            </label>
            <input id="citado-hora" name="hora" type="time" required className={`${inputClass} font-mono`} />
          </div>
        </div>
      </fieldset>
      <div>
        <label htmlFor="citado-telefono" className="block text-sm font-medium">
          WhatsApp <span className="font-normal text-ink-muted">(opcional, con código de país)</span>
        </label>
        <input id="citado-telefono" name="telefono" type="tel" inputMode="tel" maxLength={30} placeholder="+51 999 888 777" autoComplete="off" className={`${inputClass} mt-1.5`} />
      </div>
      <div>
        <label htmlFor="citado-correo" className="block text-sm font-medium">
          Correo <span className="font-normal text-ink-muted">(opcional)</span>
        </label>
        <input id="citado-correo" name="correo" type="email" maxLength={200} autoComplete="off" className={`${inputClass} mt-1.5`} />
      </div>
      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "Guardando…" : "Citar"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/** Recordatorios (abren WhatsApp o el correo con el mensaje listo y lo anotan) y marca de llegada. */
export function GuestActions({
  guestId,
  name,
  arrived,
  whatsapp,
  mailto,
}: {
  guestId: string;
  name: string;
  arrived: boolean;
  whatsapp: string;
  mailto: string | null;
}) {
  const [state, action, pending] = useActionState(updateGuestAction, INITIAL);
  const note = () => void noteReminderAction(guestId);
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="guest_id" value={guestId} />
      <div className="flex flex-wrap gap-2">
        {!arrived && (
          <button type="submit" name="action" value="arrived" disabled={pending} aria-label={`Llegó: ${name}`} className={buttonPrimary}>
            Llegó
          </button>
        )}
        <a href={whatsapp} target="_blank" rel="noreferrer" onClick={note} aria-label={`Recordar por WhatsApp a ${name}`} className={buttonSecondary}>
          WhatsApp
        </a>
        {mailto && (
          <a href={mailto} onClick={note} aria-label={`Recordar por correo a ${name}`} className={buttonSecondary}>
            Correo
          </a>
        )}
        {arrived ? (
          <button type="submit" name="action" value="undo_arrived" disabled={pending} aria-label={`Corregir llegada de ${name}`} className={buttonGhost}>
            Corregir llegada
          </button>
        ) : (
          <button type="submit" name="action" value="remove" disabled={pending} aria-label={`Retirar a ${name}`} className={buttonGhost}>
            Retirar
          </button>
        )}
      </div>
      <Feedback state={state} />
    </form>
  );
}
