import { describe, expect, it } from "vitest";
import { LEARNINGS_COUNT, cleanLearnings, firstName, validateLearningsConfig } from "../src/learnings";

describe("aprendizajes", () => {
  it("la configuración es válida y pide seis", () => {
    expect(validateLearningsConfig()).toEqual([]);
    expect(LEARNINGS_COUNT).toBe(6);
  });
  it("limpia vacíos, repetidos y sobrantes", () => {
    expect(cleanLearnings(["  Llegar antes ", "", "llegar antes", "Probar   el sonido"])).toEqual(["Llegar antes", "Probar el sonido"]);
    expect(cleanLearnings(["a", "b", "c", "d", "e", "f", "g"])).toHaveLength(6);
  });
  it("saluda por el primer nombre", () => {
    expect(firstName("Tatiana Ríos Vega")).toBe("Tatiana");
  });
});
