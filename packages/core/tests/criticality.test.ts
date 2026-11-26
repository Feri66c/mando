import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { levelName, validateCriticalityConfig, type CriticalityConfig } from "@mando/core/criticality";

const config = JSON.parse(readFileSync(new URL("../../../config/criticidad.json", import.meta.url), "utf8")) as CriticalityConfig;

describe("escala de criticidad (config/criticidad.json)", () => {
  it("es válida: niveles 1 a 4, cada uno con nombre y color", () => {
    expect(validateCriticalityConfig(config)).toEqual([]);
  });

  it("tiene los nombres acordados", () => {
    expect([1, 2, 3, 4].map((n) => levelName(config, n))).toEqual(["Informativo", "Atención", "Crítico", "Red Flag"]);
  });

  it("solo el nivel 4 es visible para el cliente por defecto", () => {
    expect(config.niveles.filter((n) => n.visible_para_cliente).map((n) => n.nivel)).toEqual([4]);
  });

  it("detecta una configuración rota", () => {
    expect(validateCriticalityConfig({ niveles: [{ nivel: 1, nombre: "", color: "rojo" }], reglas: [] }).length).toBeGreaterThan(0);
    expect(validateCriticalityConfig(null)).toEqual(["Falta la lista de niveles."]);
  });

  it("el seed carga exactamente esta misma configuración en el evento de ejemplo", () => {
    const seed = readFileSync(new URL("../../../supabase/seed.sql", import.meta.url), "utf8");
    const embedded = seed.match(/\$crit\$([\s\S]*?)\$crit\$/)?.[1];
    expect(embedded, "el seed debe contener la escala entre $crit$").toBeTruthy();
    expect(JSON.parse(embedded!)).toEqual(config);
  });
});
