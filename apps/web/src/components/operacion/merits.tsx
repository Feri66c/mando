import { starsLabel, type EventScore } from "@mando/core/merits";

// Piezas para mostrar los méritos. Aisladas para que el rediseño visual cambie su forma sin tocar las pantallas.

/** Estrellas de 0 a 5 con medios. El valor va también escrito. */
export function Stars({ value, max = 5, size = 28 }: { value: number | null; max?: number; size?: number }) {
  const path = "M12 2.5l2.9 6.2 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6L2.5 9.5l6.6-.8z";
  return (
    <span role="img" aria-label={starsLabel(value, max)} className="inline-flex gap-1">
      {Array.from({ length: max }, (_, i) => {
        const fill = value === null ? 0 : Math.max(0, Math.min(1, value - i));
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <path d={path} className="fill-surface-200" />
            {fill > 0 && (
              <path d={path} className="fill-gold-300" style={fill < 1 ? { clipPath: "inset(0 50% 0 0)" } : undefined} />
            )}
          </svg>
        );
      })}
    </span>
  );
}

/** Tarjeta grande con las estrellas del evento y por qué. */
export function ScoreCard({ score }: { score: EventScore }) {
  const value = score.stars === null ? "—" : String(score.stars).replace(".", ",");
  return (
    <section aria-label="Estrellas del evento" className="rounded-card bg-surface-100 p-5">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink-muted">Estrellas del evento</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <p className="font-mono text-6xl font-semibold leading-none">
          {value}
          <span className="ml-1 text-xl text-ink-muted">/ 5</span>
        </p>
        <Stars value={score.stars} />
      </div>
      <p className="mt-3 text-sm text-ink-muted">
        {score.locked
          ? "Falló un no negociable: el evento queda sin estrellas, aunque lo demás haya salido bien."
          : score.stars === null
            ? "Todavía no hay nada que medir. Las estrellas aparecen cuando empieza la primera pieza."
            : "Se calculan solas con lo que pasa en el evento. Así se ven para el equipo y para el cliente."}
      </p>
      {score.locked && (
        <p className="mt-3 inline-block bg-white px-2.5 py-1 font-mono text-xs font-bold uppercase tracking-[0.14em] text-navy-950">
          Red Flag · sin estrellas
        </p>
      )}
    </section>
  );
}

/** Los criterios con su barra, su dato y su peso. */
export function CriteriaBars({ score }: { score: EventScore }) {
  return (
    <ul aria-label="Criterios de producción" className="grid gap-2">
      {score.criteria.map((c) => {
        const pct = c.score === null ? null : Math.round(c.score * 100);
        return (
          <li key={c.key} className="rounded-card bg-surface-100 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-semibold">{c.name}</p>
              <p className="shrink-0 font-mono text-sm text-ink-muted">{pct === null ? "Sin datos" : `${pct} %`}</p>
            </div>
            <div className="mt-2 h-1.5 bg-surface-200" aria-hidden="true">
              {pct !== null && <div className="h-full bg-gold-300" style={{ width: `${pct}%` }} />}
            </div>
            <p className="mt-2 text-sm">{c.detail}</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {c.explanation} Pesa {c.weight} de 100.
            </p>
          </li>
        );
      })}
    </ul>
  );
}
