import { describe, expect, it } from "vitest";
import {
  EVENT_TEMPLATES,
  eventWindow,
  getTemplate,
  invitationMessage,
  planRoute,
  validateTemplate,
  welcomeMandatories,
} from "@mando/core/event-types";

describe("plantillas de tipos de evento (config/tipos-de-evento.json)", () => {
  it("trae los cinco tipos confirmados por Fer", () => {
    expect(EVENT_TEMPLATES.map((t) => t.clave)).toEqual([
      "sampling",
      "centro-comercial",
      "fiesta-corporativa",
      "feria",
      "concierto",
    ]);
  });

  it.each(EVENT_TEMPLATES.map((t) => [t.nombre, t] as const))("%s es una plantilla válida", (_name, template) => {
    expect(validateTemplate(template)).toEqual([]);
  });

  it("el sampling tiene sus 5 piezas: convocatoria, brief, distribución, experiencia y cierre", () => {
    expect(getTemplate("sampling")!.piezas.map((p) => p.titulo)).toEqual([
      "Convocatoria",
      "Brief",
      "Distribución",
      "Experiencia",
      "Cierre",
    ]);
  });

  it("una plantilla rota se rechaza con motivos claros", () => {
    const broken = { ...getTemplate("sampling")!, piezas: [], cargos: [] };
    expect(validateTemplate(broken)).toEqual([
      "No tiene piezas.",
      "Ninguna pieza empieza en la hora clave.",
      "Falta el cargo de productor general.",
      "Falta el cargo del cliente.",
    ]);
  });
});

describe("hoja de ruta inicial desde la plantilla", () => {
  const keyTime = new Date("2026-12-06T15:00:00Z"); // 10:00 en Lima

  it("pone cada pieza a su hora, contada desde la hora clave", () => {
    const plan = planRoute(getTemplate("sampling")!, keyTime);
    const dist = plan.find((p) => p.title === "Distribución")!;
    expect(dist).toMatchObject({ start: "2026-12-06T15:00:00.000Z", end: "2026-12-06T19:00:00.000Z", isMilestone: true });
    expect(plan[0]).toMatchObject({ title: "Convocatoria", start: "2026-12-04T15:00:00.000Z", visibleToViewer: false, sortOrder: 1 });
  });

  it("la ventana del evento va de la primera a la última pieza", () => {
    const plan = planRoute(getTemplate("sampling")!, keyTime);
    expect(eventWindow(plan)).toEqual({ start: "2026-12-04T15:00:00.000Z", end: "2026-12-06T20:30:00.000Z" });
  });
});

describe("bienvenida e invitación", () => {
  it("los mandatorios suman los de MANDO y los no negociables del tipo", () => {
    const list = welcomeMandatories(getTemplate("feria"));
    expect(list[0].titulo).toBe("El cliente mira minuto a minuto");
    expect(list.map((m) => m.titulo)).toContain("Visto bueno de seguridad antes de abrir");
    expect(welcomeMandatories(null)).toHaveLength(2);
  });

  it("el mensaje de invitación saluda por el nombre y explica cómo entrar", () => {
    expect(
      invitationMessage({
        name: "Tatiana Ríos",
        inviter: "Fernando",
        eventName: "Ferias Nacionales",
        cargo: "Productora de campo",
        link: "https://mando.app/ingresar",
      }),
    ).toBe(
      "Hola, Tatiana. Fernando te invitó a Ferias Nacionales en MANDO como Productora de campo. " +
        "Entra a https://mando.app/ingresar, escribe tu correo y usa el código de 6 dígitos que te llega.",
    );
  });
});

import { DEFAULT_CARGOS, parseTemplate } from "@mando/core/event-types";

describe("plantilla guardada en el evento", () => {
  it("un evento sin plantilla devuelve null", () => {
    expect(parseTemplate({})).toBeNull();
    expect(parseTemplate(null)).toBeNull();
  });
  it("una plantilla sin cargos usa los cargos por defecto", () => {
    const t = parseTemplate({ clave: "propio", piezas: [] })!;
    expect(t.nombre).toBe("propio");
    expect(t.cargos).toEqual(DEFAULT_CARGOS);
  });
});
