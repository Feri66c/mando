"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SignInState = {
  error: string | null;
  email: string;
  /** "email": pedir correo · "code": escribir el código · "password": entrar con contraseña. */
  step: "email" | "code" | "password";
  notice?: string;
};

/** Solo se aceptan rutas internas para volver después de iniciar sesión. */
function safeReturnPath(value: FormDataEntryValue | null): string {
  const path = typeof value === "string" ? value : "";
  return path.startsWith("/") && !path.startsWith("//") ? path : "/eventos";
}

/**
 * Al entrar: la persona se une a los eventos a los que la invitaron y, si le falta ver alguna bienvenida,
 * va primero ahí. Si algo falla aquí no se bloquea el ingreso: «Mis eventos» lo vuelve a intentar.
 */
async function afterSignIn(supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>, fallback: string): Promise<string> {
  try {
    await supabase.rpc("claim_invitations");
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return fallback;
    const { data } = await supabase
      .from("event_members")
      .select("event_id, created_at")
      .eq("profile_id", user.user.id)
      .is("welcomed_at", null)
      .order("created_at", { ascending: true })
      .limit(1);
    const pending = data?.[0]?.event_id as string | undefined;
    return pending ? `/bienvenida/${pending}` : fallback;
  } catch {
    return fallback;
  }
}

const NOT_CONNECTED = "La app aún no está conectada a Supabase.";

/**
 * Un solo formulario con tres pasos. Por defecto: correo → código de 6 dígitos (decisión 7).
 * La contraseña queda para los usuarios de prueba y las pruebas automáticas.
 */
export async function signIn(prev: SignInState, formData: FormData): Promise<SignInState> {
  const intent = String(formData.get("intent") ?? "send-code");
  const email = String(formData.get("email") ?? prev.email ?? "").trim().toLowerCase();

  if (intent === "use-password") return { error: null, email, step: "password" };
  if (intent === "use-code") return { error: null, email, step: "email" };

  const supabase = await createClient();
  if (!supabase) return { error: NOT_CONNECTED, email, step: prev.step };

  if (intent === "send-code") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Escribe un correo válido.", email, step: "email" };
    // Solo entran personas invitadas: quien ya tiene cuenta, o quien tiene una invitación pendiente
    // (a esa persona se le crea la cuenta al pedir su primer código).
    const { data: invited } = await supabase.rpc("invitation_pending", { p_email: email });
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: invited === true } });
    if (error) {
      const tooMany = error.status === 429 || error.message.toLowerCase().includes("rate");
      return {
        error: tooMany
          ? "Pediste muchos códigos seguidos. Espera un minuto y vuelve a intentar."
          : "No encontramos una invitación para ese correo. Revisa que esté bien escrito.",
        email,
        step: "email",
      };
    }
    return { error: null, email, step: "code", notice: `Te mandamos un código de 6 dígitos a ${email}.` };
  }

  if (intent === "verify-code") {
    const token = String(formData.get("code") ?? "").replace(/\D/g, "");
    if (token.length !== 6) return { error: "El código tiene 6 dígitos.", email, step: "code" };
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    if (error) return { error: "El código no es correcto o ya venció. Pide uno nuevo.", email, step: "code" };
    redirect(await afterSignIn(supabase, safeReturnPath(formData.get("volver"))));
  }

  // intent === "password"
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Escribe tu correo y tu contraseña.", email, step: "password" };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const wrong = error.message.toLowerCase().includes("invalid");
    return {
      error: wrong ? "Correo o contraseña incorrectos." : "No pudimos iniciar tu sesión. Intenta de nuevo en un momento.",
      email,
      step: "password",
    };
  }
  redirect(await afterSignIn(supabase, safeReturnPath(formData.get("volver"))));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase?.auth.signOut();
  redirect("/ingresar");
}
