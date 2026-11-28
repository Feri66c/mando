import "server-only";
import nodemailer from "nodemailer";

/**
 * Correo saliente de MANDO: invitaciones y avisos «con copia» salen directo, sin abrir Mail ni Outlook.
 * Usa el buzón de MANDO por SMTP (el mismo Gmail que ya manda los códigos de ingreso).
 * Variables en Vercel: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS y, opcional, SMTP_FROM.
 * Si faltan, `canSendMail()` es falso y la pantalla ofrece mandarlo desde el correo propio.
 */
export const canSendMail = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

/** El buzón de MANDO: recibe copia oculta de todo lo que sale, como acuse. */
export const mandoMailbox = () => String(process.env.SMTP_USER ?? "");

export async function sendMail({ to, bcc = [], subject, text }: { to: string[]; bcc?: string[]; subject: string; text: string }): Promise<boolean> {
  if (!canSendMail() || to.length === 0) return false;
  try {
    const port = Number(process.env.SMTP_PORT ?? 465);
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 8000,
      socketTimeout: 10000,
    });
    const from = process.env.SMTP_FROM || `MANDO <${process.env.SMTP_USER}>`;
    await transport.sendMail({ from, to, bcc: bcc.filter((b) => b && !to.includes(b)), subject, text });
    return true;
  } catch (e) {
    console.error("[mando] no se pudo mandar el correo", e instanceof Error ? e.message : e);
    return false;
  }
}
