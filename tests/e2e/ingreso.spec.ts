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
      await page.getByLabel("Correo").fill(user.email);
      await page.getByLabel("Contraseña").fill(PASSWORD!);
      await page.getByRole("button", { name: "Entrar" }).click();

      await expect(page).toHaveURL(/\/eventos$/);
      await expect(page.getByRole("heading", { name: "Mis eventos" })).toBeVisible();
      const cards = page.getByRole("listitem");
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toContainText("Convención anual · Lima");
      await expect(cards.first()).toContainText(user.role);

      await cards.first().getByRole("link").click();
      await expect(page.getByRole("heading", { name: "Hoja de ruta" })).toBeVisible();
      await expect(page.getByRole("listitem")).toHaveCount(user.sees);
      await expect(page.getByText("Prueba de sonido")).toBeVisible();

      await page.getByRole("button", { name: "Salir" }).click();
      await expect(page).toHaveURL(/\/ingresar/);
    });
  }

  test("contraseña equivocada muestra el error en español", async ({ page }) => {
    await page.goto("/ingresar");
    await page.getByLabel("Correo").fill("cliente@mando.test");
    await page.getByLabel("Contraseña").fill("incorrecta");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("Correo o contraseña incorrectos.")).toBeVisible();
  });
});
