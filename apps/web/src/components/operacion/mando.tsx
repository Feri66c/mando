"use client";

// Piezas del «centro de mando» (decisiones 50 a 54): lista con «Agregar otro», mini ficha, semáforo de casting
// y el panel de continuidad que evita volver a cero después de registrar.

import Link from "next/link";
import { useActionState, useState } from "react";
import { decideCastingAction, type CierreState } from "@/app/actions/cierre";
import { CASTING_VERDICTS, type ApprovalStatus } from "@mando/core/approvals";
import { FICHA_FIELDS, fichaRows } from "@mando/core/casting";
import { PLANNING_ELEMENTS } from "@mando/core/planning";
import { inputClass } from "./ui";

const OTHER = "__otro__";
const INITIAL: CierreState = { ok: false, error: null };

/**
 * Una lista que nunca encierra: la última opción siempre es «Agregar otro» y abre un campo para escribirlo.
 * El valor viaja en `name`; si se escribió uno nuevo, también viaja `<name>_nuevo = si`.
 */
export function SelectWithAdd({
  id,
  name,
  options,
  defaultValue = "",
  placeholder = "Elige",
  addLabel = "Agregar otro",
  required = false,
  maxLength = 60,
  ariaLabel,
}: {
  id: string;
  name: string;
  options: readonly string[];
  defaultValue?: string;
  placeholder?: string;
  addLabel?: string;
  required?: boolean;
  maxLength?: number;
  ariaLabel?: string;
}) {
  const known = defaultValue === "" || options.includes(defaultValue);
  const [choice, setChoice] = useState(known ? defaultValue : OTHER);
  const [custom, setCustom] = useState(known ? "" : defaultValue);
  const adding = choice === OTHER;
  return (
    <div className="grid gap-1.5">
      <select
        id={id}
        name={adding ? undefined : name}
        value={choice}
        required={required && !adding}
        aria-label={ariaLabel}
        onChange={(e) => setChoice(e.target.value)}
        className={`${inputClass} ${adding ? "border-gold-300" : ""}`}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value={OTHER}>＋ {addLabel}</option>
      </select>
      {adding && (
        <>
          <input
            name={name}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            required={required}
            maxLength={maxLength}
            autoFocus
            placeholder="Escríbelo aquí"
            aria-label={`${addLabel}: ${ariaLabel ?? name}`}
            className={`${inputClass} neon-activo`}
          />
          <input type="hidden" name={`${name}_nuevo`} value={custom.trim() ? "si" : ""} />
        </>
      )}
    </div>
  );
}

