// Escala de criticidad por defecto (config/criticidad.json). Se copia a cada evento al crearlo (regla 6).
import criticality from "../../../config/criticidad.json";

export const DEFAULT_CRITICALITY: Record<string, unknown> = criticality;
