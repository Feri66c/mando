import Link from "next/link";
import { levelChipColors, levelOf, type CriticalityConfig } from "@/lib/core/criticality";
import { ITEM_STATUS_LABEL, type ItemStatus } from "@/lib/core/labels";

// Piezas visuales del tema oscuro de operación. Regla 8: todo estado y nivel lleva su nombre escrito.

const DARK_BG = "#0d2443"; // tarjetas del tema oscuro

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
      className="inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
      style={{ background: c.bg, color: c.fg, borderColor: c.border }}
    >
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
      <h1 className="font-display text-2xl font-semibold leading-tight">{children}</h1>
      {aside}
    </div>
  );
}

export function SectionTitle({ children, href, linkLabel }: { children: React.ReactNode; href?: string; linkLabel?: string }) {
  return (
    <div className="mb-2 mt-6 flex items-baseline justify-between">
      <h2 className="font-display text-base font-semibold">{children}</h2>
      {href && (
        <Link href={href} className="text-sm font-medium text-ice-300 underline-offset-4 hover:underline">
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
  "inline-flex min-h-12 items-center justify-center rounded-full bg-gold-500 px-5 text-base font-semibold text-navy-950 disabled:opacity-60";
export const buttonSecondary =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-surface-200 px-4 text-sm font-semibold text-ink disabled:opacity-60";
export const buttonGhost =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-line px-4 text-sm font-semibold text-ink disabled:opacity-60";
export const inputClass =
  "block min-h-11 w-full rounded-2xl border border-line bg-surface-000 px-3 text-base text-ink placeholder:text-ink-muted/70 outline-none focus:border-ice-300";
