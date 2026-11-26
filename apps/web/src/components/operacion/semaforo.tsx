import { planningSemaphore, type ElementStatus } from "@mando/core/planning";

const COLOR = { rojo: "var(--critical)", amarillo: "var(--gold-300)", verde: "var(--ok)" } as const;
const FILL = {
  rojo: "var(--critical)",
  amarillo: "linear-gradient(90deg, var(--critical), var(--naranja), var(--gold-300))",
  verde: "var(--ok)",
} as const;

/** Semáforo del avance (decisión 44): rojo, amarillo y verde total. El color siempre va con su texto. */
export function Semaforo({ elements }: { elements: ElementStatus[] }) {
  const s = planningSemaphore(elements);
  return (
    <div role="img" aria-label={`${s.label}: ${s.percent} por ciento`}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: COLOR[s.color] }}>
          {s.label}
        </span>
        <span className="shrink-0 whitespace-nowrap font-mono text-2xl font-semibold" style={{ color: COLOR[s.color], textShadow: `0 0 14px ${COLOR[s.color]}` }}>
          {s.percent} %
        </span>
      </div>
      <div className="semaforo-pista mt-2">
        <i style={{ width: `${Math.max(4, s.percent)}%`, background: FILL[s.color], boxShadow: `0 0 14px ${COLOR[s.color]}` }} />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[11px] font-semibold tracking-wider">
        <span className="text-critical">ROJO</span>
        <span className="text-gold-300">AMARILLO</span>
        <span className="text-ok">VERDE · 100 %</span>
      </div>
    </div>
  );
}
