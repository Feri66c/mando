// Aprobaciones del cliente (decisiones 28 y 29): casting, uniforme, utilería y referencias visuales.
// Los grupos viven en datos (config/aprobaciones.json).
import config from "../../../config/aprobaciones.json";

export type ApprovalGroup = { clave: string; nombre: string; prefijo: string; descripcion: string };
export type ApprovalStatus = "pending" | "approved" | "changes_requested" | "backup" | "rejected";

/** El semáforo del casting (decisión 50): verde, ámbar y rojo. Siempre con su nombre escrito. */
export const CASTING_VERDICTS = [
  { clave: "approved", nombre: "Aprobado", color: "verde" },
  { clave: "backup", nombre: "Backup", color: "ambar" },
  { clave: "rejected", nombre: "No admitido", color: "rojo" },
] as const;
export type CastingVerdict = (typeof CASTING_VERDICTS)[number]["clave"];

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
  backup: "Backup",
  rejected: "No admitido",
};

/**
 * Qué falta para poder empezar: grupos prendidos sin nada subido y elementos sin aprobar.
 * En casting cada persona recibe un veredicto: basta que nadie quede por revisar y haya al menos una aprobada.
 */
export function approvalGate(groups: string[], items: { group: string; status: ApprovalStatus }[]): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const key of groups) {
    const name = approvalGroup(key)?.nombre ?? key;
    const own = items.filter((i) => i.group === key);
    if (own.length === 0) missing.push(`${name}: falta subirlo`);
    else {
      const open = own.filter((i) => (key === "casting" ? i.status === "pending" || i.status === "changes_requested" : i.status !== "approved")).length;
      if (open > 0) missing.push(`${name}: ${open} por aprobar`);
      else if (!own.some((i) => i.status === "approved")) missing.push(`${name}: falta al menos una persona aprobada`);
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
