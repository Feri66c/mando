import { describe, expect, it } from "vitest";
import { guestReminder, guestState, mailtoLink, whatsappLink } from "@mando/core/guests";

describe("citados: recordatorio y puntualidad", () => {
  it("el recordatorio saluda por el nombre y dice día, hora de Lima y lugar", () => {
    const text = guestReminder({
      name: "Carla Vega",
      eventName: "Podcast HUB51 · Episodio 12",
      callAt: "2026-12-06T15:00:00Z",
      timeZone: "America/Lima",
      venue: "Estudio Miraflores",
      sender: "Fernando",
    });
    expect(text).toContain("Hola, Carla. Te esperamos para Podcast HUB51 · Episodio 12 en Estudio Miraflores");
    expect(text).toContain("a las 10:00");
    expect(text.endsWith("Gracias. Fernando")).toBe(true);
  });

  it("el enlace de WhatsApp lleva solo los dígitos del teléfono, o ninguno si no hay", () => {
    expect(whatsappLink("Hola", "+51 999-888-777")).toBe("https://wa.me/51999888777?text=Hola");
    expect(whatsappLink("Hola & chau")).toBe("https://wa.me/?text=Hola%20%26%20chau");
    expect(mailtoLink("a@b.pe", "Recordatorio", "Hola")).toBe("mailto:a@b.pe?subject=Recordatorio&body=Hola");
  });

  it("dice si llegó a su hora, tarde, o si todavía falta", () => {
    const callAt = "2026-12-06T15:00:00Z";
    const at = (m: number) => new Date(new Date(callAt).getTime() + m * 60_000);
    expect(guestState({ callAt, arrivedAt: at(8).toISOString() }, at(60))).toEqual({ state: "arrived_on_time", delayMin: 8 });
    expect(guestState({ callAt, arrivedAt: at(25).toISOString() }, at(60))).toEqual({ state: "arrived_late", delayMin: 25 });
    expect(guestState({ callAt, arrivedAt: null }, at(-30))).toEqual({ state: "waiting", delayMin: -30 });
    expect(guestState({ callAt, arrivedAt: null }, at(15))).toEqual({ state: "late", delayMin: 15 });
  });
});
