// Tiempos del timeline en el teléfono: la productora arrastra el control grande y MANDO avisa lo que no cuadra.
import { expect, test } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SCREENSHOTS;
const SEED_EVENT = "00000000-0000-0000-0000-0000000000e1";

test.skip(!PASSWORD, "Define E2E_PASSWORD (y un Supabase con el seed) para correr estas pruebas.");

test("la productora estima más de lo que da el plan y MANDO lo avisa", async ({ page }) => {
  await page.goto("/ingresar");
  await page.getByRole("button", { name: "Entrar con contraseña" }).click();
  await expect(page.getByLabel("Contraseña")).toBeVisible();
  await page.getByLabel("Correo").fill("productor@mando.test");
  await page.getByLabel("Contraseña").fill(PASSWORD!);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/eventos$/);

  await page.goto(`/eventos/${SEED_EVENT}/hoja-de-ruta`);
  await page.getByRole("link", { name: "Ajustar tiempos" }).click();
  await expect(page.getByRole("heading", { name: "Tiempos", exact: true })).toBeVisible();

  const first = page.getByRole("list", { name: "Tiempos por actividad" }).getByRole("listitem").first();
  const dial = first.getByRole("slider");
  await dial.fill("14");
  await expect(first.locator("output")).toHaveText("8 h");
  await expect(first.getByText("Guardado")).toBeVisible();
  await expect(first.getByText("Tu estimación")).toBeVisible();
  await expect(page.getByRole("list", { name: "Avisos de MANDO" }).getByText(/8 h/).first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tiempos.png`, fullPage: true });

  // Al volver a entrar, la estimación sigue ahí.
  await page.reload();
  await expect(page.getByRole("list", { name: "Tiempos por actividad" }).getByRole("listitem").first().getByRole("slider")).toHaveValue("14");
});
