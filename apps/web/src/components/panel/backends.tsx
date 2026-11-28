"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createBackend, revokeBackendInvitation, type BackendState } from "@/app/actions/backends";
import { buttonGhost, buttonPrimary, inputClass } from "@/components/operacion/ui";

const initial: BackendState = { ok: false, error: null };
const label = "block text-sm font-medium";

/** «Crear nuevo backend»: nombre y correo. La persona entra con el código que le llega al correo. */
export function NewBackendForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState(createBackend, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <input type="hidden" name="organizacion" value={orgId} />
      <div className="space-y-1.5">
        <label htmlFor="be-nombre" className={label}>
          Nombre
        </label>
        <input id="be-nombre" name="nombre" required maxLength={120} autoComplete="off" className={inputClass} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="be-correo" className={label}>
          Correo
        </label>
        <input id="be-correo" name="correo" type="email" required autoComplete="off" inputMode="email" className={inputClass} />
      </div>
      {state.error && (
        <p role="alert" className="border border-critical/40 bg-critical/10 px-3 py-2 text-sm">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <div role="status" className="space-y-2 bg-gold-500/15 px-3 py-2 text-sm">
          <p>{state.message}</p>
          {state.shareText && (
            <button
              type="button"
              className={buttonGhost}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(state.shareText ?? "");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copiado" : "Copiar mensaje para WhatsApp"}
            </button>
          )}
        </div>
      )}
      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "Creando…" : "Crear nuevo backend"}
      </button>
    </form>
  );
}

export function RevokeBackendButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className={buttonGhost}
        onClick={async () => {
          setBusy(true);
          const r = await revokeBackendInvitation(id);
          setError(r.ok ? null : r.error);
          setBusy(false);
        }}
      >
        {busy ? "Retirando…" : "Retirar"}
      </button>
      {error && (
        <span role="alert" className="text-sm text-critical">
          {error}
        </span>
      )}
    </span>
  );
}
