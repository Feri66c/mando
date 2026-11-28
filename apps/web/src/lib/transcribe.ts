import "server-only";

// Audios a texto (decisión 88): los audios de WhatsApp se transcriben con el servicio de OpenAI
// y el texto sigue a la IA de MANDO. La clave vive en Vercel (OPENAI_API_KEY), nunca en el navegador.

export const AUDIO_MAX_BYTES = 4 * 1024 * 1024; // Vercel acepta hasta ~4,5 MB por pedido: unos 30 minutos de audio de WhatsApp
const AUDIO_TYPES = /\.(opus|ogg|oga|m4a|mp3|mp4|mpeg|mpga|wav|webm|aac|amr|caf)$/i;

export class TranscribeUnavailable extends Error {}

export function transcribeReady(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/** Revisa el archivo antes de mandarlo. Devuelve el problema o null. */
export function checkAudio(file: File): string | null {
  if (!file || file.size === 0) return "Elige un audio.";
  if (!AUDIO_TYPES.test(file.name) && !file.type.startsWith("audio/")) return "Ese archivo no es un audio. Elige el audio de WhatsApp (.opus, .m4a, .mp3…).";
  if (file.size > AUDIO_MAX_BYTES) return "El audio pesa más de 4 MB. Mándalo en partes más cortas.";
  return null;
}

/** Convierte el audio en texto en español. */
export async function transcribe(file: File): Promise<string> {
  if (!transcribeReady()) throw new TranscribeUnavailable("Falta conectar el servicio de audio: pega OPENAI_API_KEY en Vercel.");
  // WhatsApp guarda las notas de voz como .opus (formato ogg): con ese nombre el servicio las reconoce.
  const fileName = file.name.replace(/\.(opus|oga)$/i, ".ogg") || "audio.ogg";
  const body = new FormData();
  body.append("file", new File([await file.arrayBuffer()], fileName, { type: file.type || "audio/ogg" }));
  body.append("model", process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || "whisper-1");
  body.append("language", "es");
  body.append("response_format", "json");
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}` },
      body,
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new Error("No se pudo hablar con el servicio de audio. Intenta de nuevo.");
  }
  if (res.status === 401 || res.status === 403) throw new TranscribeUnavailable("La clave del servicio de audio no funciona. Revísala en Vercel.");
  if (res.status === 429) throw new Error("El servicio de audio está muy pedido o sin saldo. Revisa el saldo en platform.openai.com e intenta en un minuto.");
  if (!res.ok) throw new Error("El servicio de audio no pudo leer ese archivo. Prueba con otro formato o un audio más corto.");
  const data = (await res.json().catch(() => null)) as { text?: string } | null;
  const text = String(data?.text ?? "").trim();
  if (!text) throw new Error("No se escuchó nada en ese audio.");
  return text;
}
