// Expediente y locación en el navegador del teléfono. Corre después de la operación y antes del cierre.
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

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

test("expediente: el productor sube un contrato, marca lo que no aplica y deja un responsable con su recordatorio", async ({ browser }) => {
  const producer = await login(browser, "productor@mando.test");
  await producer.goto(`/eventos/${EVENT}/mas`);
  await producer.getByRole("link", { name: /Expediente/ }).click();
  await expect(producer.getByText("0 de 8 listos")).toBeVisible();

  // Sube un archivo: se guarda en el cubo privado con su huella y queda el enlace para verlo.
  await producer.getByLabel("Archivo para Contratos con proveedores").setInputFiles({
    name: "contrato-sonido.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 contrato de prueba"),
  });
  const contract = producer.getByRole("listitem").filter({ hasText: "Contratos con proveedores" });
  await expect(contract).toContainText("Subido");
  await expect(contract.getByRole("link", { name: "contrato-sonido.pdf" })).toBeVisible();
  await expect(producer.getByText("1 de 8 listos")).toBeVisible();

  // Un dato que no es archivo también cuenta.
  await producer.getByRole("button", { name: "Escribir el dato: Plano de la locación" }).click();
  await producer.getByLabel("Dato de «Plano de la locación»").fill("Lo trae el venue el día del montaje.");
  await producer.getByRole("button", { name: "Guardar dato" }).click();
  await expect(producer.getByText("2 de 8 listos")).toBeVisible();

  // Lo que este evento no necesita sale de la cuenta; un no negociable pide la razón.
  await producer.getByRole("button", { name: "No aplica: Informe de eventualidades con fotos" }).click();
  await expect(producer.getByText("2 de 7 listos")).toBeVisible();
  await producer.getByRole("button", { name: "No aplica: Carta o autorización de la locación" }).click();
  await producer.getByLabel("¿Por qué no aplica en este evento?").fill("El local es del cliente.");
  await producer.getByRole("button", { name: "Confirmar que no aplica" }).click();
  await expect(producer.getByText("2 de 6 listos")).toBeVisible();

  // Responsable: aparece el recordatorio listo para WhatsApp.
  const sctr = producer.getByRole("listitem").filter({ hasText: "SCTR o seguro de vida del equipo" });
  await sctr.getByText("Responsable y plazo").click();
  await sctr.getByLabel("Quién sube SCTR o seguro de vida del equipo").selectOption({ index: 1 });
  await sctr.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(sctr).toContainText(/A cargo de /);
  const wa = await sctr.getByRole("link", { name: "Recordar por WhatsApp: SCTR o seguro de vida del equipo" }).getAttribute("href");
  expect(decodeURIComponent(wa!)).toContain("falta subir «SCTR o seguro de vida del equipo» de Convención anual · Lima");
  expect(decodeURIComponent(wa!)).toContain("Recuerda que es un requisito no negociable.");
  await shot(producer, "expediente");
  await producer.context().close();
});

test("locación: el productor carga punto de encuentro, transporte y antecedentes; el equipo lo ve", async ({ browser }) => {
  const producer = await login(browser, "productor@mando.test");
  await producer.goto(`/eventos/${EVENT}/locacion`);
  await expect(producer.getByText("Todavía no hay datos de la locación.")).toBeVisible();
  await producer.getByLabel("Punto de encuentro").fill("Puerta 3, frente al estacionamiento");
  await producer.getByLabel("Enlace del mapa").fill("https://maps.app.goo.gl/mando-demo");
  await producer.getByLabel("Quién coordina").fill("Tatiana Ríos");
  await producer.getByLabel("Su teléfono").fill("+51 999 888 777");
  await producer.getByLabel("Placa del transporte").fill("abc-123");
  await producer.getByLabel("Antecedente 1").fill("No hay cajas de luz cerca del punto");
  await producer.getByLabel("Antecedente 2").fill("El colegio de al lado prohíbe sonido antes de las 3 p. m.");
  await producer.getByLabel("Zonas killer").fill("La esquina con la avenida: nadie se detiene.");
  await producer.getByRole("button", { name: "Guardar locación" }).click();
  await expect(producer.getByText("Locación guardada. Ya la ve todo el equipo.")).toBeVisible();
  await shot(producer, "locacion");
  await producer.context().close();

  const backend = await login(browser, "torre@mando.test");
  await backend.goto(`/eventos/${EVENT}/locacion`);
  await expect(backend.getByText("Puerta 3, frente al estacionamiento")).toBeVisible();
  await expect(backend.getByText("Tatiana Ríos · +51999888777")).toBeVisible();
  await expect(backend.getByText("ABC-123")).toBeVisible();
  await expect(backend.getByRole("list", { name: "Antecedentes del lugar" }).getByRole("listitem")).toHaveCount(2);
  await expect(backend.getByRole("link", { name: "Abrir el mapa" })).toHaveAttribute("href", "https://maps.app.goo.gl/mando-demo");
  await backend.context().close();
});

test("el cliente no entra al expediente ni a la locación", async ({ browser }) => {
  const viewer = await login(browser, "cliente@mando.test");
  for (const path of ["expediente", "locacion", "citados"]) {
    const response = await viewer.goto(`/eventos/${EVENT}/${path}`);
    expect(response?.status()).toBe(404);
  }
  await viewer.goto(`/eventos/${EVENT}/mas`);
  await expect(viewer.getByRole("link", { name: /Expediente/ })).toHaveCount(0);
  await viewer.context().close();
});
