import type { EvidenceKind } from "./labels";

/** Tipo de evidencia según el archivo. */
export function kindFromMime(mime: string): Exclude<EvidenceKind, "note"> {
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

/** Extensión segura para la ruta del archivo: solo letras y números, máximo 8. */
export function safeExtension(fileName: string): string {
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
}

/** Ruta del archivo en el cubo de evidencias: <evento>/<id>.<ext>. */
export function evidencePath(eventId: string, fileId: string, fileName: string): string {
  return `${eventId}/${fileId}.${safeExtension(fileName)}`;
}

/** Huella SHA-256 en hexadecimal (prueba de que el archivo no se tocó después). */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const MAX_EVIDENCE_BYTES = 50 * 1024 * 1024;
