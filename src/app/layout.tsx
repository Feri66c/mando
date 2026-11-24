import type { Metadata, Viewport } from "next";
import "./globals.css";

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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-PE">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
