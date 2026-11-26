// Encuesta de cierre (decisión 36): aprendizajes del equipo y ficha de satisfacción del cliente.
import config from "../../../config/aprendizajes.json";

export const LEARNINGS_COUNT: number = config.cantidad;
export const LEARNINGS_HINTS: readonly string[] = config.ayudas;
export const LEARNINGS_LAST_QUESTION: string = config.pregunta_final;
export const CLIENT_QUESTION: string = config.pregunta_cliente;

/** Limpia lo que se escribió: sin vacíos, sin repetidos y no más de la cantidad pedida. */
export function cleanLearnings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const value = raw.trim().replace(/\s+/g, " ");
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value.slice(0, 300));
  }
  return out.slice(0, LEARNINGS_COUNT);
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

export function validateLearningsConfig(): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(LEARNINGS_COUNT) || LEARNINGS_COUNT < 1 || LEARNINGS_COUNT > 10) errors.push("cantidad debe ir de 1 a 10");
  if (LEARNINGS_HINTS.length < LEARNINGS_COUNT) errors.push("faltan ayudas: una por aprendizaje");
  return errors;
}
