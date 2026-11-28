"use client";

import { useEffect, useId, useRef, useState } from "react";

export type CargoOption = { cargo: string; nivel: number | null; descripcion: string };

/** Los mandos, de arriba hacia abajo. Cada bloque tiene su color para que la lista se lea de un vistazo. */
const BLOCKS = [
  { key: "produccion", title: "Producción", hint: "Mando alto · ve todo", niveles: [1, 2], color: "var(--gold-500)" },
  { key: "coordinacion", title: "Coordinación", hint: "Mando medio · ve su área", niveles: [3], color: "var(--ice-500)" },
  { key: "tecnica", title: "Técnica y proveedores", hint: "Ve lo suyo", niveles: [4], color: "var(--ok)" },
  { key: "cliente", title: "Cliente", hint: "Solo mira en vivo", niveles: [null], color: "var(--ink-muted)" },
] as const;

/**
 * Lista de cargos agrupada por mando, en lugar del menú del sistema (que no se puede ordenar ni pintar).
 * Envía el índice del cargo en un campo oculto llamado como `name`.
 */
export function CargoPicker({ name, cargos, defaultIndex }: { name: string; cargos: CargoOption[]; defaultIndex: number }) {
  const [selected, setSelected] = useState(defaultIndex);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(defaultIndex);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  const groups = BLOCKS.map((b) => ({
    ...b,
    items: cargos.map((c, i) => ({ ...c, i })).filter((c) => (b.niveles as readonly (number | null)[]).includes(c.nivel))
      .sort((a, b) => (a.nivel ?? 9) - (b.nivel ?? 9)),
  })).filter((g) => g.items.length > 0);
  const order = groups.flatMap((g) => g.items.map((c) => c.i));
  const current = cargos[selected];
  const currentBlock = BLOCKS.find((b) => (b.niveles as readonly (number | null)[]).includes(current?.nivel ?? null));

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const reveal = (i: number) =>
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" }));

  // Si el formulario se reinicia (después de invitar), vuelve al cargo por defecto.
  useEffect(() => {
    const form = root.current?.closest("form");
    const reset = () => setSelected(defaultIndex);
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [defaultIndex]);

  const choose = (i: number) => {
    setSelected(i);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return setOpen(false);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const pos = order.indexOf(active);
      const next = order[Math.min(order.length - 1, Math.max(0, pos + (e.key === "ArrowDown" ? 1 : -1)))];
      setActive(next);
      reveal(next);
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open) choose(active);
      else setOpen(true);
    }
  };

  return (
    <div ref={root} className="cargo-picker relative">
      <input type="hidden" name={name} value={selected} />
      <button
        type="button"
        id={`${id}-btn`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => {
          setActive(selected);
          setOpen((o) => !o);
        }}
        onKeyDown={onKey}
        className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-line bg-surface-000 px-3 text-left outline-none focus:border-ice-300"
      >
        <span className="cargo-dot" style={{ background: currentBlock?.color }} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-ink">{current?.cargo}</span>
          <span className="block truncate text-xs text-ink-muted">
            {currentBlock?.title} · {current?.descripcion}
          </span>
        </span>
        <span aria-hidden className={`text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-labelledby={`${id}-btn`}
          aria-activedescendant={`${id}-o${active}`}
          tabIndex={-1}
          onKeyDown={onKey}
          className="cargo-menu absolute inset-x-0 z-30 mt-2 max-h-[26rem] overflow-y-auto rounded-2xl border border-line-dark bg-navy-950 p-2 shadow-2xl"
        >
          {groups.map((g, gi) => (
            <li key={g.key} role="presentation" className={gi ? "mt-2 border-t border-white/10 pt-2" : ""}>
              <div className="flex items-baseline gap-2 px-3 pb-1.5 pt-1" style={{ color: g.color }}>
                <span className="cargo-dots" aria-hidden>
                  ···
                </span>
                <span className="font-display text-xs font-semibold uppercase tracking-[0.16em]">{g.title}</span>
                <span className="ml-auto text-[11px] text-white/45">{g.hint}</span>
              </div>
              <ul role="group" aria-label={g.title}>
                {g.items.map((c) => (
                  <li
                    key={c.i}
                    id={`${id}-o${c.i}`}
                    data-i={c.i}
                    role="option"
                    aria-selected={c.i === selected}
                    data-active={c.i === active || undefined}
                    onMouseEnter={() => setActive(c.i)}
                    onClick={() => choose(c.i)}
                    className="cargo-option"
                    style={{ "--cargo-color": g.color } as React.CSSProperties}
                  >
                    <span className="cargo-dot" style={{ background: g.color }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{c.cargo}</span>
                    {c.nivel && <span className="cargo-nivel">N{c.nivel}</span>}
                    <span className="w-4 text-center" aria-hidden>
                      {c.i === selected ? "✓" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
