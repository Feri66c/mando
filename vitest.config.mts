import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Pruebas de unidad (sin base de datos ni credenciales): `npm test`.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["tests/unit/**/*.test.ts"] },
});
