import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "./config";

/**
 * Cliente de Supabase para componentes de servidor y Server Actions.
 * Usa la sesión del usuario (cookies), así que toda consulta pasa por la seguridad por fila.
 */
export async function createClient() {
  // Leer las cookies primero hace que toda pantalla con sesión se genere en cada pedido,
  // aunque la app se haya compilado sin las claves de Supabase.
  const cookieStore = await cookies();
  const config = getSupabaseConfig();
  if (!config) return null;
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Llamado desde un Server Component: no puede escribir cookies. El proxy ya refrescó la sesión.
        }
      },
    },
  });
}
