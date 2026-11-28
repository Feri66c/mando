import "server-only";

// Avatar con IA (decisión 96): desde la foto de la persona se dibuja su personaje MANDO con el servicio
// de imágenes de OpenAI. La clave vive en Vercel (OPENAI_API_KEY), nunca en el navegador.

export class AvatarUnavailable extends Error {}

export const AVATAR_STYLES = {
  heroe: "a polished 3D video-game character bust (modern console game style, soft studio lighting)",
  comic: "a bold modern comic-book illustration with clean ink lines and flat colors",
  pixel: "a crisp retro pixel-art portrait (32-bit era game style)",
} as const;
export type AvatarStyle = keyof typeof AVATAR_STYLES;
export const isAvatarStyle = (v: string): v is AvatarStyle => v in AVATAR_STYLES;

export function avatarReady(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function prompt(style: AvatarStyle): string {
  return [
    `Turn the person in this photo into ${AVATAR_STYLES[style]}.`,
    "Keep them clearly recognizable: same face shape, skin tone, hair, facial hair and glasses if any.",
    "They are a live-event production crew member: black crew jacket and a slim headset with microphone.",
    "Confident, friendly expression, looking at the camera, head and shoulders, centered.",
    "Background: very dark near-black navy with a subtle neon yellow (#ffd60a) rim light on one side and cyan (#3dd6ff) on the other.",
    "No text, no letters, no logos, no watermark. Square framing.",
  ].join(" ");
}

/** Dibuja el avatar. Devuelve un PNG. */
export async function drawAvatar(photo: Blob, fileName: string, style: AvatarStyle): Promise<Buffer> {
  if (!avatarReady()) throw new AvatarUnavailable("Falta conectar el servicio de imágenes: pega OPENAI_API_KEY en Vercel.");
  const body = new FormData();
  body.append("model", process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1");
  body.append("image", photo, fileName);
  body.append("prompt", prompt(style));
  body.append("size", "1024x1024");
  body.append("quality", "medium");
  body.append("n", "1");
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}` },
      body,
      signal: AbortSignal.timeout(150_000),
    });
  } catch {
    throw new Error("El servicio de imágenes tardó demasiado. Intenta de nuevo en un minuto.");
  }
  if (res.status === 401 || res.status === 403) {
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (/verif/i.test(detail?.error?.message ?? "")) {
      throw new AvatarUnavailable("Tu cuenta de OpenAI todavía no está habilitada para crear imágenes. Hay que verificar la organización en platform.openai.com.");
    }
    throw new AvatarUnavailable("La clave del servicio de imágenes no funciona. Revísala en Vercel.");
  }
  if (res.status === 429) throw new Error("El servicio de imágenes está muy pedido o sin saldo. Revisa el saldo en platform.openai.com.");
  if (res.status === 400) throw new Error("El servicio no pudo usar esa foto. Prueba con otra donde se vea bien la cara.");
  if (!res.ok) throw new Error("El servicio de imágenes no respondió bien. Intenta de nuevo.");
  const data = (await res.json().catch(() => null)) as { data?: { b64_json?: string }[] } | null;
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("El servicio no devolvió el avatar. Intenta de nuevo.");
  return Buffer.from(b64, "base64");
}
