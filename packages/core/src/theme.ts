// Colores y tipografías del tema oscuro de operación (PROMPT-MAESTRO §5), compartidos por la web y la app.
// La fuente de la marca es apps/web/src/app/tokens.css; estos valores son su copia para React Native.

export const brand = {
  navy950: "#061428",
  navy800: "#0a2342",
  navy600: "#16406e",
  gold500: "#c9a227",
  gold300: "#e4c65b",
  ice500: "#6fa3cc",
  ice300: "#a9cce8",
  ice100: "#e3eef7",
  ok: "#2e7d5b",
  critical: "#b3402e",
  record: "#e02424",
} as const;

/** Tema oscuro de operación: fondo navy-950, tarjetas un tono más claro, oro como único acento. */
export const dark = {
  background: brand.navy950,
  surface: "#0d2443",
  surfaceRaised: "#15325a",
  ink: "#f7f9fc",
  inkMuted: "#b9d3ea",
  line: "#1e3a5c",
  accent: brand.gold500,
  accentInk: brand.navy950,
  ok: "#3fa37a",
  critical: "#e0644f",
  record: brand.record,
} as const;

export const radius = { card: 22, pill: 999, chip: 999 } as const;
export const tapMin = 44;

export const fonts = {
  display: "SpaceGrotesk_600SemiBold",
  displayBold: "SpaceGrotesk_700Bold",
  body: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodySemi: "Inter_600SemiBold",
  mono: "IBMPlexMono_500Medium",
} as const;
