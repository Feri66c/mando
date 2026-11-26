import { describe, expect, it } from "vitest";
import {
  accessCargos, accessListCsv, areaSummary, brandLogoPath, commandTree, defaultVisibility, filterAccess, modalityBadge,
  seesAll, validateCommandConfig, visibilityLabel, emergencyWindowLabel, type AccessRow, type ChainMember,
} from "@mando/core/command";

const m = (id: string, name: string, level: number, boss: string | null, area: string | null = null): ChainMember => ({
  profileId: id, fullName: name, title: null, role: level === 1 ? "backend" : "producer", level, areaId: area, areaName: area,
  reportsTo: boss, reportsToName: null, visibility: level <= 2 ? "completa" : "area", subordinates: 0, active: true,
});

describe("cadena de mando", () => {
  it("la configuración tiene todas las claves que conoce la base", () => {
    expect(validateCommandConfig()).toEqual([]);
  });

  it("arma el árbol: cada mando seguido de los suyos, con toda la gente que cuelga", () => {
    const tree = commandTree([
      m("t2", "Luis Técnico", 4, "c1", "Sonido"),
      m("c1", "Tatiana Sonido", 3, "p", "Sonido"),
      m("p", "Productor", 2, "b"),
      m("b", "Backend", 1, null),
      m("c2", "Ana Luces", 3, "p", "Luces"),
      m("t1", "Beto Técnico", 4, "c1", "Sonido"),
      m("x", "Suelto", 4, "ya-no-esta"),
    ]);
    expect(tree.map((n) => `${"·".repeat(n.depth)}${n.fullName}:${n.team}`)).toEqual([
      "Backend:5", "·Productor:4", "··Ana Luces:0", "··Tatiana Sonido:2", "···Beto Técnico:0", "···Luis Técnico:0", "Suelto:0",
    ]);
  });

  it("un círculo en los datos no cuelga la pantalla ni pierde a nadie", () => {
    const tree = commandTree([m("a", "A", 3, "b"), m("b", "B", 3, "a")]);
    expect(tree.map((n) => n.fullName).sort()).toEqual(["A", "B"]);
  });

  it("cuenta la gente por área, con «Sin área» al final", () => {
    expect(areaSummary([m("1", "A", 3, null, "Sonido"), m("2", "B", 4, null, "Sonido"), m("3", "C", 2, null), m("4", "D", 3, null, "Luces")])).toEqual([
      { area: "Luces", count: 1 }, { area: "Sonido", count: 2 }, { area: "Sin área", count: 1 },
    ]);
  });

  it("lo que ve cada quien si nadie dice otra cosa", () => {
    expect(defaultVisibility(1, false)).toBe("completa");
    expect(defaultVisibility(2, false)).toBe("completa");
    expect(defaultVisibility(3, true)).toBe("area");
    expect(defaultVisibility(3, false)).toBe("propia");
    expect(defaultVisibility(4, true)).toBe("propia");
    expect(seesAll("backend", "propia")).toBe(true);
    expect(seesAll("producer", "completa")).toBe(true);
    expect(seesAll("producer", "area")).toBe(false);
    expect(seesAll("viewer", "completa")).toBe(false);
    expect(visibilityLabel("propia")).toBe("Solo lo suyo");
    expect(emergencyWindowLabel("ultimo_minuto")).toBe("Último minuto");
  });

  it("la tercerización se nombra junto al evento; el evento directo no lleva etiqueta", () => {
    expect(modalityBadge("tercerizado", "Circus")).toBe("Tercerización · Circus");
    expect(modalityBadge("agencia", null)).toBe("Agencia");
    expect(modalityBadge("directo", "Circus")).toBeNull();
    expect(modalityBadge(null, null)).toBeNull();
  });

  it("los logos solo entran como imagen", () => {
    expect(brandLogoPath("ev", "id", "Sodimac Logo.PNG")).toBe("ev/marcas/id.png");
    expect(brandLogoPath("ev", "id", "logo.jpeg")).toBe("ev/marcas/id.jpeg");
    expect(brandLogoPath("ev", "id", "logo.svg")).toBeNull();
    expect(brandLogoPath("ev", "id", "logo.png.exe")).toBeNull();
  });
});

describe("lista de ingreso", () => {
  const rows: AccessRow[] = [
    { fullName: "Mayra Quispe", docType: "dni", docNumber: "70123456", role: "Anfitriona", docState: "vigente" },
    { fullName: "Carlos Ruiz", docType: "pasaporte", docNumber: "X1234567", role: "Camarógrafo", docState: "sin_dni" },
    { fullName: "=HYPERLINK(\"http://x\")", docType: null, docNumber: null, role: "Camarógrafo", docState: "vencido" },
  ];

  it("filtra por cargo", () => {
    expect(accessCargos(rows)).toEqual(["Anfitriona", "Camarógrafo"]);
    expect(filterAccess(rows, " camarógrafo ")).toHaveLength(2);
    expect(filterAccess(rows, "")).toHaveLength(3);
  });

  it("sale con el título que pide el local, numerada y sin fórmulas", () => {
    const csv = accessListCsv("Feria de la Construcción Sodimac", rows, "Camarógrafo");
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines[0]).toBe("MANDO · Feria de la Construcción Sodimac · Participantes · Camarógrafo");
    expect(lines[1]).toBe("2 personas");
    expect(lines[2]).toBe("N.º,Nombre completo,Tipo de documento,Número de documento,Cargo,Documento");
    expect(lines[3]).toBe("1,Carlos Ruiz,Pasaporte,X1234567,Camarógrafo,Falta la copia del documento");
    expect(lines[4].startsWith("2,\"'=HYPERLINK")).toBe(true);
    expect(accessListCsv("Evento", rows.slice(0, 1)).split("\r\n")[1]).toBe("1 persona");
  });
});
