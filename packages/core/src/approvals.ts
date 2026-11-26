// Aprobaciones del cliente (decisiones 28 y 29): casting, uniforme, utilería y referencias visuales.
// Los grupos viven en datos (config/aprobaciones.json).
import config from "../../../config/aprobaciones.json";

export type ApprovalGroup = { clave: string; nombre: string; prefijo: string; descripcion: string };
export type ApprovalStatus = "pending" | "approved" | "changes_requested";

type Config = { grupos: ApprovalGroup[]; por_tipo: Record<string, string[]> };
const CONFIG = config as unknown as Config;

export const APPROVAL_GROUPS: readonly ApprovalGroup[] = CONFIG.grupos;

export function approvalGroupsFor(kind: string): string[] {
  return CONFIG.por_tipo[kind] ?? [];
}

export function approvalGroup(key: string): ApprovalGroup | null {
  return CONFIG.grupos.find((g) => g.clave === key) ?? null;
}

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "Por aprobar",
  approved: "Aprobado",
  changes_requested: "Pide cambio",
};

/** Qué falta para poder empezar: grupos prendidos sin nada subido y elementos sin aprobar. */
export function approvalGate(groups: string[], items: { group: string; status: ApprovalStatus }[]): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const key of groups) {
    const name = approvalGroup(key)?.nombre ?? key;
    const own = items.filter((i) => i.group === key);
    if (own.length === 0) missing.push(`${name}: falta subirlo`);
    else {
      const open = own.filter((i) => i.status !== "approved").length;
      if (open > 0) missing.push(`${name}: ${open} por aprobar`);
    }
  }
  return { ready: missing.length === 0, missing };
}

export function validateApprovalConfig(): string[] {
  const problems: string[] = [];
  const keys = new Set(CONFIG.grupos.map((g) => g.clave));
  if (new Set(CONFIG.grupos.map((g) => g.prefijo)).size !== CONFIG.grupos.length) problems.push("Hay prefijos repetidos.");
  for (const [kind, groups] of Object.entries(CONFIG.por_tipo)) {
    for (const g of groups) if (!keys.has(g)) problems.push(`Grupo desconocido en ${kind}: ${g}.`);
  }
  return problems;
}
