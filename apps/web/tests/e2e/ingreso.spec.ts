import { expect, test } from "@playwright/test";

test("sin sesión, Mis eventos manda a la pantalla de ingreso", async ({ page }) => {
  await page.goto("/eventos");
  await expect(page).toHaveURL(/\/ingresar/);
  await expect(page.getByRole("heading", { name: "Identifícate." })).toBeVisible();
});

const PASSWORD = process.env.E2E_PASSWORD;

const USERS = [
  { email: "productor@mando.test", role: "Productor", sees: 5 },
  { email: "torre@mando.test", role: "Torre de control", sees: 5 },
  { email: "cliente@mando.test", role: "Cliente", sees: 5 },
];

test.describe("ingreso de los tres roles (requiere Supabase con el seed)", () => {
  test.skip(!PASSWORD, "Define E2E_PASSWORD para correr estas pruebas.");

  for (const user of USERS) {
    test(`${user.role} ve solo el evento de ejemplo con su rol`, async ({ page }) => {
      await page.goto("/ingresar");
      await page.getByRole("button", { name: "Entrar con contraseña" }).click();
      await page.getByLabel("Correo").fill(user.email);
      await page.getByLabel("Contraseña").fill(PASSWORD!);
      await page.getByRole("button", { name: "Entrar", exact: true }).click();

      await expect(page).toHaveURL(/\/eventos$/);
      await expect(page.getByRole("heading", { name: "Mis eventos" })).toBeVisible();
      const cards = page.getByRole("listitem");
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toContainText("Convención anual · Lima");
      await expect(cards.first()).toContainText(user.role);

      await cards.first().getByRole("link").click();
      await expect(page.getByText("Ahora", { exact: true })).toBeVisible();
      await page.getByRole("navigation", { name: "Secciones del evento" }).getByRole("link", { name: "Hoja de ruta" }).click();
      await expect(page.getByRole("heading", { name: "Hoja de ruta" })).toBeVisible();
      await expect(page.getByRole("list", { name: "Actividades" }).getByRole("listitem")).toHaveCount(user.sees);
      await expect(page.getByText("Prueba de sonido")).toBeVisible();

      await page.goto("/eventos");
      await page.getByRole("button", { name: "Salir" }).click();
      await expect(page).toHaveURL(/\/ingresar/);
    });
  }

  test("contraseña equivocada muestra el error en español", async ({ page }) => {
    await page.goto("/ingresar");
    await page.getByRole("button", { name: "Entrar con contraseña" }).click();
    await page.getByLabel("Correo").fill("cliente@mando.test");
    await page.getByLabel("Contraseña").fill("incorrecta");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByText("Correo o contraseña incorrectos.")).toBeVisible();
  });

  // Ingreso con código: lee el correo en Mailpit, el buzón de prueba de la CLI de Supabase (http://127.0.0.1:54324).
  test("entra con el código de 6 dígitos que llega al correo", async ({ page, request }) => {
    const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";
    test.skip(!(await request.get(`${MAILPIT}/api/v1/messages`).then((r) => r.ok()).catch(() => false)), "Sin Mailpit local.");
    await request.delete(`${MAILPIT}/api/v1/messages`);

    await page.goto("/ingresar");
    await page.getByLabel("Correo").fill("productor@mando.test");
    await page.getByRole("button", { name: "Mándame un código" }).click();
    await expect(page.getByText("Te mandamos un código de 6 dígitos a productor@mando.test.")).toBeVisible();

    let code = "";
    await expect(async () => {
      const list = await (await request.get(`${MAILPIT}/api/v1/messages`)).json();
      const id = list.messages?.[0]?.ID;
      expect(id).toBeTruthy();
      const msg = await (await request.get(`${MAILPIT}/api/v1/message/${id}`)).json();
      // Sin etiquetas: los colores del estilo (#061428) también tienen 6 dígitos.
      code = String(msg.HTML ?? msg.Text).replace(/<[^>]+>/g, " ").match(/\b(\d{6})\b/)?.[1] ?? "";
      expect(code).toMatch(/^\d{6}$/);
    }).toPass({ timeout: 15_000 });

    await page.getByLabel("Código").fill(code);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/eventos$/);
    await expect(page.getByRole("heading", { name: "Mis eventos" })).toBeVisible();
  });

  test("un correo sin invitación no recibe código", async ({ page }) => {
    await page.goto("/ingresar");
    await page.getByLabel("Correo").fill("nadie@ejemplo.com");
    await page.getByRole("button", { name: "Mándame un código" }).click();
    await expect(page.getByText(/No encontramos una invitación/)).toBeVisible();
  });
});
