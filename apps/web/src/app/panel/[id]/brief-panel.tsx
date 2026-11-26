"use client";

import { useActionState } from "react";
import { answerBriefDoubt, saveBrief, type BriefState } from "@/app/actions/brief";
import { buttonPrimary, inputClass } from "@/components/operacion/ui";
import type { BriefDoubt } from "@mando/core/data";

const initial: BriefState = { ok: false, error: null };
const label = "block text-sm font-medium";

/** El backend carga o corrige el brief. Cada cambio sube la versión y el equipo lo vuelve a leer. */
export function BriefForm({
  eventId,
  brief,
}: {
  eventId: string;
  brief: { version: number; summary: string; objective: string | null; attendees: string | null } | null;
}) {
  const [state, action, pending] = useActionState(saveBrief, initial);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="evento" value={eventId} />
      <div className="space-y-1.5">
        <label htmlFor="brief-resumen" className={label}>
          Brief del evento
        </label>
        <textarea id="brief-resumen" name="resumen" rows={5} required maxLength={4000} defaultValue={brief?.summary ?? ""} className={`${inputClass} py-2`} placeholder="Qué es el evento, para quién y qué no puede fallar." />
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
      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
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
