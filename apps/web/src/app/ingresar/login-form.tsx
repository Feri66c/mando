"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "@/app/actions/auth";

const initial: SignInState = { error: null, email: "" };

export function LoginForm({ returnTo }: { returnTo: string }) {
  const [state, action, pending] = useActionState(signIn, initial);

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="volver" value={returnTo} />
      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium text-ink">
          Correo
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={state.email}
          className="block min-h-11 w-full rounded-card border border-line bg-surface-100 px-3 text-base text-ink outline-none focus:border-navy-600"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium text-ink">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="block min-h-11 w-full rounded-card border border-line bg-surface-100 px-3 text-base text-ink outline-none focus:border-navy-600"
        />
      </div>
      {state.error && (
        <p role="alert" className="rounded-chip border border-critical/30 bg-critical/5 px-3 py-2 text-sm text-critical">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-card bg-navy-800 px-4 font-display text-base font-semibold text-ink-inverse hover:bg-navy-950 disabled:opacity-60"
      >
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
