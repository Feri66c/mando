import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { MODE_COOKIE } from "@/lib/modo";

export const metadata: Metadata = {
  title: { default: "MANDO · Event Control", template: "%s · MANDO" },
  description: "Control de eventos en vivo: hoja de ruta, criticidad y bitácora.",
  applicationName: "MANDO",
  appleWebApp: { capable: true, title: "MANDO", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#061428",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Modo de pantalla elegido por la persona (decisión 96): Neón, Sol o Sobrio.
  const saved = (await cookies()).get(MODE_COOKIE)?.value;
  const mode = saved === "sol" || saved === "sobrio" ? saved : "neon";
  return (
    <html lang="es-PE" data-modo={mode} suppressHydrationWarning>
      <body className="tema-operacion min-h-dvh antialiased">{children}</body>
    </html>
  );
}
