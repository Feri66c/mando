import { expect, test, type APIRequestContext } from "@playwright/test";

// Recorrido completo de la invitación (decisiones 17 a 19):
// el productor general crea un sampling, invita a una persona nueva, ella entra con su código,
// ve la bienvenida, toma el mando y cae en el evento.
// Requiere el Supabase local con el seed y su buzón de prueba (Mailpit).
const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SCREENSHOTS;
const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";

async function latestCode(request: APIRequestContext, to: string): Promise<string> {
  let code = "";
  await expect(async () => {
    const list = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
    const id = list.messages?.[0]?.ID;
    expect(id).toBeTruthy();
    const msg = await (await request.get(`${MAILPIT}/api/v1/message/${id}`)).json();
    code = String(msg.HTML ?? msg.Text).replace(/<[^>]+>/g, " ").match(/\b(\d{6})\b/)?.[1] ?? "";
    expect(code).toMatch(/^\d{6}$/);
  }).toPass({ timeout: 15_000 });
  return code;
}

test.describe("invitación a un evento nuevo", () => {
  test.skip(!PASSWORD, "Define E2E_PASSWORD para correr estas pruebas.");

  test("el productor general crea un sampling, invita y la persona toma el mando", async ({ page, request, browser }) => {
    test.setTimeout(90_000);
    test.skip(!(await request.get(`${MAILPIT}/api/v1/messages`).then((r) => r.ok()).catch(() => false)), "Sin Mailpit local.");

    const stamp = Date.now();
    const eventName = `Sampling de prueba ${stamp}`;
    const guest = `tati.${stamp}@mando.test`;

    // 1. El productor general entra y crea el evento desde su panel.
    await page.goto("/ingresar");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/a-ingreso.png`, fullPage: true });
    await page.getByRole("button", { name: "Entrar con contraseña" }).click();
    await expect(page.getByLabel("Contraseña")).toBeVisible();
    await page.getByLabel("Correo").fill("torre@mando.test");
    await page.getByLabel("Contraseña").fill(PASSWORD!);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/eventos$/);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/b-mis-eventos.png`, fullPage: true });

    await page.getByRole("link", { name: /Ir al panel/ }).click();
    await expect(page.getByRole("heading", { name: "Tú repartes el mando." })).toBeVisible();
    await page.goto("/panel/nuevo");
    await page.getByRole("radio", { name: /Sampling/ }).check();
    await expect(page.getByText(/Sampling · 5 piezas/)).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/c-panel-nuevo.png`, fullPage: true });
    await page.getByLabel("Nombre del evento").fill(eventName);
    await page.getByRole("textbox", { name: "Cliente" }).fill("Sodimac");
    await page.getByLabel("Fecha", { exact: true }).fill("2027-03-14");
    await page.getByLabel("Hora", { exact: true }).fill("10:00");
    await page.getByRole("button", { name: "Crear evento y armar el equipo" }).click();

    await expect(page).toHaveURL(/\/panel\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name: eventName })).toBeVisible();
    for (const piece of ["Convocatoria", "Brief", "Distribución", "Experiencia", "Cierre"]) {
      await expect(page.getByRole("listitem").filter({ hasText: piece }).first()).toBeVisible();
    }

    // 2. Invita a una persona que todavía no tiene cuenta.
    await page.getByLabel("Nombre", { exact: true }).fill("Tatiana Ríos");
    await page.getByLabel("Correo").fill(guest);
    const cargo = page.getByLabel("Cargo", { exact: true });
    const option = await cargo.locator("option", { hasText: "Productor de campo" }).first().getAttribute("value");
    await cargo.selectOption(option!);
    await page.getByRole("button", { name: "Dar el mando" }).click();
    const pending = page.getByRole("list", { name: "Invitaciones pendientes" });
    await expect(pending.getByText("Tatiana Ríos")).toBeVisible();
    await expect(pending.getByText(guest)).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/d-panel-equipo.png`, fullPage: true });

    // 3. La invitada entra en otro teléfono, con el código que le llega.
    const phone = await browser.newContext({ locale: "es-PE", timezoneId: "America/Lima" });
    const guestPage = await phone.newPage();
    await guestPage.goto(`/ingresar?correo=${encodeURIComponent(guest)}`);
    await expect(guestPage.getByLabel("Correo")).toHaveValue(guest);
    await guestPage.getByRole("button", { name: "Mándame un código" }).click();
    await expect(guestPage.getByText(`Te mandamos un código de 6 dígitos a ${guest}.`)).toBeVisible();
    await guestPage.getByLabel("Código").fill(await latestCode(request, guest));
    await guestPage.getByRole("button", { name: "Entrar", exact: true }).click();

    // 4. Bienvenida: gracias, mandatorios, reto y el reloj que arranca.
    await expect(guestPage).toHaveURL(/\/bienvenida\//);
    await expect(guestPage.getByRole("heading", { name: "Gracias, Tatiana, por sumarte a MANDO." })).toBeVisible();
    await expect(guestPage.getByText(eventName)).toBeVisible();
    if (SHOTS) await guestPage.waitForTimeout(800);
    if (SHOTS) await guestPage.screenshot({ path: `${SHOTS}/e-bienvenida.png`, fullPage: true });
    await guestPage.getByRole("button", { name: "Continuar" }).click();
    await expect(guestPage.getByRole("heading", { name: "Esto no se negocia." })).toBeVisible();
    await expect(guestPage.getByText("El cliente mira minuto a minuto")).toBeVisible();
    if (SHOTS) await guestPage.waitForTimeout(800);
    if (SHOTS) await guestPage.screenshot({ path: `${SHOTS}/f-mandatorios.png`, fullPage: true });
    await guestPage.getByRole("button", { name: "Entendido" }).click();
    if (SHOTS) await guestPage.waitForTimeout(800);
    if (SHOTS) await guestPage.screenshot({ path: `${SHOTS}/g-reto.png`, fullPage: true });
    await guestPage.getByRole("button", { name: "Tomar el mando" }).click();
    await expect(guestPage.getByRole("heading", { name: "Se inició la acción." })).toBeVisible({ timeout: 10_000 });

    // 5. Cae en el evento con su cargo, y el panel la muestra con el mando activo.
    await expect(guestPage).toHaveURL(/\/eventos\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(guestPage.getByText(/Hola, Tatiana · Productor de campo/)).toBeVisible();
    await phone.close();

    await page.reload();
    await expect(page.getByRole("list", { name: "Equipo" }).getByText("Tatiana Ríos")).toBeVisible();
  });
});
