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
