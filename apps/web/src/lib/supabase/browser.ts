"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

let client: SupabaseClient | null = null;

/**
 * Cliente de Supabase en el navegador, con la sesión del usuario (cookies).
 * Se usa solo para lo que el servidor no puede hacer por el teléfono: escuchar el tiempo real
 * y subir archivos directo al cubo privado. Todo pasa por la seguridad por fila.
 */
export function getBrowserClient(): SupabaseClient | null {
  if (client) return client;
  const config = getSupabaseConfig();
  if (!config) return null;
  client = createBrowserClient(config.url, config.key);
  return client;
}
