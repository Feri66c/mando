import { planningSemaphore, type ElementStatus } from "@mando/core/planning";

const COLOR = { rojo: "var(--critical)", amarillo: "var(--gold-300)", verde: "var(--ok)" } as const;
const LEDS = 20;

/** Color de cada LED según su lugar en la línea: rojo al inicio, naranja, amarillo y verde al final. */
function ledColor(i: number): string {
  const at = (i + 1) / LEDS;
  if (at <= 0.3) return "var(--critical)";
  if (at <= 0.5) return "var(--naranja)";
  if (at <= 0.9) return "var(--gold-300)";
  return "var(--ok)";
}

/**
 * Semáforo del avance (decisión 44): rojo, amarillo y verde total. El color siempre va con su texto.
 * La línea es una fila de LEDs: los apagados se ven de fondo y se van encendiendo conforme avanza (decisión 71).
 */
export function Semaforo({ elements }: { elements: ElementStatus[] }) {
  const s = planningSemaphore(elements);
  const lit = Math.min(LEDS, Math.floor((s.percent / 100) * LEDS));
  return (
    <div role="img" aria-label={`${s.label}: ${s.percent} por ciento`}>
      <div className="flex items-center justify-between gap-3">
        <span className="semaforo-rotulo font-mono text-sm font-semibold uppercase tracking-[0.12em]" data-alerta={s.color === "rojo" ? "" : undefined} style={{ color: COLOR[s.color] }}>
          <i aria-hidden />
          {s.label}
        </span>
        <span className="shrink-0 whitespace-nowrap font-mono text-3xl font-semibold" style={{ color: COLOR[s.color], textShadow: `0 0 12px color-mix(in srgb, ${COLOR[s.color]} 55%, transparent)` }}>
          {s.percent} %
        </span>
      </div>
      <div className="leds mt-3" aria-hidden>
        {Array.from({ length: LEDS }, (_, i) => (
          <i key={i} style={{ "--tono": ledColor(i) } as React.CSSProperties} data-on={i < lit ? "" : undefined} data-sigue={i === lit && s.color !== "verde" ? "" : undefined} />
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] font-semibold tracking-wider">
        <span className="text-critical">ROJO</span>
        <span className="text-gold-300">AMARILLO</span>
        <span className="text-ok">VERDE · 100 %</span>
      </div>
    </div>
  );
}
