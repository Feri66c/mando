// Aceptación de la Etapa 1 en el navegador del teléfono, contra un Supabase con el seed recién cargado.
// Corre con E2E_PASSWORD definido (ver README: `npx supabase db reset` antes, porque estas pruebas cambian datos).
import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SCREENSHOTS; // carpeta opcional para guardar capturas
const EVENT = "00000000-0000-0000-0000-0000000000e1";
const ITEM = {
  montaje: "00000000-0000-0000-0000-0000000000d1",
  sonido: "00000000-0000-0000-0000-0000000000d2",
  puertas: "00000000-0000-0000-0000-0000000000d3",
};
const MOMENT = "00000000-0000-0000-0000-0000000000f1";

test.describe.configure({ mode: "serial" });
test.skip(!PASSWORD, "Define E2E_PASSWORD (y un Supabase con el seed) para correr estas pruebas.");

async function login(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/ingresar");
  await page.getByRole("button", { name: "Entrar con contraseña" }).click();
  await expect(page.getByLabel("Contraseña")).toBeVisible(); // el formulario se reinicia al cambiar de paso
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(PASSWORD!);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/eventos$/);
  return page;
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function waitLive(page: Page) {
  await expect(page.getByText("En línea")).toBeVisible({ timeout: 15_000 });
}

