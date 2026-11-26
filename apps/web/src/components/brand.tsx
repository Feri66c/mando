import Image from "next/image";
import Link from "next/link";
import { signOut } from "@/app/actions/auth";

/** Logo MANDO. "oscuro" va sobre navy; "claro" sobre fondos claros. */
export function Logo({ variant = "oscuro", className = "" }: { variant?: "oscuro" | "claro"; className?: string }) {
  return (
    <Image
      src={variant === "oscuro" ? "/brand/mando-logo-sobre-navy.svg" : "/brand/mando-logo-ajustado-claro.svg"}
      alt="MANDO · Event Control"
      width={2400}
      height={969}
      priority
      className={className}
    />
  );
}

/** Cabecera navy de las pantallas con sesión. El oro del logo es el único acento de la pantalla. */
export function AppHeader({ label, userName }: { label: string; userName: string }) {
  return (
    <header className="text-ink-inverse">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <Link href="/eventos" className="flex items-center gap-3" aria-label="Ir a Mis eventos">
          <Logo className="h-7 w-auto" />
        </Link>
        <form action={signOut} className="flex items-center gap-3">
          <span className="hidden text-sm text-ice-300 sm:inline">{userName}</span>
          <button
            type="submit"
            className="min-h-11 rounded-full bg-surface-200 px-4 text-sm font-medium text-ink-inverse"
          >
            Salir
          </button>
        </form>
      </div>
      <div className="mx-auto max-w-3xl px-4 pb-3">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-ice-300">MANDO · {label}</p>
      </div>
    </header>
  );
}

/** Aviso cuando la app aún no tiene las claves de Supabase (p. ej., recién publicada en Vercel). */
export function SetupNotice() {
  return (
    <div className="rounded-card border border-line bg-surface-100 p-5 text-ink">
      <h2 className="font-display text-lg font-semibold">Falta conectar la base de datos</h2>
      <p className="mt-2 text-sm text-ink-muted">
        La app está publicada, pero todavía no tiene la dirección y la clave pública de Supabase. Agrégalas como
        variables de entorno <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> y{" "}
        <code className="font-mono">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> y vuelve a publicar.
      </p>
    </div>
  );
}
