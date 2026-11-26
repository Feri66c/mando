// Planificación en el navegador del teléfono: los 5 elementos desbloquean el timeline de un evento nuevo,
// y la persona registrada queda en la base para el siguiente evento.
import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SCREENSHOTS;
const SEED_EVENT = "00000000-0000-0000-0000-0000000000e1";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test.describe.configure({ mode: "serial" });
test.skip(!PASSWORD, "Define E2E_PASSWORD (y un Supabase con el seed) para correr estas pruebas.");

async function login(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ locale: "es-PE", timezoneId: "America/Lima" });
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

const person = `Lucía Paredes ${Date.now()}`;
const dni = String(Date.now()).slice(-8);

test("un evento nuevo nace con el timeline bloqueado y se abre al completar los 5 elementos", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await login(browser, "torre@mando.test");
  await page.goto("/panel/nuevo");
  await page.getByRole("radio", { name: /Sampling/ }).check();
  await page.getByLabel("Nombre del evento").fill(`Planificación de prueba ${Date.now()}`);
  await page.getByRole("textbox", { name: "Cliente" }).fill("Sodimac");
  await page.getByLabel("Fecha", { exact: true }).fill("2027-04-10");
  await page.getByLabel("Hora", { exact: true }).fill("10:00");
  await page.getByRole("button", { name: "Crear evento y armar el equipo" }).click();
  await expect(page).toHaveURL(/\/panel\/[0-9a-f-]{36}/);
  const base = `/eventos/${page.url().split("/panel/")[1].slice(0, 36)}`;

  // Bloqueado: «Hoy» lo avisa y la hoja de ruta no se abre.
  await page.goto(base);
  await expect(page.getByText("Planificación: 0 de 5. El timeline sigue bloqueado")).toBeVisible();
  await page.goto(`${base}/hoja-de-ruta`);
  await expect(page.getByText("Timeline bloqueado")).toBeVisible();
  await page.getByRole("link", { name: "Ir a la planificación" }).click();
  await expect(page.getByRole("list", { name: "Elementos de la planificación" }).getByRole("listitem")).toHaveCount(5);
  await shot(page, "planificacion-bloqueada");

  // 2 · Personal: se registra con foto y DNI, y queda sumada al evento.
  await page.getByRole("link", { name: /^Personal: pendiente/ }).click();
  await page.getByLabel("Nombre completo").fill(person);
  await page.getByLabel("Qué hace").fill("Anfitriona");
  await page.getByLabel("DNI", { exact: true }).fill(dni);
  await page.getByLabel("Vence el").fill("2031-05-01");
  await page.getByLabel("Foto (basta una del celular)").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: PNG });
  await page.getByLabel("Copia del DNI").setInputFiles({ name: "dni.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Registrar y sumar al evento" }).click();
  const crew = page.getByRole("list", { name: "Personal del evento" });
  await expect(crew.getByText(person, { exact: true })).toBeVisible();
  await expect(crew).toContainText("DNI vigente");
  await shot(page, "personal");

  // 3 · Técnico: se confirma el obligatorio con su detalle.
  await page.goto(`${base}/tecnico`);
  await expect(page.getByText("0 de 1 obligatorios")).toBeVisible();
  await page.getByLabel("Detalle de Módulo o stand armado").fill("3 × 2 m, con contrapesos");
  await page.getByRole("button", { name: "Confirmar: Módulo o stand armado" }).click();
  await expect(page.getByText("1 de 1 obligatorios")).toBeVisible();
  await expect(page.getByText(/hasta 24 h antes/).first()).toBeVisible();
  await shot(page, "tecnico");

  // 4 · Presupuesto: monto global, una partida bajo el mercado y la aprobación del cliente.
  await page.goto(`${base}/presupuesto`);
  await page.getByLabel("Monto global (S/)").fill("9000");
  await page.getByRole("button", { name: "Cargar presupuesto" }).click();
  await expect(page.getByText("S/ 9,000.00").first()).toBeVisible();
  await page.getByLabel("Partida").fill("Transporte del equipo");
  await page.getByLabel("Comparar con").selectOption("viaje-urbano");
  await page.getByLabel("Cantidad").fill("15");
  await page.getByLabel("Costo de cada uno (S/)").fill("10");
  await page.getByRole("button", { name: "Agregar partida" }).click();
  await expect(page.getByRole("list", { name: "Avisos del presupuesto" })).toContainText("Por debajo del mercado");
  await expect(page.getByRole("list", { name: "Avisos del presupuesto" })).toContainText("15 × S/ 10.00 por viaje");
  await shot(page, "presupuesto");
  await page.getByRole("button", { name: "Registrar aprobación del cliente" }).click();
  await page.getByLabel("¿Cómo te dio el cliente su aprobación?").fill("Por correo, con la orden de compra.");
  await page.getByRole("button", { name: "Registrar aprobación" }).click();
  await expect(page.getByText("✓ Aprobado por el cliente")).toBeVisible();

  // 5 · Aprobaciones: este brief no pide casting ni uniforme.
  await page.goto(`${base}/aprobaciones`);
  for (const group of [/Casting/, /Uniforme/, /Utilería/]) await page.getByRole("checkbox", { name: group }).uncheck();
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Este evento todavía no pide aprobaciones.")).toBeVisible();

  // 1 · Legal: los no negociables del expediente.
  await page.goto(`${base}/expediente`);
  for (const doc of ["SCTR o seguro de vida del equipo", "EPP: equipos de protección personal", "Permiso municipal", "Carta o autorización de la locación"]) {
    await page.getByRole("button", { name: `No aplica: ${doc}` }).click();
    await page.getByLabel("¿Por qué no aplica en este evento?").fill("Prueba: lo cubre el cliente.");
    await page.getByRole("button", { name: "Confirmar que no aplica" }).click();
    await expect(page.getByRole("button", { name: `Volver a pendiente: ${doc}` })).toBeVisible();
  }

  // Desbloqueado.
  await page.goto(`${base}/planificacion`);
  await expect(page.getByText("5 de 5")).toBeVisible();
  await shot(page, "planificacion-completa");
  await page.getByRole("link", { name: /El timeline está desbloqueado/ }).click();
  await expect(page.getByRole("list", { name: "Actividades" })).toBeVisible();
  await page.context().close();
});

test("en el siguiente evento la persona ya está en la base: se elige con un check", async ({ browser }) => {
  const page = await login(browser, "productor@mando.test");
  await page.goto(`/eventos/${SEED_EVENT}/personal`);
  const base = page.getByRole("list", { name: "Base de personas" });
  await expect(base.getByText(person, { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: `${person} va a este evento` }).click();
  await expect(page.getByRole("list", { name: "Personal del evento" }).getByText(person, { exact: true })).toBeVisible();
  await expect(page.getByText("1 en el evento")).toBeVisible();

  // El cliente no entra al personal ni a la lista técnica.
  const client = await login(browser, "cliente@mando.test");
  for (const path of ["personal", "tecnico"]) {
    const response = await client.goto(`/eventos/${SEED_EVENT}/${path}`);
    expect(response?.status()).toBe(404);
  }
  await page.context().close();
  await client.context().close();
});