/** Los campos de la mini ficha, para llenar al subir o corregir. Los nombres viajan como `ficha_<clave>`. */
export function FichaFields({ uid, values = {} }: { uid: string; values?: Record<string, string> }) {
  return (
    <fieldset className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-3">
      <legend className="etiqueta-mando mb-2 text-ice-300">Mini ficha</legend>
      {FICHA_FIELDS.map((f) => {
        const id = `ficha-${uid}-${f.clave}`;
        return (
          <div key={f.clave} className="min-w-0">
            <label htmlFor={id} className="block text-xs font-medium text-ink-muted">
              {f.nombre}
              {f.unidad ? ` (${f.unidad})` : ""}
            </label>
            <div className="mt-1">
              {f.tipo === "opciones" ? (
                <SelectWithAdd id={id} name={`ficha_${f.clave}`} options={f.opciones ?? []} defaultValue={values[f.clave] ?? ""} placeholder="—" ariaLabel={f.nombre} />
              ) : (
                <input
                  id={id}
                  name={`ficha_${f.clave}`}
                  defaultValue={values[f.clave] ?? ""}
                  type={f.tipo === "numero" ? "number" : "text"}
                  inputMode={f.tipo === "numero" ? "numeric" : undefined}
                  min={f.min}
                  max={f.max}
                  maxLength={f.tipo === "texto" ? 60 : undefined}
                  className={`${inputClass} ${f.tipo === "numero" ? "font-mono" : ""}`}
                />
              )}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}

/** Saca la ficha de un formulario: todo lo que empieza con `ficha_`. */
export function readFicha(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of fd.entries()) {
    if (key.startsWith("ficha_") && !key.endsWith("_nuevo") && typeof value === "string" && value.trim()) out[key.slice(6)] = value.trim();
  }
  return out;
}

/** La mini ficha junto a la foto: datos cortos, números en mono. */
export function FichaView({ profile }: { profile: Record<string, string> }) {
  const rows = fichaRows(profile);
  if (rows.length === 0) return <p className="text-xs text-ink-muted">Sin mini ficha todavía.</p>;
  return (
    <dl className="ficha grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
      {rows.map((r) => (
        <div key={r.clave} className="min-w-0">
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">{r.nombre}</dt>
          <dd className="truncate font-medium leading-tight">{r.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

const LIGHT: Record<string, string> = { approved: "verde", backup: "ambar", rejected: "rojo" };

/**
 * El semáforo del casting. Quien decide toca una luz; el resto del equipo ve cuál está prendida.
 * La luz prendida late. Cada luz lleva su nombre escrito: el color nunca va solo.
 */
export function CastingSemaforo({ itemId, label, status, canDecide }: { itemId: string; label: string; status: ApprovalStatus; canDecide: boolean }) {
  const [state, action, pending] = useActionState(decideCastingAction, INITIAL);
  const waiting = status === "pending" || status === "changes_requested";
  return (
    <form action={action} className="semaforo-casting" aria-label={`Veredicto de ${label}`}>
      <input type="hidden" name="item_id" value={itemId} />
      <div role="group" className="grid grid-cols-3 gap-2">
        {CASTING_VERDICTS.map((v) => {
          const on = status === v.clave;
          const body = (
            <>
              <span aria-hidden="true" className="luz" data-color={LIGHT[v.clave]} data-on={on ? "" : undefined} />
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em]">{v.nombre}</span>
            </>
          );
          return canDecide ? (
            <button
              key={v.clave}
              type="submit"
              name="verdict"
              value={v.clave}
              disabled={pending}
              aria-pressed={on}
              aria-label={`${v.nombre}: ${label}`}
              data-color={LIGHT[v.clave]}
              data-on={on ? "" : undefined}
              className="luz-boton"
            >
              {body}
            </button>
          ) : (
            <span key={v.clave} data-color={LIGHT[v.clave]} data-on={on ? "" : undefined} className="luz-boton luz-fija" aria-current={on ? "true" : undefined}>
              {body}
            </span>
          );
        })}
      </div>
      {waiting && <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-gold-300">◆ {canDecide ? "Toca una luz para decidir" : "Espera el veredicto del cliente"}</p>}
      {state.error && (
        <p role="alert" className="mt-2 rounded-2xl bg-[#3a1620] px-3 py-2 text-sm text-[#ffd3c9]">
          {state.error}
        </p>
      )}
    </form>
  );
}

const EXTRA_STOPS = [
  { ruta: "planificacion", nombre: "Planificación" },
  { ruta: "hoja-de-ruta", nombre: "Hoja de ruta" },
] as const;

/**
 * Continuidad: después de guardar no se vuelve a cero. Queda el aviso, el botón para seguir con el siguiente
 * y los caminos a las otras partes de la planificación.
 */
export function NextSteps({ eventId, message, nextLabel, onNext, current }: { eventId: string; message: string; nextLabel: string; onNext: () => void; current?: string }) {
  const stops = [EXTRA_STOPS[0], ...PLANNING_ELEMENTS.map((e) => ({ ruta: e.ruta, nombre: e.nombre })), EXTRA_STOPS[1]].filter((s) => s.ruta !== current);
  return (
    <div role="status" className="rounded-card neon-activo border border-[#8fe0b8]/40 bg-surface-000 p-4">
      <p className="text-sm font-semibold text-[#8fe0b8]">✓ {message}</p>
      <button type="button" onClick={onNext} autoFocus className="mt-3 inline-flex min-h-14 w-full items-center justify-center rounded-full bg-gold-500 px-5 text-base font-semibold text-navy-950">
        {nextLabel} →
      </button>
      <p className="etiqueta-mando mt-4 text-ice-300">¿A dónde quieres ir?</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {stops.map((s) => (
          <li key={s.ruta}>
            <Link href={`/eventos/${eventId}/${s.ruta}`} className="inline-flex min-h-11 items-center justify-center rounded-full border border-line px-4 text-sm font-semibold text-ink">
              {s.nombre}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
