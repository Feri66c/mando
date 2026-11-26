"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "@/app/actions/auth";

const initial: SignInState = { error: null, email: "", step: "email" };

const field =
  "block min-h-11 w-full rounded-card border border-line bg-surface-100 px-3 text-base text-ink outline-none focus:border-navy-600";
const primary =
  "min-h-11 w-full rounded-card bg-navy-800 px-4 font-display text-base font-semibold text-ink-inverse hover:bg-navy-950 disabled:opacity-60";
const secondary = "min-h-11 w-full rounded-card px-4 text-sm font-medium text-navy-700 underline-offset-4 hover:underline";

export function LoginForm({ returnTo, initialEmail = "" }: { returnTo: string; initialEmail?: string }) {
  const [state, action, pending] = useActionState(signIn, { ...initial, email: initialEmail });

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="volver" value={returnTo} />
      {state.step === "code" ? (
        <>
          <input type="hidden" name="email" value={state.email} />
          {state.notice && <p className="text-sm text-ink">{state.notice}</p>}
          <div className="space-y-1.5">
            <label htmlFor="code" className="block text-sm font-medium text-ink">
              Código
            </label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              autoFocus
              className={`${field} font-mono text-2xl tracking-[0.4em]`}
            />
          </div>
        </>
      ) : (
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
            className={field}
          />
        </div>
      )}
      {state.step === "password" && (
        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium text-ink">
            Contraseña
          </label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className={field} />
        </div>
      )}
      {state.error && (
        <p role="alert" className="rounded-chip border border-critical/30 bg-critical/5 px-3 py-2 text-sm text-critical">
          {state.error}
        </p>
      )}
      {state.step === "email" && (
        <>
          <button type="submit" name="intent" value="send-code" disabled={pending} className={primary}>
            {pending ? "Enviando…" : "Mándame un código"}
          </button>
          <button type="submit" name="intent" value="use-password" formNoValidate className={secondary}>
            Entrar con contraseña
          </button>
        </>
      )}
      {state.step === "code" && (
        <>
          <button type="submit" name="intent" value="verify-code" disabled={pending} className={primary}>
            {pending ? "Entrando…" : "Entrar"}
          </button>
          <button type="submit" name="intent" value="send-code" formNoValidate className={secondary}>
            Mándame otro código
          </button>
        </>
      )}
      {state.step === "password" && (
        <>
          <button type="submit" name="intent" value="password" disabled={pending} className={primary}>
            {pending ? "Entrando…" : "Entrar"}
          </button>
          <button type="submit" name="intent" value="use-code" formNoValidate className={secondary}>
            Entrar con código
          </button>
        </>
      )}
    </form>
  );
}
