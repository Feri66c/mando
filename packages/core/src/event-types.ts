// Tipos de evento (decisión 18). Las plantillas viven en datos: config/tipos-de-evento.json.
// Al crear un evento, su plantilla se copia al evento (events.template) y la hoja de ruta nace de sus piezas.
import config from "../../../config/tipos-de-evento.json";
import type { EventRole } from "./labels";

export type TierKey = "ligero" | "medio" | "mayor";

export type TemplatePiece = {
  titulo: string;
  detalle: string;
  /** Minutos desde la hora clave del evento (negativo = antes). */
  inicio_min: number;
  duracion_min: number;
  /** Pieza clave: si se atrasa, mueve la hora que el cliente espera. Se marca como hito. */
  clave: boolean;
  visible_cliente: boolean;
};

export type TemplateCargo = { cargo: string; nivel: number | null; rol: EventRole };

export type EventTemplate = {
  clave: string;
  nombre: string;
  tamano: TierKey;
  descripcion: string;
  hora_clave: string;
  datos: string[];
  piezas: TemplatePiece[];
  no_negociables: string[];
  hitos_estrella: string[];
  cargos: TemplateCargo[];
};

export type Mandatory = { titulo: string; detalle: string };

type Config = {
  mandatorios_de_mando: Mandatory[];
  tamanos: Record<TierKey, { nombre: string; descripcion: string }>;
  tipos: EventTemplate[];
};

const CONFIG = config as unknown as Config;

export const EVENT_TEMPLATES: readonly EventTemplate[] = CONFIG.tipos;
export const MANDO_MANDATORIES: readonly Mandatory[] = CONFIG.mandatorios_de_mando;
export const TIERS = CONFIG.tamanos;

export function getTemplate(key: string): EventTemplate | null {
  return EVENT_TEMPLATES.find((t) => t.clave === key) ?? null;
}

/** Cargo y nivel por defecto según el rol: lo que se ofrece en el formulario de invitación. */
export const LEVEL_LABEL: Record<number, string> = {
  1: "Productor general",
  2: "Productor de campo",
  3: "Coordinación",
  4: "Técnicos y proveedores",
};

/** Cargos que se ofrecen cuando el evento no tiene plantilla (eventos anteriores a los tipos). */
export const DEFAULT_CARGOS: readonly TemplateCargo[] = [
  { cargo: "Productor general", nivel: 1, rol: "backend" },
  { cargo: "Productor de campo", nivel: 2, rol: "producer" },
  { cargo: "Coordinador", nivel: 3, rol: "producer" },
  { cargo: "Técnico o proveedor", nivel: 4, rol: "producer" },
  { cargo: "Cliente", nivel: null, rol: "viewer" },
];

/** Lee la plantilla guardada en el evento. Devuelve null si el evento no tiene (o está incompleta). */
export function parseTemplate(value: unknown): EventTemplate | null {
  const t = value as Partial<EventTemplate> | null;
  if (!t || typeof t !== "object" || typeof t.clave !== "string" || !Array.isArray(t.piezas)) return null;
  return {
    clave: t.clave,
    nombre: String(t.nombre ?? t.clave),
    tamano: (t.tamano ?? "ligero") as TierKey,
    descripcion: String(t.descripcion ?? ""),
    hora_clave: String(t.hora_clave ?? "Inicio"),
    datos: Array.isArray(t.datos) ? t.datos.map(String) : [],
    piezas: t.piezas,
    no_negociables: Array.isArray(t.no_negociables) ? t.no_negociables.map(String) : [],
    hitos_estrella: Array.isArray(t.hitos_estrella) ? t.hitos_estrella.map(String) : [],
    cargos: Array.isArray(t.cargos) && t.cargos.length > 0 ? t.cargos : [...DEFAULT_CARGOS],
  };
}

export type PlannedPiece = {
  title: string;
  detail: string;
  start: string; // ISO UTC
  end: string; // ISO UTC
  isMilestone: boolean;
  visibleToViewer: boolean;
  sortOrder: number;
};

/** Hoja de ruta inicial: cada pieza a su hora, contada desde la hora clave. */
export function planRoute(template: EventTemplate, keyTime: Date): PlannedPiece[] {
  const base = keyTime.getTime();
  return template.piezas.map((p, i) => ({
    title: p.titulo,
    detail: p.detalle,
    start: new Date(base + p.inicio_min * 60_000).toISOString(),
    end: new Date(base + (p.inicio_min + p.duracion_min) * 60_000).toISOString(),
    isMilestone: p.clave,
    visibleToViewer: p.visible_cliente,
    sortOrder: i + 1,
  }));
}

/** El evento empieza con su primera pieza del día de la hora clave y termina con la última pieza. */
export function eventWindow(pieces: PlannedPiece[]): { start: string; end: string } {
  const starts = pieces.map((p) => p.start).sort();
  const ends = pieces.map((p) => p.end).sort();
  return { start: starts[0], end: ends[ends.length - 1] };
}

/** Lo que ve una persona antes de tomar el mando: los mandatorios de MANDO y los no negociables del tipo. */
export function welcomeMandatories(template: Pick<EventTemplate, "no_negociables"> | null): Mandatory[] {
  const own = (template?.no_negociables ?? []).map((t) => ({
    titulo: t,
    detalle: "Es no negociable: si falla, el evento termina sin estrellas.",
  }));
  return [...MANDO_MANDATORIES, ...own];
}

/** Texto para mandar la invitación por WhatsApp o correo, además del código que manda MANDO. */
export function invitationMessage(opts: {
  name: string;
  inviter: string;
  eventName: string;
  cargo: string;
  link: string;
}): string {
  const first = opts.name.trim().split(/\s+/)[0] || opts.name;
  return (
    `Hola, ${first}. ${opts.inviter} te invitó a ${opts.eventName} en MANDO como ${opts.cargo}. ` +
    `Entra a ${opts.link}, escribe tu correo y usa el código de 6 dígitos que te llega.`
  );
}

/** Revisa que una plantilla sea usable antes de mandarla a la base de datos. */
export function validateTemplate(t: EventTemplate): string[] {
  const problems: string[] = [];
  if (!t.clave || !t.nombre) problems.push("Falta la clave o el nombre.");
  if (!(t.tamano in CONFIG.tamanos)) problems.push(`Tamaño desconocido: ${t.tamano}.`);
  if (t.piezas.length === 0) problems.push("No tiene piezas.");
  t.piezas.forEach((p, i) => {
    if (!p.titulo) problems.push(`La pieza ${i + 1} no tiene título.`);
    if (!Number.isInteger(p.inicio_min) || !Number.isInteger(p.duracion_min) || p.duracion_min < 0)
      problems.push(`La pieza ${p.titulo || i + 1} tiene minutos inválidos.`);
  });
  if (!t.piezas.some((p) => p.inicio_min === 0)) problems.push("Ninguna pieza empieza en la hora clave.");
  if (!t.cargos.some((c) => c.rol === "backend" && c.nivel === 1)) problems.push("Falta el cargo de productor general.");
  if (!t.cargos.some((c) => c.rol === "viewer")) problems.push("Falta el cargo del cliente.");
  return problems;
}
