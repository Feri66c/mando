"use client";

import { useActionState } from "react";
import { openMomentAction, type ActionState } from "@/app/actions/operacion";
import { buttonSecondary } from "@/components/operacion/ui";

export function OpenMomentButton({ momentId }: { momentId: string }) {
  const [state, action, pending] = useActionState(openMomentAction, { ok: false, error: null } as ActionState);
  return (
    <form action={action}>
      <input type="hidden" name="moment_id" value={momentId} />
      <button type="submit" disabled={pending} className={`${buttonSecondary} w-full`}>
        {pending ? "Abriendo…" : "Abrir ahora"}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-[#ffd3c9]">
          {state.error}
        </p>
      )}
    </form>
  );
}
