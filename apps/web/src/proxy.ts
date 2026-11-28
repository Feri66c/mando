import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

const PUBLIC_PATHS = ["/ingresar"];

/** Refresca la sesión de Supabase en cada pedido y manda a /ingresar a quien no inició sesión. */
export async function proxy(request: NextRequest) {
  const config = getSupabaseConfig();
  if (!config) return NextResponse.next(); // sin configurar: las pantallas muestran el aviso

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/ingresar";
    url.search = path === "/" ? "" : `?volver=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  }
  if (signedIn && path === "/ingresar") {
    // getClaims solo revisa la firma del token, que sigue valiendo hasta una hora aunque la cuenta
    // se haya bloqueado o su sesión se haya cerrado. Las pantallas sí preguntan al servidor (getUser)
    // y mandan aquí; si aquí se volviera a mandar a /eventos, el navegador entraría en un bucle
    // (ERR_TOO_MANY_REDIRECTS). Así que antes de mandarlo adentro, se confirma con el servidor
    // y, si la sesión ya no vale, se borra y se muestra el ingreso.
    const { data: check, error } = await supabase.auth.getUser();
    if (error || !check.user) {
      await supabase.auth.signOut({ scope: "local" });
      return response;
    }
    const url = request.nextUrl.clone();
    url.pathname = "/eventos";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|brand/|icono-|icon.svg|apple-icon.png|manifest.webmanifest|favicon.ico).*)"],
};
