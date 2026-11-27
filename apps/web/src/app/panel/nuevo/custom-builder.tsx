"use client";

import { useRef } from "react";
import { playTap } from "@/components/operacion/pieza";
import { inputClass } from "@/components/operacion/ui";
import {
  CUSTOM_AREAS,
  CUSTOM_BLOCKS,
  CUSTOM_NAME_MAX,
  areaLoad,
  customSummary,
  type CustomModule,
  type composeCustomTemplate,
} from "@mando/core/custom-event";

const AREA_NAME = Object.fromEntries(CUSTOM_AREAS.map((a) => [a.clave, a.nombre]));

/** Un componente del evento personalizado: se marca como un botón del tablero, con su sonido. */
function Componente({ module, on, onToggle }: { module: CustomModule; on: boolean; onToggle: () => void }) {
  const down = useRef(false);
  return (
    <label
      className="componente"
      data-on={on ? "" : undefined}
      onPointerDown={() => {
        down.current = true;
        playTap("up");
      }}
      onPointerUp={() => {
        if (!down.current) return;
        down.current = false;
        playTap("down");
      }}
      onPointerLeave={() => {
        down.current = false;
      }}
    >
      <input type="checkbox" name="componente" value={module.clave} checked={on} onChange={onToggle} className="sr-only" />
      <span aria-hidden className="componente-check" />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-lg font-semibold leading-snug">{module.nombre}</span>
        <span className="mt-1 block text-sm text-ink-muted">{module.descripcion}</span>
        <span className="componente-deriva">
          {module.deriva.map((a) => (
            <span key={a}>{AREA_NAME[a] ?? a}</span>
          ))}
        </span>
      </span>
    </label>
  );
}

/** Armado del evento personalizado: nombre del tipo y componentes por bloque. */
export function CustomBuilder({
  typeName,
  onTypeName,
  selected,
  onToggle,
}: {
  typeName: string;
  onTypeName: (v: string) => void;
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="mt-5 space-y-6">
      <div className="space-y-1.5">
        <label htmlFor="nombre_tipo" className="block text-base font-semibold">
          Nombre de tu tipo de evento
        </label>
        <input
          id="nombre_tipo"
          name="nombre_tipo"
          required
          maxLength={CUSTOM_NAME_MAX}
          value={typeName}
          onChange={(e) => onTypeName(e.target.value)}
          className={`${inputClass} text-lg`}
        />
        <p className="text-sm text-ink-muted">Así lo verá todo el equipo en el evento. Marca abajo todo lo que lleva.</p>
      </div>
      {CUSTOM_BLOCKS.map((block) => {
        const count = block.modulos.filter((m) => selected.has(m.clave)).length;
        return (
          <fieldset key={block.clave} className="min-w-0">
            <legend className="bloque-titulo">
              {block.nombre}
              {count > 0 && <span className="bloque-cuenta">{count}</span>}
            </legend>
            <div className="mt-2 grid gap-2">
              {block.modulos.map((m) => (
                <Componente key={m.clave} module={m} on={selected.has(m.clave)} onToggle={() => onToggle(m.clave)} />
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/** Lo que el armado deriva a cada área, en LEDs que se encienden al marcar. */
export function CustomSummary({
  modules,
  template,
}: {
  modules: CustomModule[];
  template: ReturnType<typeof composeCustomTemplate>;
}) {
  const load = areaLoad(modules);
  const s = customSummary(template);
  const max = 10;
  const numbers: [number, string][] = [
    [s.documentos, "documentos al Legal"],
    [s.noNegociables, "no negociables (red flags)"],
    [s.cargos, "cargos para invitar"],
    [s.tecnica, "ítems técnicos"],
    [s.aprobaciones, "aprobaciones del cliente"],
    [s.partidas, "partidas de presupuesto"],
  ];
  return (
    <section aria-live="polite" className="deriva">
      <p className="deriva-titulo">Así se deriva</p>
      <ul className="mt-3 space-y-2.5">
        {load.map(({ area, count }) => (
          <li key={area.clave} className="deriva-fila" data-on={count > 0 ? "" : undefined}>
            <span className="deriva-area">{area.nombre}</span>
            <span className="deriva-leds" aria-hidden>
              {Array.from({ length: max }, (_, i) => (
                <span key={i} data-on={i < count ? "" : undefined} />
              ))}
            </span>
            <span className="deriva-num">{count}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2">
        {numbers.map(([n, label]) => (
          <div key={label} className="deriva-dato">
            <dt className="sr-only">{label}</dt>
            <dd>
              <span className="deriva-dato-num">{n}</span> {label}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
