import { describe, expect, it } from "vitest";
import zones from "../../../config/zonas-horarias.json";
import { BREAKDOWN_GROUPS, COUNTRIES, ITEMS_MAX, ITEMS_MIN, RUBROS, assignCodes, compareBreakdown, countryForZone, itemsPerGroup } from "../src/breakdown";

describe("Desglose para cotizar", () => {
  it("cada rubro está en un solo grupo y los grupos suman el rango pedido", () => {
    const inGroups = BREAKDOWN_GROUPS.flatMap((g) => g.rubros);
    expect(new Set(inGroups).size).toBe(inGroups.length);
    expect([...inGroups].sort()).toEqual(RUBROS.map((r) => r.codigo).sort());
    const min = BREAKDOWN_GROUPS.reduce((s, g) => s + itemsPerGroup(g).min, 0);
    const max = BREAKDOWN_GROUPS.reduce((s, g) => s + itemsPerGroup(g).max, 0);
    expect(Math.abs(min - ITEMS_MIN)).toBeLessThanOrEqual(2);
    expect(Math.abs(max - ITEMS_MAX)).toBeLessThanOrEqual(2);
  });

  it("ordena por rubro, pone códigos y limpia lo que devolvió la IA", () => {
    const items = assignCodes([
      { rubro: "ENE", item: "Grupo electrógeno 100 kVA", cantidad: 8, dias: 1 },
      { rubro: "AUD", item: "Consola digital", cantidad: "2" as unknown as number },
      { rubro: "XXX", item: "Coordinación", cantidad: -3 },
      { rubro: "ENE", item: "  " },
      { rubro: "ENE", item: "Combustible", unidad: "galón", cantidad: 120 },
    ]);
    expect(items.map((i) => i.codigo)).toEqual(["PRD-01", "AUD-01", "ENE-01", "ENE-02"]);
    expect(items[0].cantidad).toBe(1);
    expect(items[1].cantidad).toBe(2);
    expect(items[1].unidad).toBe("unidad");
  });

  it("dice qué se quitó, qué cambió de cantidad y qué se sumó", () => {
    const base = assignCodes([
      { rubro: "ENE", item: "Grupo electrógeno", cantidad: 8 },
      { rubro: "ALI", item: "Puntos de hidratación", cantidad: 4 },
      { rubro: "AUD", item: "Consola", cantidad: 1 },
    ]);
    const current = [
      { ...base.find((b) => b.rubro === "ENE")!, cantidad: 4 },
      base.find((b) => b.rubro === "AUD")!,
      { ...base[0], codigo: "", item: "Photocall", rubro: "MAR" },
    ];
    const diff = compareBreakdown(base, current);
    expect(diff.removed.map((r) => r.item)).toEqual(["Puntos de hidratación"]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].before.cantidad).toBe(8);
    expect(diff.changed[0].after.cantidad).toBe(4);
    expect(diff.added.map((a) => a.item)).toEqual(["Photocall"]);
  });
});


describe("País del desglose", () => {
  it("cada zona horaria que se puede elegir tiene país, moneda e impuesto", () => {
    for (const z of zones.zonas) expect(COUNTRIES.some((c) => c.zonas.includes(z.zona))).toBe(true);
    expect(countryForZone("America/Lima").impuesto).toBe("IGV");
    expect(countryForZone("America/Mexico_City").tasa).toBe(0.16);
    expect(countryForZone(null).codigo).toBe("PE");
  });
});
