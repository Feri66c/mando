/** Lee la conexión a Supabase desde variables de entorno. Devuelve null si falta configurarla. */
export function getSupabaseConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Supabase entrega ahora una "publishable key"; los proyectos antiguos usan la "anon key". Aceptamos ambas.
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}
