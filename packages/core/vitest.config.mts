import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Pruebas de la lógica común (sin base de datos ni credenciales).
export default defineConfig({
  resolve: { alias: { "@mando/core": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"] },
});
