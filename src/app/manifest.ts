import type { MetadataRoute } from "next";

// PWA básica: se puede instalar en el teléfono desde el navegador.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MANDO · Event Control",
    short_name: "MANDO",
    description: "Control de eventos en vivo: hoja de ruta, criticidad y bitácora.",
    lang: "es-PE",
    start_url: "/eventos",
    display: "standalone",
    background_color: "#061428",
    theme_color: "#061428",
    icons: [
      { src: "/icono-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icono-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icono-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
