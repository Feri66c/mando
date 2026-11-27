"use client";

import { useActionState, useRef, useState } from "react";
import { deleteCustomType, type PanelState } from "@/app/actions/panel";
import type { SavedCustomType } from "@/lib/data";
import { playTap } from "@/components/operacion/pieza";
import { inputClass } from "@/components/operacion/ui";
import {
  CUSTOM_AREAS,
  CUSTOM_BLOCKS,
  CUSTOM_NAME_MAX,
  areaLoad,
  customModule,
  customSummary,
  suggestModules,
  type CustomModule,
  type composeCustomTemplate,
} from "@mando/core/custom-event";

const AREA_NAME = Object.fromEntries(
  CUSTOM_AREAS.map((a) => [a.clave, a.nombre]),
);

/** Un componente del evento personalizado: se marca como un botón del tablero, con su sonido. */
function Componente({
  module,
  on,
  onToggle,
}: {
  module: CustomModule;
  on: boolean;
  onToggle: () => void;
}) {
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
      <input
        type="checkbox"
        name="componente"
        value={module.clave}
        checked={on}
        onChange={onToggle}
        className="sr-only"
      />
      <span aria-hidden className="componente-check" />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-lg font-semibold leading-snug">
          {module.nombre}
        </span>
        <span className="mt-1 block text-sm text-ink-muted">
          {module.descripcion}
        </span>
        <span className="componente-deriva">
          {module.deriva.map((a) => (
            <span key={a}>{AREA_NAME[a] ?? a}</span>
          ))}
        </span>
      </span>
    </label>
  );
}

const idle: PanelState = { ok: false, error: null };

/** Tus tipos guardados: un toque los carga; borrar pide un segundo toque. */
function SavedTypes({
  types,
  onPick,
}: {
  types: SavedCustomType[];
  onPick: (t: SavedCustomType) => void;
}) {
  const [state, deleteAction, deleting] = useActionState(
    deleteCustomType,
    idle,
  );
  const [armed, setArmed] = useState<string | null>(null);
  if (types.length === 0) return null;
  return (
    <section aria-label="Tus tipos guardados">
      <p className="bloque-titulo">Tus tipos guardados</p>
      {/* qué tipo se borra: el botón de confirmar manda el formulario con este valor */}
      <input type="hidden" name="tipo_guardado" value={armed ?? ""} />
      <ul className="mt-2 grid gap-2">
        {types.map((t) => (
          <li key={t.id} className="guardado">
            <button
              type="button"
              className="guardado-usar"
              onClick={() => {
                playTap("up");
                setArmed(null);
                onPick(t);
              }}
            >
              <span className="block font-display text-lg font-semibold leading-snug">
                {t.name}
              </span>
              <span className="mt-0.5 block text-sm text-ink-muted">
                {t.modules.length} componentes · tócalo para cargarlo
              </span>
            </button>
            {armed === t.id ? (
              <button
                key="confirmar"
                type="submit"
                formAction={deleteAction}
                formNoValidate
                disabled={deleting}
                className="guardado-borrar"
                data-armado=""
              >
                {deleting ? "Borrando…" : "¿Borrar?"}
              </button>
            ) : (
              <button
                key="armar"
                type="button"
                className="guardado-borrar"
                onClick={() => setArmed(t.id)}
              >
                Borrar
              </button>
            )}
          </li>
        ))}
      </ul>
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-[#ff6f86]">
          {state.error}
        </p>
      )}
    </section>
  );
}

/** El brief se escribe aquí y MANDO marca los componentes que el brief menciona. */
function BriefReader({
  brief,
  onBrief,
  onSuggest,
}: {
  brief: string;
  onBrief: (v: string) => void;
  onSuggest: (keys: string[]) => void;
}) {
  const [found, setFound] = useState<
    { clave: string; palabra: string }[] | null
  >(null);
  return (
    <div className="space-y-2">
      <label htmlFor="brief" className="block text-base font-semibold">
        Brief <span className="font-normal text-ink-muted">(opcional)</span>
      </label>
      <textarea
        id="brief"
        name="brief"
        rows={5}
        maxLength={4000}
        value={brief}
        onChange={(e) => onBrief(e.target.value)}
        placeholder="Qué se quiere lograr, dónde, con quién y qué llega de fuera."
        className={`${inputClass} py-2 text-base`}
      />
      <button
        type="button"
        className="leer-brief"
        disabled={brief.trim().length === 0}
        onClick={() => {
          playTap("up");
          const hits = suggestModules(brief);
          setFound(hits);
          onSuggest(hits.map((h) => h.clave));
        }}
      >
        Leer el brief y marcar
      </button>
      {found && (
        <p aria-live="polite" className="text-sm text-ink-muted">
          {found.length === 0
            ? "No encontré componentes en el brief. Márcalos tú abajo."
            : `Marqué ${found.length} por lo que dice el brief: ${found
                .map(
                  (f) =>
                    `${customModule(f.clave)?.nombre ?? f.clave} («${f.palabra}»)`,
                )
                .join(", ")}. Revisa y ajusta.`}
        </p>
      )}
    </div>
  );
}

/** Armado del evento personalizado: nombre del tipo, brief y componentes por bloque. */
export function CustomBuilder({
  typeName,
  onTypeName,
  selected,
  onToggle,
  onAdd,
  onLoad,
  brief,
  onBrief,
  savedTypes,
}: {
  typeName: string;
  onTypeName: (v: string) => void;
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onAdd: (keys: string[]) => void;
  onLoad: (name: string, keys: string[]) => void;
  brief: string;
  onBrief: (v: string) => void;
  savedTypes: SavedCustomType[];
}) {
  return (
    <div className="mt-5 space-y-6">
      <SavedTypes
        types={savedTypes}
        onPick={(t) => onLoad(t.name, t.modules)}
      />
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
        <p className="text-sm text-ink-muted">
          Así lo verá todo el equipo en el evento. Marca abajo todo lo que
          lleva.
        </p>
        <label className="guardar-tipo">
          <input
            type="checkbox"
            name="guardar_tipo"
            value="1"
            defaultChecked
            className="h-5 w-5 accent-[var(--gold-300)]"
          />
          Guardar este tipo para reusarlo
        </label>
      </div>
      <BriefReader brief={brief} onBrief={onBrief} onSuggest={onAdd} />
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
                <Componente
                  key={m.clave}
                  module={m}
                  on={selected.has(m.clave)}
                  onToggle={() => onToggle(m.clave)}
                />
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
          <li
            key={area.clave}
            className="deriva-fila"
            data-on={count > 0 ? "" : undefined}
          >
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