test("el productor ve Hoy con el tema oscuro, la barra inferior y el botón +", async ({ browser }) => {
  const page = await login(browser, "productor@mando.test");
  await page.goto(`/eventos/${EVENT}`);
  await expect(page.getByText("Ahora", { exact: true })).toBeVisible();
  await expect(page.getByText("Sigue", { exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Secciones del evento" });
  for (const tab of ["Hoy", "Hoja de ruta", "Alertas", "Más"]) await expect(nav.getByRole("link", { name: tab })).toBeVisible();
  await waitLive(page); // la página ya está hidratada
  await page.getByRole("button", { name: /Crear: evidencia/ }).click();
  await expect(page.getByRole("menuitem", { name: /Evidencia/ })).toBeVisible();
  const bg = await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(6, 20, 40)"); // navy-950
  await waitLive(page);
  await shot(page, "1-productor-hoy");
});

test("aceptación 1: el productor alarga la prueba de sonido y el cliente lo ve sin recargar", async ({ browser }) => {
  const viewer = await login(browser, "cliente@mando.test");
  await viewer.goto(`/eventos/${EVENT}/hoja-de-ruta`);
  await waitLive(viewer);
  const row = viewer.getByRole("listitem").filter({ hasText: "Prueba de sonido" });
  await expect(row).toContainText("16:00");

  const producer = await login(browser, "productor@mando.test");
  await producer.goto(`/eventos/${EVENT}/actividad/${ITEM.sonido}`);
  await producer.getByRole("button", { name: "Ver cómo queda" }).click(); // por defecto: agregar 60 min
  await expect(producer.getByText("Así queda la hoja de ruta")).toBeVisible();
  await expect(producer.getByText("No arrastra otras actividades.")).toBeVisible();
  await shot(producer, "2-productor-vista-previa");
  await producer.getByRole("button", { name: "Confirmar cambio" }).click();
  const confirmedAt = Date.now();
  await expect(producer.getByText("Cambio aplicado")).toBeVisible();

  await expect(row).toContainText("17:00", { timeout: 5_000 });
  const elapsed = Date.now() - confirmedAt;
  console.log(`El cliente vio el cambio ${elapsed} ms después de confirmar.`);
  expect(elapsed).toBeLessThan(2_000 + 1_000); // 2 s de la aceptación + margen del propio navegador de prueba
  await shot(viewer, "3-cliente-hoja-de-ruta");

  await viewer.goto(`/eventos/${EVENT}`);
  await expect(viewer.getByText(/«Prueba de sonido»: 14:00 – 16:00 → 14:00 – 17:00/)).toBeVisible();
  // El cliente no tiene botones de operación.
  await expect(viewer.getByRole("button", { name: /Crear: evidencia/ })).toHaveCount(0);
  await expect(viewer.getByRole("link", { name: "Abrir Modo En Vivo" })).toHaveCount(0);
});

test("aceptación 2: Modo En Vivo marca Empezó y Terminó con un toque", async ({ browser }) => {
  const page = await login(browser, "productor@mando.test");
  await page.goto(`/eventos/${EVENT}/en-vivo`);
  await expect(page.getByText("Montaje de escenario").first()).toBeVisible();
  await shot(page, "4-en-vivo-antes");
  await page.getByRole("button", { name: "Empezó" }).click();
  await expect(page.getByRole("button", { name: "Terminó" })).toBeVisible();
  await expect(page.getByText(/Empezó a las \d\d:\d\d/)).toBeVisible();
  await shot(page, "5-en-vivo-en-curso");
  await page.getByRole("button", { name: "Terminó" }).click();
  await expect(page.getByRole("button", { name: "Terminó" })).toHaveCount(0);
  await page.goto(`/eventos/${EVENT}/bitacora`);
  await expect(page.getByText(/Empezó «Montaje de escenario» a las/)).toBeVisible();
  await expect(page.getByText(/Terminó «Montaje de escenario» a las/)).toBeVisible();
});

test("aceptación 3: 24 canales contra 32 levanta Crítico para el equipo y no para el cliente", async ({ browser }) => {
  const page = await login(browser, "productor@mando.test");
  await page.goto(`/eventos/${EVENT}/momentos/${MOMENT}`);
  await page.getByRole("button", { name: "Abrir ahora" }).click();
  await expect(page.getByText(/Abierto desde las/)).toBeVisible();

  const first = page.locator("form").filter({ hasText: "¿Qué sientes que no funciona bien?" });
  await first.getByRole("textbox").fill("La consola no tiene los canales del rider");
  await first.getByRole("button", { name: "Guardar respuesta" }).click();
  await expect(first.getByText("Respuesta guardada.")).toBeVisible();

  const consola = page.locator("div.rounded-card").filter({ hasText: "Prometido: 32 canales" });
  await consola.getByPlaceholder("Ej.: 24 canales").fill("24 canales");
  await consola.getByText("Incumplido").click();
  await consola.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText("Crítico").first()).toBeVisible();

  // Evidencia del momento: una foto.
  await page.getByTestId("evidence-file").setInputFiles({
    name: "consola.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "Guardar evidencia" }).click();
  await expect(page.getByText("Foto guardada con hora del servidor.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("img", { name: "Foto de evidencia" })).toBeVisible();
  await shot(page, "6-momento-critico");

  await page.goto(`/eventos/${EVENT}/alertas`);
  await expect(page.getByText("Consola no coincide con lo prometido")).toBeVisible();
  await expect(page.getByText("Prometido: 32 canales. Encontrado: 24 canales.")).toBeVisible();
  await shot(page, "7-alertas-equipo");

  const viewer = await login(browser, "cliente@mando.test");
  await viewer.goto(`/eventos/${EVENT}/alertas`);
  await expect(viewer.getByRole("heading", { name: "Alertas" })).toBeVisible();
  await expect(viewer.getByText("Consola no coincide con lo prometido")).toHaveCount(0);
  await viewer.goto(`/eventos/${EVENT}/momentos`);
  await expect(viewer).toHaveURL(new RegExp(`/eventos/${EVENT}$`)); // los momentos son internos
});

test("aceptación 4: mover un hito 30 minutos levanta una Red Flag que el cliente ve en vivo", async ({ browser }) => {
  const viewer = await login(browser, "cliente@mando.test");
  await viewer.goto(`/eventos/${EVENT}/alertas`);
  await waitLive(viewer);

  const producer = await login(browser, "productor@mando.test");
  await producer.goto(`/eventos/${EVENT}/actividad/${ITEM.puertas}`);
  await producer.getByText("Mover de hora").click();
  await producer.getByText("30 min", { exact: true }).click();
  await producer.getByRole("button", { name: "Ver cómo queda" }).click();
  await expect(producer.getByText("se arrastra").first()).toBeVisible();
  await producer.getByRole("button", { name: "Confirmar cambio" }).click();
  await expect(producer.getByText("Cambio aplicado")).toBeVisible();

  await expect(viewer.getByText("El hito «Apertura de puertas» se aleja del plan")).toBeVisible({ timeout: 5_000 });
  await expect(viewer.getByText("Red Flag").first()).toBeVisible();
  await shot(viewer, "8-cliente-red-flag");
});

test("aceptación 5: el cliente no puede operar aunque escriba la dirección", async ({ browser }) => {
  const viewer = await login(browser, "cliente@mando.test");
  await viewer.goto(`/eventos/${EVENT}/actividad/${ITEM.sonido}`);
  await expect(viewer).toHaveURL(/\/hoja-de-ruta$/);
  await viewer.goto(`/eventos/${EVENT}/evidencias`);
  await expect(viewer.getByRole("button", { name: "Guardar evidencia" })).toHaveCount(0);
  // La foto del momento crítico se guardó como interna: el cliente no la ve.
  await expect(viewer.getByRole("img", { name: "Foto de evidencia" })).toHaveCount(0);
});
