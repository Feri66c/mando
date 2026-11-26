import { defineConfig, devices } from "@playwright/test";

// Flujos por rol en el navegador: `npm run e2e`.
// Sin credenciales solo corre la prueba de la pantalla de ingreso.
// Con E2E_PASSWORD (y la app conectada a un Supabase con el seed) corre también el ingreso de los tres roles.
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: `http://localhost:${PORT}`, trace: "off", locale: "es-PE", timezoneId: "America/Lima" },
  projects: [{ name: "movil", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/ingresar`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
