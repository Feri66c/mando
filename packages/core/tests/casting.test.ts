import { describe, expect, it } from "vitest";
import { DOC_TYPES, FICHA_FIELDS, cleanDocNumber, cleanFicha, docProblem, fichaRows, validateFichaConfig } from "@mando/core/casting";
import { SUGGESTED_ROLES, roleOptions } from "@mando/core/planning";

describe("mini ficha y documentos (config/ficha-casting.json)", () => {
  it("la configuración es válida y trae lo que pidió Fer", () => {
    expect(validateFichaConfig()).toEqual([]);
    const keys = FICHA_FIELDS.map((f) => f.clave);
    for (const k of ["edad", "disponibilidad", "nacionalidad", "talla", "color_de_ojos", "estatura", "alergias", "contextura", "hobby", "habilidad"]) expect(keys).toContain(k);
    expect(DOC_TYPES.map((d) => d.clave)).toEqual(["dni", "ce", "pasaporte"]);
  });

  it("el DNI son 8 números exactos y no deja escribir más", () => {
    expect(cleanDocNumber("dni", "70 12-34 56 99x")).toBe("70123456");
    expect(docProblem("dni", "1234567")).toMatch(/8 números/);
    expect(docProblem("dni", "12345678")).toBeNull();
    expect(docProblem("dni", "")).toBeNull();
    expect(cleanDocNumber("pasaporte", "xy-123 456")).toBe("XY123456");
    expect(docProblem("ce", "1234")).toMatch(/9 a 12/);
    expect(cleanDocNumber("ce", "A".repeat(20))).toHaveLength(12);
  });

  it("la ficha solo guarda campos conocidos y números dentro de rango", () => {
    expect(cleanFicha({ edad: "24", talla: " M ", estatura: "999", inventado: "x", hobby: "" })).toEqual({ edad: "24", talla: "M" });
    expect(fichaRows({ estatura: "168", habilidad: "Canto" })).toEqual([
      { clave: "estatura", nombre: "Estatura", valor: "168 cm" },
      { clave: "habilidad", nombre: "Habilidad", valor: "Canto" },
    ]);
  });

  it("los cargos van en orden alfabético y suman los aprobados sin repetir", () => {
    const base = roleOptions();
    expect(base).toEqual([...base].sort((a, b) => a.localeCompare(b, "es")));
    expect(base.length).toBe(SUGGESTED_ROLES.length);
    for (const r of ["Primer asistente", "Segundo asistente", "Utilero", "Aguatero", "Director de sonido"]) expect(base).toContain(r);
    const more = roleOptions(["jefe de piso", "UTILERO", "  "]);
    expect(more).toContain("jefe de piso");
    expect(more.length).toBe(base.length + 1);
  });
});
