// Méritos, citados y cierre en el navegador del teléfono. El archivo empieza con «z» porque corre al final:
// termina cerrando el evento de ejemplo, y un evento cerrado ya no acepta cambios.
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

test("citados: el productor cita a una host, le prepara el recordatorio y marca su llegada", async ({ browser }) => {
  const producer = await login(browser, "productor@mando.test");
  await producer.goto(`/eventos/${EVENT}/mas`);
  await producer.getByRole("link", { name: /Citados/ }).click();
  await expect(producer.getByText("Todavía no hay nadie citado.")).toBeVisible();

  await producer.getByLabel("Nombre").fill("Carla Vega");
  await producer.getByLabel("Viene como").selectOption("Host");
  await producer.getByLabel("Hora de citación").fill("09:30");
  await producer.getByLabel(/WhatsApp/).fill("+51 999 888 777");
  await producer.getByRole("button", { name: "Citar", exact: true }).click();

  const row = producer.getByRole("list", { name: "Citados" }).getByRole("listitem").filter({ hasText: "Carla Vega" });
  await expect(row).toContainText("09:30");
  await expect(row).toContainText("Sin recordatorio todavía.");
  const wa = await row.getByRole("link", { name: "Recordar por WhatsApp a Carla Vega" }).getAttribute("href");
  expect(wa).toContain("https://wa.me/51999888777?text=Hola%2C%20Carla.");
  expect(decodeURIComponent(wa!)).toContain("a las 09:30");

  await row.getByRole("button", { name: "Llegó: Carla Vega" }).click();
  await expect(row).toContainText(/Llegó/);
  await expect(producer.getByText("1 de 1 llegaron")).toBeVisible();
  await shot(producer, "citados");
  await producer.context().close();
});

test("un no negociable fallado deja el evento sin estrellas y el cliente lo ve en vivo", async ({ browser }) => {
  const viewer = await login(browser, "cliente@mando.test");
  await viewer.goto(`/eventos/${EVENT}/cierre`);
  await expect(viewer.getByText("En línea")).toBeVisible({ timeout: 15_000 });
  await expect(viewer.getByRole("heading", { name: "Estrellas y cierre" })).toBeVisible();
  await expect(viewer.getByRole("list", { name: "No negociables" }).getByRole("listitem")).toHaveCount(3);
  await expect(viewer.getByRole("button", { name: /Cumplido/ })).toHaveCount(0); // el cliente solo mira

  const producer = await login(browser, "productor@mando.test");
  await producer.goto(`/eventos/${EVENT}/cierre`);
  await producer.getByRole("button", { name: "Cumplido: Capacidad del local respetada" }).click();
  await producer.getByRole("button", { name: "Falló: Energía de respaldo para sonido y luces" }).click();
  await producer.getByLabel(/¿Qué pasó con/).fill("El grupo electrógeno no llegó.");
  await producer.getByRole("button", { name: "Confirmar que falló" }).click();
  await expect(producer.getByText("Red Flag · sin estrellas")).toBeVisible();

  await expect(viewer.getByText("Red Flag · sin estrellas")).toBeVisible({ timeout: 5_000 });
  await expect(viewer.getByRole("img", { name: "0 de 5 estrellas" })).toBeVisible();
  await expect(viewer.getByText("El grupo electrógeno no llegó.")).toBeVisible();
  await shot(viewer, "cierre-sin-estrellas");
  await viewer.goto(`/eventos/${EVENT}/alertas`);
  await expect(viewer.getByText("No negociable fallado: Energía de respaldo para sonido y luces")).toBeVisible();

  await producer.getByRole("radio", { name: "4 estrellas" }).check({ force: true });
  await producer.getByRole("button", { name: "Enviar mi valoración" }).click();
  await expect(producer.getByText("Gracias. Tu valoración quedó guardada.")).toBeVisible();
  await producer.context().close();
  await viewer.context().close();
});

test("el productor general corrige, registra el enlace de publicación y cierra el evento", async ({ browser }) => {
  const backend = await login(browser, "torre@mando.test");
  await backend.goto(`/eventos/${EVENT}/cierre`);
  await expect(backend.getByText(/primero marca el no negociable que falta/)).toBeVisible();
  await backend.getByRole("button", { name: "Cumplido: Energía de respaldo para sonido y luces" }).click();
  await expect(backend.getByText("Red Flag · sin estrellas")).toHaveCount(0);
  await backend.getByRole("button", { name: "Cumplido: Hora de apertura de puertas" }).click();
  await backend.getByRole("button", { name: "Logrado: Entrada del show en el segundo exacto", exact: true }).click();

  await backend.getByLabel("Enlace de publicación").fill("https://youtu.be/mando-demo");
  await backend.getByRole("button", { name: "Guardar enlace" }).click();
  await expect(backend.getByRole("link", { name: "https://youtu.be/mando-demo" })).toBeVisible();

  await backend.getByRole("checkbox").check();
  await backend.getByRole("button", { name: "Cerrar el evento" }).click();
  await expect(backend.getByRole("heading", { name: "Informe de cierre" })).toBeVisible();
  await expect(backend.getByRole("button", { name: /Cumplido/ })).toHaveCount(0);
  await shot(backend, "informe-de-cierre");
  await backend.context().close();

  const viewer = await login(browser, "cliente@mando.test");
  await viewer.goto(`/eventos/${EVENT}/cierre`);
  await expect(viewer.getByRole("heading", { name: "Informe de cierre" })).toBeVisible();
  await expect(viewer.getByRole("link", { name: "https://youtu.be/mando-demo" })).toBeVisible();
  await expect(viewer.getByText("Citados a su hora")).toBeVisible();
  await viewer.context().close();
});
