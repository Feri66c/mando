import { describe, expect, it } from "vitest";
import { TALENT_CATEGORIES, filterTalents, parseCsv, readTalentCsv, talentsToCsv, type Talent } from "@mando/core/talents";

const talent = (over: Partial<Talent>): Talent => ({
  id: "1", fullName: "Mayra Quispe", docType: "dni", docNumber: "70123456", phone: null, photoUrl: null, categories: ["anfitriona"],
  profile: { edad: "24", habilidad: "Canto" }, defaultRole: null, consent: true, events: 2, inCasting: false, ...over,
});

describe("banco de talentos", () => {
  it("trae las categorías que pidió Fer", () => {
    expect(TALENT_CATEGORIES).toEqual(["anfitriona", "promotora", "modelo", "host", "animador", "locutor", "personaje", "actor"]);
  });

  it("lee CSV con coma o punto y coma, comillas y marca de UTF-8", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","dijo ""hola"""\r\n\r\n1,2')).toEqual([["a", "b"], ["x, y", 'dijo "hola"'], ["1", "2"]]);
    expect(parseCsv("a;b\n1;2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("la lista mínima de una castinera: nombre, apellido, edad y talla", () => {
    const r = readTalentCsv("Nombre;Apellido;Edad;Talla\nMayra;Quispe;24 años;M\nGabriela;Torres;27;S\n", "Modelo");
    expect(r.problems).toEqual([]);
    expect(r.rows).toEqual([
      { nombre: "Mayra Quispe", tipo: "dni", documento: "", telefono: "", categorias: ["modelo"], ficha: { edad: "24", talla: "M" } },
      { nombre: "Gabriela Torres", tipo: "dni", documento: "", telefono: "", categorias: ["modelo"], ficha: { edad: "27", talla: "S" } },
    ]);
  });

  it("reconoce documento, categoría y avisa las filas que no entran", () => {
    const r = readTalentCsv(
      "Nombre completo,DNI,Tipo de documento,Celular,Categoría,Estatura,Color favorito\n" +
        "Ana Uno,70123456,,999111222,Anfitriona / Host,168 cm,azul\n" +
        "Luis Dos,1234,,,,,\n" +
        ",70000000,,,,,\n" +
        "Eva Tres,xy123456,Pasaporte,,,,\n",
    );
    expect(r.unknown).toEqual(["Color favorito"]);
    expect(r.rows.map((x) => [x.nombre, x.tipo, x.documento, x.categorias])).toEqual([
      ["Ana Uno", "dni", "70123456", ["anfitriona", "host"]],
      ["Eva Tres", "pasaporte", "XY123456", []],
    ]);
    expect(r.rows[0].ficha).toEqual({ estatura: "168" });
    expect(r.problems.map((p) => p.fila)).toEqual([3, 4]);
    expect(readTalentCsv("Edad,Talla\n24,M").problems[0].motivo).toMatch(/Nombre/);
  });

  it("exporta para Excel sin dejar pasar fórmulas", () => {
    const csv = talentsToCsv([talent({}), talent({ id: "2", fullName: "=HYPERLINK(1)", categories: ["host", "modelo"] })]);
    expect(csv.startsWith("﻿Nombre completo,Tipo de documento,Documento")).toBe(true);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("Mayra Quispe,DNI,70123456");
    expect(lines[2].startsWith("'=HYPERLINK(1)")).toBe(true);
    expect(lines[2]).toContain('"Host, Modelo"');
    expect(parseCsv(csv)[1][0]).toBe("Mayra Quispe");
  });

  it("filtra por categoría y por texto, sin importar tildes", () => {
    const all = [talent({}), talent({ id: "2", fullName: "José Peña", docNumber: "44556677", categories: ["host"], profile: { habilidad: "Locución" } })];
    expect(filterTalents(all, "host", "").map((t) => t.id)).toEqual(["2"]);
    expect(filterTalents(all, "", "locucion").map((t) => t.id)).toEqual(["2"]);
    expect(filterTalents(all, "", "7012").map((t) => t.id)).toEqual(["1"]);
    expect(filterTalents(all, "", "").length).toBe(2);
  });
});
