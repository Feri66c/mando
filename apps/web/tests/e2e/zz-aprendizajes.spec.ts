// Encuesta de cierre en el teléfono. Corre al final («zz»), con el evento de ejemplo ya cerrado:
// la productora deja sus aprendizajes, el cliente su ficha y el productor general lee ambas.
import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SCREENSHOTS;
const EVENT = "00000000-0000-0000-0000-0000000000e1";

test.describe.configure({ mode: "serial" });
test.skip(!PASSWORD, "Define E2E_PASSWORD (y un Supabase con el seed) para correr estas pruebas.");

async function login(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/ingresar");
  await page.getByRole("button", { name: "Entrar con contraseña" }).click();
  await expect(page.getByLabel("Contraseña")).toBeVisible();
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(PASSWORD!);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/eventos$/);
  return page;
}

test("el equipo deja sus aprendizajes, el cliente su ficha y el productor general lee ambas", async ({ browser }) => {
  const producer = await login(browser, "productor@mando.test");
  await producer.goto(`/eventos/${EVENT}/cierre`);
  await producer.getByRole("link", { name: "Dejar mis aprendizajes" }).click();
  await expect(producer.getByRole("heading", { name: /^Tus aprendizajes, / })).toBeVisible();
  await expect(producer.getByRole("textbox", { name: /^Aprendizaje \d$/ })).toHaveCount(6);
  await producer.getByLabel("Aprendizaje 1").fill("Citar al proveedor de energía una hora antes");
  await producer.getByLabel("Aprendizaje 2").fill("Probar el sonido con el local lleno");
  await producer.getByLabel("¿Algo más que agregar?").fill("El equipo respondió bien bajo presión.");
  await producer.getByRole("button", { name: /(Guardar|Actualizar) mis aprendizajes/ }).click();
  await expect(producer.getByText("Gracias. Tus aprendizajes quedaron guardados.")).toBeVisible();
  if (SHOTS) await producer.screenshot({ path: `${SHOTS}/aprendizajes.png`, fullPage: true });
  await producer.context().close();

  const viewer = await login(browser, "cliente@mando.test");
  await viewer.goto(`/eventos/${EVENT}/cierre`);
  await viewer.getByRole("link", { name: "Llenar mi ficha de satisfacción" }).click();
  await expect(viewer.getByRole("heading", { name: /^Tu impresión, / })).toBeVisible();
  await expect(viewer.getByText("Lo que aprendió el equipo")).toHaveCount(0);
  await viewer.getByRole("radio", { name: "4 de 5" }).check({ force: true });
  await viewer.getByLabel("¿Qué impresión te deja este evento?").fill("Todo salió a la hora.");
  await viewer.getByRole("button", { name: /(Enviar|Actualizar) mi ficha/ }).click();
  await expect(viewer.getByText("Gracias. Tu ficha quedó guardada.")).toBeVisible();
  if (SHOTS) await viewer.screenshot({ path: `${SHOTS}/ficha-cliente.png`, fullPage: true });
  await viewer.context().close();

  const backend = await login(browser, "torre@mando.test");
  await backend.goto(`/eventos/${EVENT}/aprendizajes`);
  await expect(backend.getByRole("list", { name: "Ficha del cliente" })).toContainText("4 de 5");
  await expect(backend.getByRole("list", { name: "Ficha del cliente" })).toContainText("Todo salió a la hora.");
  await expect(backend.getByRole("list", { name: "Aprendizajes del equipo" })).toContainText("Probar el sonido con el local lleno");
  if (SHOTS) await backend.screenshot({ path: `${SHOTS}/aprendizajes-productor-general.png`, fullPage: true });
  await backend.context().close();
});
