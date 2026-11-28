"use client";

// Mando de marca (decisión 95): «MANDO Momentum» con su logo, y los pedidos especiales de cada mando.

import { useActionState, useRef, useState } from "react";
import { requestCustomizationAction, setCustomizationStatusAction, setOrgBrandAction } from "@/app/actions/marca";
import type { CierreState } from "@/app/actions/cierre";
import { REQUEST_STATUSES, orgLogoPath, type RequestStatus } from "@mando/core/command";
import { getBrowserClient } from "@/lib/supabase/browser";
import { buttonPrimary, buttonSecondary, inputClass } from "@/components/operacion/ui";

const INITIAL: CierreState = { ok: false, error: null };
const label = "block text-sm font-medium";
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

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

/** Nombre que acompaña a MANDO, grupo al que pertenece y logo oficial. */
export function OrgBrandForm({
  orgId,
  brandName,
  parentName,
  hasLogo,
}: {
  orgId: string;
  brandName: string | null;
  parentName: string | null;
  hasLogo: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<CierreState & { working?: string }>(INITIAL);
  const [preview, setPreview] = useState(brandName ?? "");

  async function save(fd: FormData) {
    const name = String(fd.get("marca") ?? "").trim();
    const parent = String(fd.get("grupo") ?? "").trim();
    const clearLogo = fd.get("quitar_logo") === "si";
    const file = fileRef.current?.files?.[0] ?? null;
    try {
      let logoPath: string | null = null;
      if (file && !clearLogo) {
        if (file.size > MAX_LOGO_BYTES) throw new Error("El logo pesa más de 2 MB. Usa una versión más liviana.");
        logoPath = orgLogoPath(orgId, crypto.randomUUID(), file.name);
        if (!logoPath) throw new Error("El logo tiene que ser una imagen PNG, JPG o WebP.");
        const supabase = getBrowserClient();
        if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
        setState({ ...INITIAL, working: "Subiendo el logo…" });
        const { error } = await supabase.storage.from("evidences").upload(logoPath, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if (error) throw new Error(/row-level|policy|permission/i.test(error.message) ? "No tienes permiso para subir el logo." : `No se pudo subir: ${error.message}`);
      }
      setState({ ...INITIAL, working: "Guardando…" });
      setState(await setOrgBrandAction({ orgId, brandName: name, parentName: parent, logoPath, clearLogo }));
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setState({ ok: false, error: e instanceof Error ? e.message : "No se pudo guardar la marca." });
    }
  }

  return (
    <form action={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="org-marca" className={label}>
            Nombre que acompaña a MANDO
          </label>
          <input
            id="org-marca"
            name="marca"
            defaultValue={brandName ?? ""}
            maxLength={40}
            autoComplete="off"
            onChange={(e) => setPreview(e.target.value)}
            className={`${inputClass} mt-1.5`}
          />
          <p className="mt-1 font-display text-sm font-bold uppercase tracking-wide text-gold-500">MANDO {preview.trim() || "…"}</p>
        </div>
        <div>
          <label htmlFor="org-grupo" className={label}>
            Grupo o agencia madre <span className="font-normal text-ink-muted">(opcional)</span>
          </label>
          <input id="org-grupo" name="grupo" defaultValue={parentName ?? ""} maxLength={80} autoComplete="off" className={`${inputClass} mt-1.5`} />
        </div>
      </div>
      <div>
        <label htmlFor="org-logo" className={label}>
          Logo oficial <span className="font-normal text-ink-muted">(PNG, JPG o WebP, hasta 2 MB · mejor con fondo transparente)</span>
        </label>
        <input
          ref={fileRef}
          id="org-logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="mt-1.5 block w-full text-sm text-ink-muted file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-surface-200 file:px-4 file:text-sm file:font-semibold file:text-ink"
        />
        {hasLogo && (
          <label className="mt-2 flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="quitar_logo" value="si" className="size-5" />
            Quitar el logo actual y dejar solo el nombre
          </label>
        )}
      </div>
      <button type="submit" disabled={Boolean(state.working)} className={`${buttonPrimary} w-full`}>
        {state.working ?? "Guardar mi mando"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/** Registrar un pedido especial: lo que este mando quiere distinto. */
export function CustomizationForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState(requestCustomizationAction, INITIAL);
  return (
    <form action={action} className="space-y-3" key={state.ok ? state.message : "f"}>
      <input type="hidden" name="org_id" value={orgId} />
      <div>
        <label htmlFor="pedido-titulo" className={label}>
          ¿Qué quiere distinto este mando?
        </label>
        <input id="pedido-titulo" name="titulo" required minLength={3} maxLength={160} autoComplete="off" className={`${inputClass} mt-1.5`} />
      </div>
      <div>
        <label htmlFor="pedido-detalle" className={label}>
          Detalle <span className="font-normal text-ink-muted">(opcional)</span>
        </label>
        <textarea id="pedido-detalle" name="detalle" rows={3} maxLength={2000} className={`${inputClass} mt-1.5 py-2`} />
      </div>
      <button type="submit" disabled={pending} className={`${buttonSecondary} w-full`}>
        {pending ? "Guardando…" : "Registrar pedido"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/** Cambiar el estado de un pedido: pedido → cotizado → aprobado → activo. */
export function CustomizationStatusForm({ requestId, status, billable }: { requestId: string; status: RequestStatus; billable: boolean }) {
  const [state, action, pending] = useActionState(setCustomizationStatusAction, INITIAL);
  return (
    <form action={action} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
      <input type="hidden" name="request_id" value={requestId} />
      <div className="grid grid-cols-2 gap-2">
        <select name="estado" defaultValue={status} aria-label="Estado del pedido" className={inputClass}>
          {REQUEST_STATUSES.map((s) => (
            <option key={s.clave} value={s.clave}>
              {s.nombre}
            </option>
          ))}
        </select>
        <input name="nota" maxLength={300} placeholder="Nota de cotización" aria-label="Nota de cotización" className={inputClass} />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="cobra" value="si" defaultChecked={billable} className="size-5" />
        Se cobra
      </label>
      <button type="submit" disabled={pending} className={buttonSecondary}>
        {pending ? "…" : "Actualizar"}
      </button>
      <div className="sm:col-span-3">
        <Feedback state={state} />
      </div>
    </form>
  );
}
