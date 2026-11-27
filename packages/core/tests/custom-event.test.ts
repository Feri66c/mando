import { describe, expect, it } from "vitest";
import {
  CUSTOM_AREAS,
  CUSTOM_BLOCKS,
  areaLoad,
  checkCustom,
  composeCustomTemplate,
  customTier,
  pickModules,
} from "../src/custom-event";
import { validateTemplate } from "../src/event-types";
import { REQUIREMENT_CATEGORIES } from "../src/requirements";

const ALL = CUSTOM_BLOCKS.flatMap((b) => b.modulos);
const CATEGORIES = new Set(REQUIREMENT_CATEGORIES.map((c) => c.clave));
const AREAS = new Set(CUSTOM_AREAS.map((a) => a.clave));
const TECH = new Set(["escenario", "luces", "sonido", "microfonos", "video", "energia", "otros"]);
const APPROVALS = new Set(["casting", "uniforme", "utileria", "referencias"]);

describe("catálogo del evento personalizado", () => {
  it("cada componente es válido para la base de datos", () => {
    const keys = new Set<string>();
    for (const m of ALL) {
      expect(keys.has(m.clave), m.clave).toBe(false);
      keys.add(m.clave);
      expect(m.deriva.length, m.clave).toBeGreaterThan(0);
      m.deriva.forEach((a) => expect(AREAS.has(a), `${m.clave}: ${a}`).toBe(true));
      m.documentos.forEach((d) => expect(CATEGORIES.has(d.categoria), `${m.clave}: ${d.clave}`).toBe(true));
      m.tecnica.forEach((t) => expect(TECH.has(t.categoria), `${m.clave}: ${t.titulo}`).toBe(true));
      m.aprobaciones.forEach((a) => expect(APPROVALS.has(a), `${m.clave}: ${a}`).toBe(true));
      m.cargos.forEach((c) => expect([3, 4, 2]).toContain(c.nivel));
    }
  });

  it("todo marcado arma una plantilla válida y Mayor", () => {
    const t = composeCustomTemplate("Megaproyecto Lanzamiento", ALL.map((m) => m.clave));
    expect(validateTemplate(t)).toEqual([]);
    expect(t.clave).toBe("personalizado");
    expect(t.nombre).toBe("Megaproyecto Lanzamiento");
    expect(t.tamano).toBe("mayor");
    expect(new Set(t.documentos.map((d) => d.clave)).size).toBe(t.documentos.length);
    expect(new Set(t.cargos.map((c) => c.cargo)).size).toBe(t.cargos.length);
    expect(t.piezas.map((p) => p.inicio_min)).toEqual([...t.piezas.map((p) => p.inicio_min)].sort((a, b) => a - b));
    expect(t.planificacion).toBe(true);
  });

  it("trae lo de todo evento y lo de cada componente", () => {
    const t = composeCustomTemplate("Activos importados", ["internamiento", "talento-internacional"]);
    const docs = t.documentos.map((d) => d.clave);
    expect(docs).toEqual(expect.arrayContaining(["sctr", "epp", "contratos", "facturas", "admision-temporal", "garantia-sunat", "calidad-migratoria"]));
    expect(t.no_negociables).toContain("Activos internados con garantía vigente");
    expect(t.cargos.map((c) => c.cargo)).toContain("Manager de talento internacional");
    expect(t.piezas.map((p) => p.titulo)).toContain("Reexportación de activos");
    expect(t.modulos).toEqual(["talento-internacional", "internamiento"]);
  });

  it("une las aprobaciones sin repetir", () => {
    const t = composeCustomTemplate("Show", ["modelos", "hosts", "staff"]);
    expect(t.aprobaciones.map((a) => a.clave)).toEqual(["casting", "uniforme"]);
    expect(t.aprobaciones[0].prefijo).toBe("C");
  });

  it("el tamaño crece con lo que lleva", () => {
    expect(customTier(pickModules(["interior"]))).toBe("ligero");
    expect(customTier(pickModules(["interior", "hosts", "carga"]))).toBe("medio");
    expect(customTier(pickModules(["interior", "con-estructuras"]))).toBe("mayor");
  });

  it("pide nombre y al menos un componente", () => {
    expect(checkCustom("", ["interior"])).toMatch(/nombre/);
    expect(checkCustom("Mi evento", [])).toMatch(/componente/);
    expect(checkCustom("Mi evento", ["no-existe"])).toMatch(/componente/);
    expect(checkCustom("Mi evento", ["interior"])).toBeNull();
  });

  it("cuenta lo que llega a cada área", () => {
    const load = areaLoad(pickModules(["carga", "movilidad"]));
    expect(load.find((l) => l.area.clave === "transporte")?.count).toBe(2);
    expect(load.find((l) => l.area.clave === "tecnico")?.count).toBe(0);
  });
});

describe("sugerencias desde el brief", () => {
  it("lee el brief y sugiere componentes con la palabra que los disparó", async () => {
    const { suggestModules } = await import("../src/custom-event");
    const s = suggestModules(
      "Lanzamiento en el Estadio Nacional con un artista internacional, pantallas LED, estructuras de truss, " +
        "equipos en admisión temporal que se reexportan, degustación de cerveza y un sorteo.",
    );
    const keys = s.map((x) => x.clave);
    expect(keys).toEqual(
      expect.arrayContaining(["recinto-masivo", "talento-internacional", "pantallas", "con-estructuras", "internamiento", "alimentos", "sorteos"]),
    );
    expect(keys).not.toContain("drones");
    expect(s.find((x) => x.clave === "recinto-masivo")?.palabra).toBe("estadio");
  });

  it("sin brief no sugiere nada y no confunde palabras dentro de otras", async () => {
    const { suggestModules } = await import("../src/custom-event");
    expect(suggestModules("  ")).toEqual([]);
    expect(suggestModules("Un evento con buena energía del equipo").map((x) => x.clave)).toContain("energia");
    expect(suggestModules("Reunión de directorio").map((x) => x.clave)).not.toContain("drones");
  });
});
