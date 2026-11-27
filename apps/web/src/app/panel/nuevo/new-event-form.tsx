"use client";

import { useActionState, useState } from "react";
import { createEvent, type PanelState } from "@/app/actions/panel";
import { PieceChain, TierMeter } from "@/components/panel/kit";
import { buttonPrimary, inputClass } from "@/components/operacion/ui";
import type { EventTemplate, TierKey } from "@mando/core/event-types";
import { DEFAULT_TIMEZONE, ZONE_OPTIONS, zoneLabel } from "@mando/core/time";

const initial: PanelState = { ok: false, error: null };
const label = "block text-sm font-medium";

export function NewEventForm({
  organizationId,
  templates,
  tiers,
}: {
  organizationId: string;
  templates: EventTemplate[];
  tiers: Record<TierKey, { nombre: string; descripcion: string }>;
}) {
  const [state, action, pending] = useActionState(createEvent, initial);
  const [kind, setKind] = useState(templates[0].clave);
  const template = templates.find((t) => t.clave === kind) ?? templates[0];
  const [zone, setZone] = useState(DEFAULT_TIMEZONE);

  return (
    <form action={action} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <input type="hidden" name="organizacion" value={organizationId} />

      <fieldset className="min-w-0">
        <legend className="font-display text-lg font-semibold">¿Qué tipo de evento es?</legend>
        <div className="mt-3 grid gap-2">
          {templates.map((t) => (
            <label
              key={t.clave}
              className={`flex cursor-pointer items-start gap-3 p-4 transition-colors ${
                t.clave === kind ? "bg-surface-200 outline outline-2 outline-gold-300" : "bg-surface-100 hover:bg-surface-200"
              }`}
            >
              <input
                type="radio"
                name="tipo"
                value={t.clave}
                checked={t.clave === kind}
                onChange={() => setKind(t.clave)}
                className="mt-1 h-4 w-4 accent-[var(--gold-300)]"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-display text-base font-semibold">{t.nombre}</span>
                  <TierMeter tier={t.tamano} label={tiers[t.tamano].nombre} />
                </span>
                <span className="mt-1 block text-sm text-ink-muted">{t.descripcion}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="min-w-0 space-y-5">
        <section aria-live="polite" className="bg-surface-100 p-4">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink-muted">
            {template.nombre} · {template.piezas.length} piezas
          </p>
          <div className="mt-3">
            <PieceChain pieces={template.piezas} />
          </div>
          <p className="mt-3 text-xs text-ink-muted">◆ Pieza clave: si se atrasa, mueve la hora que el cliente espera.</p>
        </section>

        <div className="space-y-1.5">
          <label htmlFor="nombre" className={label}>
            Nombre del evento
          </label>
          <input id="nombre" name="nombre" required maxLength={120} placeholder="Ferias Nacionales Sodimac · Fecha 1" className={inputClass} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="cliente" className={label}>
              Cliente
            </label>
            <input id="cliente" name="cliente" maxLength={120} className={inputClass} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="lugar" className={label}>
              Lugar
            </label>
            <input id="lugar" name="lugar" maxLength={120} className={inputClass} />
          </div>
        </div>
        <fieldset>
          <legend className={label}>Hora clave: {template.hora_clave.toLowerCase()}</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="fecha" className="sr-only">
                Fecha
              </label>
              <input id="fecha" name="fecha" type="date" required className={`${inputClass} font-mono`} />
            </div>
            <div>
              <label htmlFor="hora" className="sr-only">
                Hora
              </label>
              <input id="hora" name="hora" type="time" required defaultValue="10:00" className={`${inputClass} font-mono`} />
            </div>
          </div>
          <div className="mt-4 space-y-1.5">
            <label htmlFor="zona" className={label}>
              Hora del evento
            </label>
            <select id="zona" name="zona" value={zone} onChange={(e) => setZone(e.target.value)} className={inputClass}>
              {ZONE_OPTIONS.map((z) => (
                <option key={z.zona} value={z.zona}>
                  Hora de {z.nombre}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">
            La fecha y la hora de arriba están en hora de {zoneLabel(zone)}. Todo el equipo verá el reloj del evento en esa hora. Las demás piezas se acomodan solas antes y después.
          </p>
        </fieldset>
        <div className="space-y-1.5">
          <label htmlFor="brief" className={label}>
            Brief <span className="font-normal text-ink-muted">(opcional)</span>
          </label>
          <textarea id="brief" name="brief" rows={3} maxLength={4000} placeholder="Qué se quiere lograr, con qué producto y para quién." className={`${inputClass} py-2`} />
        </div>

        {state.error && (
          <p role="alert" className="border border-critical/40 bg-critical/10 px-3 py-2 text-sm">
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
          {pending ? "Creando…" : "Crear evento y armar el equipo"}
        </button>
      </div>
    </form>
  );
}
