"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { inviteMember, type PanelState } from "@/app/actions/panel";
import { buttonGhost, buttonPrimary, inputClass } from "@/components/operacion/ui";

const initial: PanelState = { ok: false, error: null };
const label = "block text-sm font-medium";

export function InviteForm({
  eventId,
  cargos,
}: {
  eventId: string;
  cargos: { cargo: string; nivel: number | null; descripcion: string }[];
}) {
  const [state, action, pending] = useActionState(inviteMember, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const defaultCargo = Math.max(0, cargos.findIndex((c) => c.nivel === 2));

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <input type="hidden" name="evento" value={eventId} />
      <div className="space-y-1.5">
        <label htmlFor="inv-nombre" className={label}>
          Nombre
        </label>
        <input id="inv-nombre" name="nombre" required maxLength={120} autoComplete="off" className={inputClass} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="inv-correo" className={label}>
          Correo
        </label>
        <input id="inv-correo" name="correo" type="email" required maxLength={200} autoComplete="off" className={inputClass} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="inv-cargo" className={label}>
          Cargo
        </label>
        <select id="inv-cargo" name="cargo" defaultValue={defaultCargo} className={inputClass}>
          {cargos.map((c, i) => (
            <option key={`${c.cargo}-${i}`} value={i}>
              {c.cargo} · {c.descripcion}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="inv-cargo-propio" className={label}>
          Nombre del cargo <span className="font-normal text-ink-muted">(opcional, si en tu equipo se llama distinto)</span>
        </label>
        <input id="inv-cargo-propio" name="cargo_propio" maxLength={80} autoComplete="off" placeholder="Road manager" className={inputClass} />
      </div>
      {state.error && (
        <p role="alert" className="border border-critical/40 bg-critical/10 px-3 py-2 text-sm">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="bg-gold-500/15 px-3 py-2 text-sm">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "Invitando…" : "Dar el mando"}
      </button>
    </form>
  );
}

/** Copia el mensaje de invitación. Si el navegador no deja copiar, selecciona el texto para copiarlo a mano. */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={buttonGhost}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copiado" : "Copiar mensaje"}
    </button>
  );
}
