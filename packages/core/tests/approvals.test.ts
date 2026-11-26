import { describe, expect, it } from "vitest";
import { approvalGate, approvalGroupsFor, validateApprovalConfig } from "@mando/core/approvals";
import { EVENT_TEMPLATES, getTemplate } from "@mando/core/event-types";
import { withDocuments } from "@mando/core/requirements";

describe("aprobaciones del cliente (config/aprobaciones.json)", () => {
  it("la configuración es válida y cada tipo de evento tiene sus grupos", () => {
    expect(validateApprovalConfig()).toEqual([]);
    for (const t of EVENT_TEMPLATES) expect(approvalGroupsFor(t.clave).length).toBeGreaterThan(0);
    expect(approvalGroupsFor("sampling")).toEqual(["casting", "uniforme", "utileria"]);
  });

  it("la plantilla del evento lleva sus grupos con su prefijo", () => {
    expect(withDocuments(getTemplate("podcast")!).aprobaciones).toEqual([
      { clave: "utileria", prefijo: "T" },
      { clave: "referencias", prefijo: "R" },
    ]);
  });

  it("no está listo mientras falte subir un grupo o quede algo sin aprobar", () => {
    const gate = approvalGate(
      ["casting", "uniforme", "utileria"],
      [
        { group: "casting", status: "approved" },
        { group: "casting", status: "changes_requested" },
        { group: "uniforme", status: "approved" },
      ],
    );
    expect(gate).toEqual({ ready: false, missing: ["Casting: 1 por aprobar", "Utilería: falta subirlo"] });
    expect(approvalGate(["uniforme"], [{ group: "uniforme", status: "approved" }]).ready).toBe(true);
    expect(approvalGate([], []).ready).toBe(true);
  });
});
