import { defineConfig } from "vitest/config";

// Pruebas de permisos contra PostgreSQL. Se lanzan con `npm run test:db`, que prepara la base.
export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
  },
});
