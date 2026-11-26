import Link from "next/link";
import { levelChipColors, levelOf, type CriticalityConfig } from "@mando/core/criticality";
import { ITEM_STATUS_LABEL, type ItemStatus } from "@mando/core/labels";

// Piezas visuales del tema oscuro de operación. Regla 8: todo estado y nivel lleva su nombre escrito.

const DARK_BG = "#0c1f3d"; // tarjetas del tema oscuro

/** Una forma por nivel de criticidad (decisión 38). Siempre va junto al nombre, nunca sola. */
export function LevelShape({ level, className = "size-4" }: { level: number; className?: string }) {
  const common = { "aria-hidden": true, viewBox: "0 0 30 30", className: `shrink-0 ${className}` } as const;
  if (level >= 4)
    return (
      <svg {...common} fill="#FFFFFF">
        <path d="M5 2 H8 V28 H5 Z" />
        <path d="M10 3 H27 L22 9.5 L27 16 H10 Z" fill="#E0503A" stroke="#FFFFFF" strokeWidth="1.5" />
      </svg>
    );
  if (level === 3)
    return (
      <svg {...common}>
        <path d="M9.5 2 H20.5 L28 9.5 V20.5 L20.5 28 H9.5 L2 20.5 V9.5 Z" fill="#E0503A" />
        <path d="M13.5 8 H16.5 V17 H13.5 Z M13.5 19.5 H16.5 V22.5 H13.5 Z" fill="#FFFFFF" />
      </svg>
    );
  if (level === 2)
    return (
      <svg {...common}>
        <path d="M15 1.5 L28.5 15 L15 28.5 L1.5 15 Z" fill="#E4C65B" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M15 2 L26.5 8.5 V21.5 L15 28 L3.5 21.5 V8.5 Z" fill="#A9CCE8" />
    </svg>
  );
}

export function LevelChip({
  level,
  config,
  background = DARK_BG,
}: {
  level: number;
  config: CriticalityConfig | null;
  background?: string;
}) {
  const info = levelOf(config, level);
  const c = levelChipColors(info.color, background);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 bg-surface-000 px-2 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider"
      style={{ color: c.fg === "#061428" ? "#f7f9fc" : c.fg }}
    >
      <LevelShape level={level} />
      {info.nombre}
    </span>
  );
}

const STATUS_DOT: Record<ItemStatus, string> = {
  pending: "bg-ice-300",
  in_progress: "bg-gold-300",
  done: "bg-[#4fbf8b]",
  at_risk: "bg-[#ff7a5c]",
  moved: "bg-ice-500",
  cancelled: "bg-ink-muted",
};

export function StatusChip({ status }: { status: ItemStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-200 px-2.5 py-0.5 text-xs font-medium text-ink">
      <span aria-hidden className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
      {ITEM_STATUS_LABEL[status]}
    </span>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-card bg-surface-100 p-4 ${className}`}>{children}</div>;
}

export function PageTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h1 className="font-display text-[28px] font-bold leading-[1.05]">{children}</h1>
      {aside}
    </div>
  );
}

export function SectionTitle({ children, href, linkLabel }: { children: React.ReactNode; href?: string; linkLabel?: string }) {
  return (
    <div className="mb-2 mt-6 flex items-baseline justify-between">
      <h2 className="etiqueta-mando text-ice-300">{children}</h2>
      {href && (
        <Link href={href} className="text-sm font-medium text-ink underline underline-offset-4">
          {linkLabel ?? "Ver todo"}
        </Link>
      )}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-card border border-dashed border-line p-4 text-sm text-ink-muted">{children}</p>;
}

/** Barra de color a la izquierda por área (patrón de grupos con color). El nombre del área va escrito al lado. */
const AREA_COLORS = ["#6fa3cc", "#c9a227", "#4fbf8b", "#b48ee0", "#ff9f6e", "#5cc8d6", "#e07aa8"];
export function areaColor(order: number): string {
  return AREA_COLORS[Math.abs(order) % AREA_COLORS.length];
}

export const buttonPrimary =
  "inline-flex min-h-14 items-center justify-center rounded-full bg-gold-500 px-5 text-base font-semibold text-navy-950 disabled:opacity-60";
export const buttonSecondary =
  "inline-flex min-h-12 items-center justify-center rounded-full bg-surface-200 px-4 text-sm font-semibold text-ink disabled:opacity-60";
export const buttonGhost =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-line px-4 text-sm font-semibold text-ink disabled:opacity-60";
export const inputClass =
  "block min-h-11 w-full rounded-2xl border border-line bg-surface-000 px-3 text-base text-ink placeholder:text-ink-muted/70 outline-none focus:border-ice-300";
