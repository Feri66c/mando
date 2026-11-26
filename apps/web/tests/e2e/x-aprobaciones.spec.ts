// Aprobaciones del cliente en el navegador del teléfono. Corre después de la operación y antes del cierre.
import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SCREENSHOTS;
const EVENT = "00000000-0000-0000-0000-0000000000e1";
// PNG de 1 × 1 para las fotos de prueba.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

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

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

async function upload(page: Page, group: string, name: string, detail: string) {
  await page.getByText(`Subir a ${group}`).click();
  await page.getByLabel(`Foto para ${group}`).setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: PNG });
  await page.getByLabel(`Nombre en ${group}`).fill(name);
  await page.getByLabel(`Detalle en ${group}`).fill(detail);
  await page.getByRole("button", { name: "Subir para aprobación" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: name })).toContainText("Por aprobar");
  await page.getByText(`Subir a ${group}`).click();
}

test("aprobaciones: la productora sube casting y uniforme, el cliente aprueba y pide un cambio, y al reemplazar vuelve a estar por aprobar", async ({ browser }) => {
  const backend = await login(browser, "torre@mando.test");
  await backend.goto(`/eventos/${EVENT}/mas`);
  await backend.getByRole("link", { name: /Aprobaciones/ }).click();
  await expect(backend.getByText("Este evento todavía no pide aprobaciones.")).toBeVisible();

  // El productor general decide, según el brief, qué aprueba el cliente.
  await backend.getByLabel(/Casting/).check();
  await backend.getByLabel(/Uniforme/).check();
  await backend.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(backend.getByText("Todavía no se puede marcar el inicio")).toBeVisible();
  await expect(backend.getByText("Casting: falta subirlo")).toBeVisible();

  await upload(backend, "Casting", "Lucía Paredes", "Anfitriona principal, 1.72 m");
  await upload(backend, "Uniforme", "Polo azul con logo", "Con jean oscuro y zapatillas blancas");
  await expect(backend.getByText("Casting: 1 por aprobar")).toBeVisible();

  // El cliente lo ve en su teléfono sin recargar y decide.
  const client = await login(browser, "cliente@mando.test");
  await client.goto(`/eventos/${EVENT}`);
  await client.getByRole("link", { name: /Tienes elementos por aprobar/ }).click();
  await expect(client.getByRole("img", { name: "Foto de Lucía Paredes" })).toBeVisible();
  await expect(client.getByRole("button", { name: /Reemplazar/ })).toHaveCount(0);
  await client.getByRole("button", { name: "Aprobar: C-01 Lucía Paredes" }).click();
  await expect(client.getByRole("listitem").filter({ hasText: "Lucía Paredes" })).toContainText("Aprobado");
  await client.getByRole("button", { name: "Pedir cambio: U-01 Polo azul con logo" }).click();
  await client.getByLabel("¿Qué hay que cambiar?").fill("El logo va al lado izquierdo.");
  await client.getByRole("button", { name: "Enviar pedido de cambio" }).click();
  await expect(client.getByRole("listitem").filter({ hasText: "Polo azul" })).toContainText("Pide cambio");
  await shot(client, "aprobaciones-cliente");

  // El equipo lo recibe en vivo, reemplaza la foto y el elemento vuelve a estar por aprobar.
  const uniform = backend.getByRole("listitem").filter({ hasText: "Polo azul" });
  await expect(uniform).toContainText("El logo va al lado izquierdo.");
  await shot(backend, "aprobaciones-equipo");
  await backend.getByLabel("Nueva foto para U-01 Polo azul con logo").setInputFiles({ name: "polo-v2.png", mimeType: "image/png", buffer: PNG });
  await expect(uniform).toContainText("Por aprobar");
  await expect(uniform).toContainText("versión 2");

  await client.getByRole("button", { name: "Aprobar: U-01 Polo azul con logo" }).click();
  await expect(client.getByText("Todo aprobado. El evento puede empezar.")).toBeVisible();
  await expect(backend.getByText("Todo aprobado. El evento puede empezar.")).toBeVisible();

  // Cada decisión queda en la bitácora.
  await client.goto(`/eventos/${EVENT}/bitacora`);
  await expect(client.getByText(/pidió un cambio en U-01 «Polo azul con logo»: El logo va al lado izquierdo\./)).toBeVisible();
  await backend.context().close();
  await client.context().close();
});
