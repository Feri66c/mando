import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">404</p>
      <h1 className="mt-2 font-display text-2xl font-semibold">No encontramos esta página.</h1>
      <p className="mt-2 text-sm text-ink-muted">Puede que no exista o que no tengas acceso a este evento.</p>
      <Link href="/eventos" className="mt-6 font-medium text-navy-600 hover:underline">
        Volver a Mis eventos
      </Link>
    </main>
  );
}
