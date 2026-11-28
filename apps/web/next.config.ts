import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los audios de WhatsApp viajan a una acción del servidor (decisión 88): hasta 4 MB, el tope de Vercel es ~4,5 MB.
  experimental: {
    serverActions: { bodySizeLimit: "4.5mb" },
  },
  // Cache Components queda apagado en la Fase 0: todas las pantallas dependen de la sesión
  // y se generan en cada pedido. Se puede activar más adelante, pantalla por pantalla.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
