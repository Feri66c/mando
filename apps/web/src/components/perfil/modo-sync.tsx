"use client";

import { useEffect } from "react";
import { MODE_COOKIE } from "@/lib/modo";

/** Aplica el modo guardado en el perfil cuando la cookie todavía no lo tiene (por ejemplo, en otro equipo). */
export function ModoSync({ mode }: { mode: "neon" | "sol" | "sobrio" }) {
  useEffect(() => {
    if (document.documentElement.dataset.modo !== mode) document.documentElement.dataset.modo = mode;
    if (!document.cookie.includes(`${MODE_COOKIE}=${mode}`)) {
      document.cookie = `${MODE_COOKIE}=${mode}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    }
  }, [mode]);
  return null;
}
