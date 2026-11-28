import Link from "next/link";
import { MandoLockup, type MandoBrand } from "@/components/brand";
import { signOut } from "@/app/actions/auth";

// Piezas visuales del panel y de la bienvenida. Están juntas y aisladas a propósito:
// cuando se apruebe la nueva dirección visual, se cambia su forma aquí sin tocar la lógica.

/** Marco del panel del productor general: tema oscuro, logo y salida. */
export function PanelShell({ userName, brand, children }: { userName: string; brand?: MandoBrand | null; children: React.ReactNode }) {
  return (
    <div className="tema-operacion min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <Link href="/panel" className="flex min-w-0 items-center gap-3" aria-label="Ir al panel">
            <MandoLockup brand={brand} size="mediano" />
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/eventos" className="min-h-11 content-center px-3 font-medium text-ink-muted hover:text-ink">
              Mis eventos
            </Link>
            <form action={signOut} className="flex items-center gap-3">
              <span className="hidden text-ink-muted sm:inline">{userName}</span>
              <button type="submit" className="min-h-11 rounded-full border border-line px-4 font-medium hover:bg-surface-200">
                Salir
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-8">{children}</main>
    </div>
  );
}

/** Etiqueta pequeña en mayúsculas, sobre los títulos. */
export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`font-mono text-xs uppercase tracking-[0.16em] text-ink-muted ${className}`}>{children}</p>;
}

/** Tamaño del evento: tres barras, con su nombre escrito (el color nunca va solo). */
export function TierMeter({ tier, label }: { tier: string | null; label: string }) {
  const filled = tier === "mayor" ? 3 : tier === "medio" ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-ink-muted">
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span key={i} className={`h-1.5 w-4 ${i <= filled ? "bg-gold-300" : "bg-surface-200"}`} />
        ))}
      </span>
      {label}
    </span>
  );
}

/** Nivel en la jerarquía: número en un cuadro; el productor general va en dorado. */
export function LevelBadge({ level }: { level: number | null }) {
  const style = level === 1 ? "bg-gold-300 text-navy-950" : level ? "bg-surface-200 text-ink" : "border border-line text-ink-muted";
  return (
    <span className={`grid h-9 w-9 shrink-0 place-items-center font-mono text-sm font-semibold ${style}`} aria-hidden="true">
      {level ?? "◎"}
    </span>
  );
}

/** Cadena de piezas del tipo de evento. Las piezas clave llevan un rombo y la palabra «clave». */
export function PieceChain({ pieces }: { pieces: { titulo: string; detalle: string; clave: boolean }[] }) {
  return (
    <ol className="flex flex-wrap gap-1.5">
      {pieces.map((p, i) => (
        <li key={`${p.titulo}-${i}`} className={`min-w-36 flex-1 px-3 py-2.5 ${p.clave ? "bg-gold-500/15" : "bg-surface-200"}`}>
          <p className="font-display text-sm font-semibold">
            <span className="mr-1.5 font-mono text-xs text-ink-muted">{i + 1}</span>
            {p.titulo}
            {p.clave && <span className="ml-1.5 text-xs font-medium text-gold-300">◆ clave</span>}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">{p.detalle}</p>
        </li>
      ))}
    </ol>
  );
}
