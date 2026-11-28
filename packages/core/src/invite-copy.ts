/** Con copia al dar el mando (decisión 91): otras personas se enteran de a quién se nombró, sin entrar a MANDO. */

export const MAX_COPIES = 15;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export const isEmail = (value: string) => EMAIL.test(value);

/** Separa los correos del campo «Con copia» (coma, punto y coma, espacios o saltos de línea). */
export function parseCopyList(raw: string, mainEmail = ""): { emails: string[]; invalid: string[] } {
  const main = mainEmail.trim().toLowerCase();
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const email = part.trim().toLowerCase();
    if (!email) continue;
    if (!isEmail(email)) invalid.push(part.trim());
    else if (email !== main && !emails.includes(email)) emails.push(email);
  }
  return { emails, invalid };
}

export type CopyNotice = { name: string; title: string; eventName: string; eventDate?: string; by?: string };

/** Asunto y texto del aviso para los que van con copia. */
export function copyNotice(n: CopyNotice): { subject: string; body: string } {
  const subject = `MANDO · ${n.name} tiene el mando como ${n.title} en ${n.eventName}`;
  const body = [
    "Hola:",
    "",
    `Te avisamos que ${n.by ? `${n.by} nombró a` : "se nombró a"} ${n.name} como ${n.title} en el evento ${n.eventName}${n.eventDate ? ` (${n.eventDate})` : ""}.`,
    `Desde ahora ${n.name} tiene ese mando en MANDO.`,
    "",
    "Este correo es solo un aviso. No necesitas hacer nada.",
    "",
    "MANDO · control de eventos en vivo",
  ].join("\n");
  return { subject, body };
}

/** Enlace para avisar desde el correo propio, cuando MANDO no tiene un buzón configurado para enviar. */
export function copyMailto(emails: string[], n: CopyNotice): string {
  const { subject, body } = copyNotice(n);
  return `mailto:?bcc=${emails.map(encodeURIComponent).join(",")}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
