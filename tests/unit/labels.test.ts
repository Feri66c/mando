import { describe, expect, it } from "vitest";
import { EVENT_STATUS_LABEL, ITEM_STATUS_LABEL, ROLE_LABEL, isEventRole } from "@/lib/core/labels";

describe("textos visibles", () => {
  it("los tres roles tienen nombre en español", () => {
    expect(ROLE_LABEL).toEqual({ viewer: "Cliente", producer: "Productor", backend: "Torre de control" });
  });

  it("todo estado tiene su palabra (regla 8)", () => {
    for (const label of [...Object.values(EVENT_STATUS_LABEL), ...Object.values(ITEM_STATUS_LABEL)]) {
      expect(label.trim().length).toBeGreaterThan(0);
    }
    expect(ITEM_STATUS_LABEL.done).toBe("Listo");
  });

  it("reconoce solo roles válidos", () => {
    expect(isEventRole("viewer")).toBe(true);
    expect(isEventRole("admin")).toBe(false);
  });
});
