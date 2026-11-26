// La escala de criticidad vive en datos (regla 6): events.criticality_config, copia de config/criticidad.json.
// Aquí solo se lee y se valida su forma.

export type CriticalityLevel = {
  nivel: 1 | 2 | 3 | 4;
  clave: string;
  nombre: string;
  descripcion: string;
  color: string;
  notifica: ("viewer" | "producer" | "backend")[];
  visible_para_cliente: boolean;
};

export type CriticalityRule = {
  clave: string;
  nivel: 1 | 2 | 3 | 4;
  cuando: string;
  parametros: Record<string, number>;
};

export type CriticalityConfig = { niveles: CriticalityLevel[]; reglas: CriticalityRule[] };

/** Devuelve la lista de problemas de una configuración (vacía si está bien). */
export function validateCriticalityConfig(config: unknown): string[] {
  const problems: string[] = [];
  const c = config as Partial<CriticalityConfig> | null;
  if (!c || !Array.isArray(c.niveles)) return ["Falta la lista de niveles."];
  const levels = c.niveles.map((n) => n?.nivel).sort();
  if (levels.join(",") !== "1,2,3,4") problems.push("Debe haber exactamente los niveles 1, 2, 3 y 4.");
  for (const n of c.niveles) {
    if (!n?.nombre?.trim()) problems.push(`El nivel ${n?.nivel} no tiene nombre (regla 8: el color nunca va solo).`);
    if (!/^#[0-9a-f]{6}$/i.test(n?.color ?? "")) problems.push(`El nivel ${n?.nivel} tiene un color inválido.`);
  }
  if (!Array.isArray(c.reglas)) problems.push("Falta la lista de reglas.");
  else
    for (const r of c.reglas) {
      if (!levels.includes(r?.nivel)) problems.push(`La regla ${r?.clave} usa un nivel que no existe.`);
    }
  return problems;
}

export function levelName(config: CriticalityConfig, level: number): string {
  return config.niveles.find((n) => n.nivel === level)?.nombre ?? `Nivel ${level}`;
}

/** Luminancia relativa (WCAG) de un color #rrggbb. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre dos colores (1 a 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const NAVY = "#061428";
const WHITE = "#ffffff";

/**
 * Colores de la etiqueta de un nivel. El color sale de la configuración (datos); el texto se elige para que
 * se lea. Si el color casi no se distingue del fondo oscuro (Red Flag es #061428, el mismo azul noche),
 * la etiqueta pasa a blanca con texto azul noche (decisión 10).
 */
export function levelChipColors(color: string, background: string): { bg: string; fg: string; border: string } {
  const safe = /^#[0-9a-f]{6}$/i.test(color) ? color : "#6fa3cc";
  if (contrast(safe, background) < 1.6) return { bg: WHITE, fg: NAVY, border: WHITE };
  const fg = contrast(safe, NAVY) >= contrast(safe, WHITE) ? NAVY : WHITE;
  return { bg: safe, fg, border: safe };
}

/** Niveles por defecto cuando el evento no trae configuración (no debería pasar). */
export function levelOf(config: CriticalityConfig | null, level: number): CriticalityLevel {
  const found = config?.niveles?.find((n) => n.nivel === level);
  if (found) return found;
  const names = ["Informativo", "Atención", "Crítico", "Red Flag"];
  const colors = ["#a9cce8", "#c9a227", "#b3402e", "#061428"];
  return {
    nivel: level as CriticalityLevel["nivel"],
    clave: String(level),
    nombre: names[level - 1] ?? `Nivel ${level}`,
    descripcion: "",
    color: colors[level - 1] ?? "#6fa3cc",
    notifica: [],
    visible_para_cliente: level === 4,
  };
}
