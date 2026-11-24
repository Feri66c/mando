import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
