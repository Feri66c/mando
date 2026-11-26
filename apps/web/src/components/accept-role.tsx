"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { acceptRole } from "@/app/actions/brief";

/** «Acepto»: la persona asume el cargo para el que la convocaron y pasa a su bienvenida. */
export function AcceptRole({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    const result = await acceptRole(eventId);
    if (!result.ok) {
      setBusy(false);
      setError(result.error ?? "No se pudo aceptar. Intenta de nuevo.");
      return;
    }
    router.push(`/bienvenida/${eventId}`);
  }

  return (
    <div className="mt-4">
      <button type="button" onClick={accept} disabled={busy} className="acepto">
        {busy ? "Un momento…" : "Acepto"}
      </button>
      <p className="mt-2 text-center text-xs text-ink-muted">Al aceptar asumes el cargo en este evento.</p>
      {error && (
        <p role="alert" className="mt-2 border border-critical/40 bg-critical/10 px-3 py-2 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
