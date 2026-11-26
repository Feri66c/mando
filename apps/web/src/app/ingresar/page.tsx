import type { Metadata } from "next";
import { Logo, SetupNotice } from "@/components/brand";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ volver?: string; correo?: string }> }) {
  const { volver, correo } = await searchParams;
  const configured = getSupabaseConfig() !== null;

  return (
    <main className="flex min-h-dvh flex-col">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
        <Logo className="mx-auto h-auto w-56" />
        <p className="mt-3 text-center font-mono text-xs uppercase tracking-[0.42em] text-ice-300">Event Control</p>
        <p className="mt-6 text-center font-display text-xl font-semibold leading-tight">Tener el mando es tener el evento.</p>
        <div className="mt-6 rounded-card bg-surface-100 p-6">
          <h1 className="font-display text-[28px] font-bold leading-none text-ink">Identifícate.</h1>
          <p className="mt-1 text-sm text-ink-muted">Entra con el correo con el que te invitaron al evento.</p>
          <div className="mt-6">{configured ? <LoginForm returnTo={volver ?? "/eventos"} initialEmail={typeof correo === "string" ? correo.slice(0, 200) : ""} /> : <SetupNotice />}</div>
        </div>
        <p className="mt-4 text-center text-sm text-ink-muted">A MANDO solo se entra con invitación.</p>
      </div>
    </main>
  );
}
