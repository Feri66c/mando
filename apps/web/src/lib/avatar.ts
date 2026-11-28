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

const PREFERRED = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini", "chatgpt-image-latest"];
const key = () => process.env.OPENAI_API_KEY!.trim();

/** Modelos de imagen que esta cuenta de OpenAI sí puede usar, del mejor al más simple. */
async function imageModels(): Promise<string[]> {
  const override = process.env.OPENAI_IMAGE_MODEL?.trim();
  let available: string[] = [];
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key()}` },
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => null)) as { data?: { id: string }[] } | null;
    available = (data?.data ?? []).map((m) => m.id).filter((id) => /image/i.test(id) && !/dall-e/i.test(id));
  } catch {
    // Si no se puede listar, se prueba con la lista conocida.
  }
  const rank = (id: string) => {
    const i = PREFERRED.indexOf(id);
    return i === -1 ? PREFERRED.length : i;
  };
  const ordered = available.length ? [...available].sort((a, b) => rank(a) - rank(b)) : PREFERRED;
  return [...new Set([...(override ? [override] : []), ...ordered])];
}

const isModelProblem = (status: number, msg: string) =>
  (status === 400 || status === 403 || status === 404) && /model|does not exist|not found|verif|access/i.test(msg);

/** Dibuja el avatar. Prueba los modelos de imagen de la cuenta hasta que uno responda. Devuelve un PNG. */
export async function drawAvatar(photo: Blob, fileName: string, style: AvatarStyle): Promise<Buffer> {
  if (!avatarReady()) throw new AvatarUnavailable("Falta conectar el servicio de imágenes: pega OPENAI_API_KEY en Vercel.");
  // El servicio exige el tipo exacto de la imagen; lo que baja del cubo a veces llega sin tipo.
  const ext = /\.(png|webp)$/i.exec(fileName)?.[1]?.toLowerCase();
  const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const image = new Blob([await photo.arrayBuffer()], { type });
  const name = ext ? fileName : fileName.replace(/\.[^.]*$/, "") + ".jpg";

  const tried: string[] = [];
  let needsVerification = false;
  for (const model of (await imageModels()).slice(0, 5)) {
    const body = new FormData();
    body.append("model", model);
    body.append("image", image, name);
    body.append("prompt", prompt(style));
    body.append("size", "1024x1024");
    body.append("quality", "medium");
    body.append("n", "1");
    let res: Response;
    try {
      res = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${key()}` },
        body,
        signal: AbortSignal.timeout(150_000),
      });
    } catch {
      throw new Error("El servicio de imágenes tardó demasiado. Intenta de nuevo en un minuto.");
    }
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as { data?: { b64_json?: string }[] } | null;
      const b64 = data?.data?.[0]?.b64_json;
      if (!b64) throw new Error("El servicio no devolvió el avatar. Intenta de nuevo.");
      return Buffer.from(b64, "base64");
    }
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
    const msg = `${detail?.error?.message ?? ""} ${detail?.error?.code ?? ""}`.trim();
    console.error("[MANDO] avatar", model, res.status, msg);
    if (isModelProblem(res.status, msg)) {
      tried.push(model);
      if (/verif/i.test(msg)) needsVerification = true;
      continue; // este modelo no está habilitado para la cuenta: se prueba el siguiente
    }
    if (res.status === 401) throw new AvatarUnavailable("La clave del servicio de imágenes no funciona. Revísala en Vercel.");
    if (res.status === 429) throw new Error("El servicio de imágenes está muy pedido o sin saldo. Revisa el saldo en platform.openai.com.");
    if (/safety|moderation/i.test(msg)) {
      throw new Error("El filtro de seguridad del servicio rechazó esta foto. Prueba otro estilo, o una foto de frente ante una pared lisa, sin espejos ni otras personas.");
    }
    if (res.status === 400) {
      throw new Error(`El servicio no pudo usar esa foto. Prueba con una de frente, ante una pared lisa y con buena luz. (Detalle: ${msg.slice(0, 140) || "sin detalle"})`);
    }
    throw new Error("El servicio de imágenes no respondió bien. Intenta de nuevo.");
  }
  throw new AvatarUnavailable(
    needsVerification || tried.length
      ? "Tu cuenta de OpenAI todavía no tiene habilitados los modelos de imagen. Entra a platform.openai.com → Settings → Organization → General y toca «Verify Organization». Al terminar, vuelve a intentar."
      : "No encontré un modelo de imágenes en tu cuenta de OpenAI.",
  );
}
