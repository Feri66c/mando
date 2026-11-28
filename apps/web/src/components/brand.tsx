import Image from "next/image";
import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { Cara } from "@/components/perfil/cara";

/**
 * Logo MANDO. "oscuro" va sobre fondo oscuro; "claro" sobre fondos claros. Con "auto" se pintan los dos
 * y el modo de pantalla elige cuál se ve (en modo Sol, el claro).
 */
export function Logo({ variant = "auto", className = "" }: { variant?: "oscuro" | "claro" | "auto"; className?: string }) {
  const img = (v: "oscuro" | "claro", extra = "") => (
    <Image
      src={v === "oscuro" ? "/brand/mando-logo-sobre-navy.svg" : "/brand/mando-logo-ajustado-claro.svg"}
      alt="MANDO · Event Control"
      width={2400}
      height={969}
      priority
      className={`${className} ${extra}`}
    />
  );
  if (variant !== "auto") return img(variant);
  return (
    <>
      {img("oscuro", "logo-para-oscuro")}
      {img("claro", "logo-para-claro")}
    </>
  );
}

/** La marca que acompaña a MANDO: «MANDO Momentum», «MANDO Circus» (decisión 95). */
export type MandoBrand = { brandName: string | null; parentName: string | null; logoUrl: string | null };

/**
 * Logo MANDO grande y, a su lado, el mando de marca: el logo de la agencia en su placa blanca, o su nombre
 * escrito en grande. Sin marca, queda solo MANDO.
 */
export function MandoLockup({ brand, size = "grande" }: { brand?: MandoBrand | null; size?: "grande" | "mediano" }) {
  const big = size === "grande";
  const hasBrand = Boolean(brand && (brand.brandName || brand.logoUrl));
  return (
    <span className="flex min-w-0 items-center gap-3 sm:gap-4">
      <Logo className={big ? "h-14 w-auto shrink-0 sm:h-[72px]" : "h-11 w-auto shrink-0 sm:h-14"} />
      {hasBrand && brand && (
        <>
          <span aria-hidden className={`w-[3px] shrink-0 rounded-full bg-gold-500 shadow-[0_0_10px_rgba(255,214,10,0.45)] ${big ? "h-12 sm:h-14" : "h-10 sm:h-12"}`} />
          <span className="flex min-w-0 flex-col justify-center">
            {brand.logoUrl ? (
              // Logo subido por la organización al cubo privado; el enlace firmado cambia cada hora.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.logoUrl}
                alt={brand.brandName ?? "Marca"}
                className={`w-auto max-w-[150px] rounded-md bg-white object-contain px-2 py-1 sm:max-w-[200px] ${big ? "h-11 sm:h-14" : "h-10 sm:h-12"}`}
              />
            ) : (
              <span className={`truncate font-display font-bold uppercase leading-none tracking-wide text-ink ${big ? "text-[26px] sm:text-[34px]" : "text-[22px] sm:text-[28px]"}`}>
                {brand.brandName}
              </span>
            )}
            {brand.parentName && (
              <span className="mt-1 truncate font-mono text-[11px] uppercase tracking-[0.16em] text-ice-300 sm:text-xs">{brand.parentName}</span>
            )}
          </span>
        </>
      )}
    </span>
  );
}

/** Cabecera navy de las pantallas con sesión. El oro del logo es el único acento de la pantalla. */
export function AppHeader({ label, userName, brand, face }: { label?: string; userName: string; brand?: MandoBrand | null; face?: string | null }) {
  return (
    <header className="text-ink">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <Link href="/eventos" className="flex min-w-0 items-center gap-3" aria-label="Ir a Mis eventos">
          <MandoLockup brand={brand} />
        </Link>
        <form action={signOut} className="flex shrink-0 items-center gap-3">
          <Link href="/perfil" className="flex min-h-11 items-center gap-2" aria-label={`Mi perfil: ${userName}`}>
            <Cara url={face} name={userName} size={44} />
            <span className="hidden text-sm text-ice-300 md:inline">{userName}</span>
          </Link>
          <button
            type="submit"
            className="min-h-11 rounded-full bg-surface-200 px-4 text-sm font-medium text-ink"
          >
            Salir
          </button>
        </form>
      </div>
      {label && (
        <div className="mx-auto max-w-3xl px-4 pb-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-ice-300">{label}</p>
        </div>
      )}
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
