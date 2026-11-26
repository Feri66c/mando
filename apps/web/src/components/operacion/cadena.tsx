"use client";

// Cadena de mando (decisiones 59 a 64): formularios para dar mando, sumar submandos, cargar marcas
// y reportar cambios de emergencia.

import { useActionState, useRef, useState } from "react";
import { addBrandAction, inviteSubmandoAction, removeBrandAction, reportEmergencyAction, setMemberCommandAction, setModalityAction } from "@/app/actions/mando";
import type { CierreState } from "@/app/actions/cierre";
import { BRAND_KINDS, EMERGENCY_KINDS, MODALITIES, VISIBILITIES, brandLogoPath, type Visibility } from "@mando/core/command";
import { getBrowserClient } from "@/lib/supabase/browser";
import { buttonGhost, buttonPrimary, buttonSecondary, inputClass } from "./ui";

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

/** Lista de áreas para escribir o elegir: las del evento primero, luego las sugeridas. */
function AreaInput({ id, areas, defaultValue = "" }: { id: string; areas: string[]; defaultValue?: string }) {
  return (
    <>
      <input id={id} name="area" list={`${id}-lista`} defaultValue={defaultValue} maxLength={60} autoComplete="off" placeholder="Escribe o elige un área" className={`${inputClass} mt-1.5`} />
      <datalist id={`${id}-lista`}>
        {areas.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
    </>
  );
}

function VisibilitySelect({ id, defaultValue, withAuto = false }: { id: string; defaultValue?: Visibility; withAuto?: boolean }) {
  const [value, setValue] = useState<string>(defaultValue ?? (withAuto ? "" : "completa"));
  const detail = VISIBILITIES.find((v) => v.clave === value)?.detalle ?? "Coordinación ve su área; técnicos y proveedores, solo lo suyo.";
  return (
    <>
      <select id={id} name="visibilidad" value={value} onChange={(e) => setValue(e.target.value)} className={`${inputClass} mt-1.5`}>
        {withAuto && <option value="">Según su nivel</option>}
        {VISIBILITIES.map((v) => (
          <option key={v.clave} value={v.clave}>
            {v.nombre}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-ink-muted">{detail}</p>
    </>
  );
}

/** «Cambiar mando»: área, a quién reporta y qué ve. Se abre dentro de la tarjeta de la persona. */
export function MemberCommandForm({
  eventId,
  member,
  bosses,
  areas,
}: {
  eventId: string;
  member: { profileId: string; fullName: string; areaName: string | null; reportsTo: string | null; visibility: Visibility; role: string; level: number | null };
  bosses: { profileId: string; fullName: string; title: string | null }[];
  areas: string[];
}) {
  const [state, action, pending] = useActionState(setMemberCommandAction, INITIAL);
  const [open, setOpen] = useState(false);
  const id = `mando-${member.profileId}`;
  if (!open)
    return (
      <div className="mt-3">
        <button type="button" onClick={() => setOpen(true)} className={buttonGhost} aria-label={`Cambiar mando de ${member.fullName}`}>
          Cambiar mando
        </button>
        <Feedback state={state} />
      </div>
    );
  return (
    <form action={action} className="mt-3 space-y-3 border-t border-line pt-3">
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="profile_id" value={member.profileId} />
      <div>
        <label htmlFor={`${id}-area`} className={label}>
          Área
        </label>
        <AreaInput id={`${id}-area`} areas={areas} defaultValue={member.areaName ?? ""} />
      </div>
      <div>
        <label htmlFor={`${id}-jefe`} className={label}>
          Reporta a
        </label>
        <select id={`${id}-jefe`} name="reporta_a" defaultValue={member.reportsTo ?? ""} className={`${inputClass} mt-1.5`}>
          <option value="">Mando central</option>
          {bosses.map((b) => (
            <option key={b.profileId} value={b.profileId}>
              {b.fullName}
              {b.title ? ` · ${b.title}` : ""}
            </option>
          ))}
        </select>
      </div>
      {member.role === "backend" || (member.level ?? 4) <= 2 ? (
        // Los productores siempre ven todo el evento: aquí no hay nada que elegir.
        <input type="hidden" name="visibilidad" value="completa" />
      ) : (
        <div>
          <label htmlFor={`${id}-ve`} className={label}>
            Qué ve
          </label>
          <VisibilitySelect id={`${id}-ve`} defaultValue={member.visibility} />
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={`${buttonPrimary} flex-1`}>
          {pending ? "Guardando…" : "Guardar mando"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={buttonGhost}>
          Cerrar
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

/** El productor suma a alguien bajo su mando, con área y visibilidad. */
export function SubmandoInviteForm({ eventId, areas }: { eventId: string; areas: string[] }) {
  const [state, action, pending] = useActionState(inviteSubmandoAction, INITIAL);
  return (
    <form action={action} className="space-y-3" key={state.ok ? `ok-${state.message}` : "nuevo"}>
      <input type="hidden" name="event_id" value={eventId} />
      <div>
        <label htmlFor="sub-nombre" className={label}>
          Nombre
        </label>
        <input id="sub-nombre" name="nombre" required maxLength={120} autoComplete="off" className={`${inputClass} mt-1.5`} />
      </div>
      <div>
        <label htmlFor="sub-correo" className={label}>
          Correo
        </label>
        <input id="sub-correo" name="correo" type="email" required maxLength={200} autoComplete="off" className={`${inputClass} mt-1.5`} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="sub-cargo" className={label}>
            Cargo
          </label>
          <input id="sub-cargo" name="cargo" required maxLength={80} autoComplete="off" className={`${inputClass} mt-1.5`} />
        </div>
        <div>
          <label htmlFor="sub-nivel" className={label}>
            Nivel
          </label>
          <select id="sub-nivel" name="nivel" defaultValue="3" className={`${inputClass} mt-1.5`}>
            <option value="3">Nivel 3 · Coordinación</option>
            <option value="4">Nivel 4 · Técnicos y proveedores</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="sub-area" className={label}>
          Área
        </label>
        <AreaInput id="sub-area" areas={areas} />
      </div>
      <div>
        <label htmlFor="sub-ve" className={label}>
          Qué ve
        </label>
        <VisibilitySelect id="sub-ve" withAuto />
      </div>
      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "Sumando…" : "Dar el mando"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/** Reportar un cambio de emergencia. La ventana (48 h, 24 h, último minuto) la pone el servidor. */
export function EmergencyForm({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState(reportEmergencyAction, INITIAL);
  return (
    <form action={action} className="space-y-3" key={state.ok ? `ok-${state.message}` : "nuevo"}>
      <input type="hidden" name="event_id" value={eventId} />
      <div>
        <label htmlFor="emergencia-tipo" className={label}>
          Qué cambia
        </label>
        <select id="emergencia-tipo" name="tipo" defaultValue="persona" className={`${inputClass} mt-1.5`}>
          {EMERGENCY_KINDS.map((k) => (
            <option key={k.clave} value={k.clave}>
              {k.nombre}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="emergencia-titulo" className={label}>
          En una línea
        </label>
        <input id="emergencia-titulo" name="titulo" required maxLength={160} autoComplete="off" className={`${inputClass} mt-1.5`} />
      </div>
      <div>
        <label htmlFor="emergencia-detalle" className={label}>
          Detalle <span className="font-normal text-ink-muted">(quién sale, quién entra, por qué)</span>
        </label>
        <textarea id="emergencia-detalle" name="detalle" rows={3} maxLength={1000} className={`${inputClass} mt-1.5 py-2`} />
      </div>
      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
        {pending ? "Registrando…" : "Registrar cambio de emergencia"}
      </button>
      <p className="text-xs text-ink-muted">No se edita ni se borra. MANDO anota a cuántas horas del evento ocurrió.</p>
      <Feedback state={state} />
    </form>
  );
}

// --------------------------------------------------------------------------- Marcas y modalidad

/** Carga una marca del evento: nombre y, si lo tienes, su logo oficial en PNG, JPG o WebP. */
export function BrandForm({ eventId }: { eventId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<CierreState & { working?: string }>(INITIAL);

  async function save(fd: FormData) {
    const name = String(fd.get("nombre") ?? "").trim();
    const kind = String(fd.get("tipo") ?? "cliente");
    const file = fileRef.current?.files?.[0] ?? null;
    try {
      if (!name) throw new Error("Escribe el nombre de la marca.");
      let filePath: string | null = null;
      if (file) {
        if (file.size > MAX_LOGO_BYTES) throw new Error("El logo pesa más de 2 MB. Usa una versión más liviana.");
        filePath = brandLogoPath(eventId, crypto.randomUUID(), file.name);
        if (!filePath) throw new Error("El logo tiene que ser una imagen PNG, JPG o WebP.");
        const supabase = getBrowserClient();
        if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
        setState({ ...INITIAL, working: "Subiendo el logo…" });
        const { error } = await supabase.storage.from("evidences").upload(filePath, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if (error) throw new Error(/row-level|policy|permission/i.test(error.message) ? "No tienes permiso para subir logos aquí." : `No se pudo subir: ${error.message}`);
      }
      setState({ ...INITIAL, working: "Guardando…" });
      const result = await addBrandAction({ eventId, kind, name, filePath });
      setState(result);
      if (result.ok) formRef.current?.reset();
    } catch (e) {
      setState({ ok: false, error: e instanceof Error ? e.message : "No se pudo guardar la marca." });
    }
  }

  return (
    <form ref={formRef} action={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="marca-nombre" className={label}>
            Nombre de la marca
          </label>
          <input id="marca-nombre" name="nombre" required maxLength={80} autoComplete="off" className={`${inputClass} mt-1.5`} />
        </div>
        <div>
          <label htmlFor="marca-tipo" className={label}>
            De quién es
          </label>
          <select id="marca-tipo" name="tipo" defaultValue="cliente" className={`${inputClass} mt-1.5`}>
            {BRAND_KINDS.map((k) => (
              <option key={k.clave} value={k.clave}>
                {k.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="marca-logo" className={label}>
          Logo oficial <span className="font-normal text-ink-muted">(opcional · PNG, JPG o WebP, hasta 2 MB)</span>
        </label>
        <input ref={fileRef} id="marca-logo" type="file" accept="image/png,image/jpeg,image/webp" className="mt-1.5 block w-full text-sm text-ink-muted file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-surface-200 file:px-4 file:text-sm file:font-semibold file:text-ink" />
      </div>
      <button type="submit" disabled={Boolean(state.working)} className={`${buttonSecondary} w-full`}>
        {state.working ?? "Agregar marca"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function BrandRemove({ brandId, name }: { brandId: string; name: string }) {
  const [state, action, pending] = useActionState(removeBrandAction, INITIAL);
  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="brand_id" value={brandId} />
      <button type="submit" disabled={pending} aria-label={`Quitar la marca ${name}`} className="min-h-11 px-2 text-sm font-medium text-ink-muted underline underline-offset-4">
        Quitar
      </button>
      {state.error && <span role="alert" className="sr-only">{state.error}</span>}
    </form>
  );
}

export function ModalityForm({ eventId, modality, agency }: { eventId: string; modality: string; agency: string | null }) {
  const [state, action, pending] = useActionState(setModalityAction, INITIAL);
  const [value, setValue] = useState(modality);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="event_id" value={eventId} />
      <div>
        <label htmlFor="modalidad" className={label}>
          Cómo llega este evento
        </label>
        <select id="modalidad" name="modalidad" value={value} onChange={(e) => setValue(e.target.value)} className={`${inputClass} mt-1.5`}>
          {MODALITIES.map((m) => (
            <option key={m.clave} value={m.clave}>
              {m.nombre}
            </option>
          ))}
        </select>
      </div>
      {value !== "directo" && (
        <div>
          <label htmlFor="modalidad-agencia" className={label}>
            {value === "tercerizado" ? "Quién terceriza" : "Agencia"}
          </label>
          <input id="modalidad-agencia" name="agencia" defaultValue={agency ?? ""} maxLength={80} autoComplete="off" className={`${inputClass} mt-1.5`} />
        </div>
      )}
      <button type="submit" disabled={pending} className={`${buttonSecondary} w-full`}>
        {pending ? "Guardando…" : "Guardar modalidad"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
