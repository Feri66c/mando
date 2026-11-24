"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SignInState = { error: string | null; email: string };

/** Solo se aceptan rutas internas para volver después de iniciar sesión. */
function safeReturnPath(value: FormDataEntryValue | null): string {
  const path = typeof value === "string" ? value : "";
  return path.startsWith("/") && !path.startsWith("//") ? path : "/eventos";
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Escribe tu correo y tu contraseña.", email };

  const supabase = await createClient();
  if (!supabase) return { error: "La app aún no está conectada a Supabase.", email };

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const wrong = error.message.toLowerCase().includes("invalid");
    return {
      error: wrong ? "Correo o contraseña incorrectos." : "No pudimos iniciar tu sesión. Intenta de nuevo en un momento.",
      email,
    };
  }
  redirect(safeReturnPath(formData.get("volver")));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase?.auth.signOut();
  redirect("/ingresar");
}
