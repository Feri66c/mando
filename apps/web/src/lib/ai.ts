import "server-only";

// La IA de MANDO (decisión 85). Solo corre en el servidor: la clave vive en Vercel (ANTHROPIC_API_KEY)
// y nunca llega al teléfono. Cada pedido pide una respuesta JSON con forma fija, así la pantalla
// recibe lo mismo que ya recibía de la base sin IA.

import Anthropic from "@anthropic-ai/sdk";

export const AI_MODEL = "claude-opus-5-5";

export class AiUnavailable extends Error {}

export function aiReady(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!aiReady()) throw new AiUnavailable("La IA de MANDO aún no está conectada.");
  client ??= new Anthropic();
  return client;
}

/** Pide a la IA una respuesta que cumple el esquema JSON y la devuelve ya leída. */
export async function askJson<T>({
  system,
  prompt,
  schema,
  maxTokens = 4000,
}: {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  const ai = getClient();
  let response;
  try {
    response = await ai.beta.messages.create(
      {
        model: AI_MODEL,
        max_tokens: maxTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: { effort: "low", format: { type: "json_schema", schema } },
      },
      { timeout: 60_000 },
    );
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
      throw new AiUnavailable("La clave de la IA no funciona. Revísala en Vercel.");
    if (e instanceof Anthropic.RateLimitError) throw new Error("La IA está muy pedida en este momento. Intenta en un minuto.");
    if (e instanceof Anthropic.BadRequestError && /credit|balance|billing/i.test(e.message))
      throw new AiUnavailable("La cuenta de la IA se quedó sin saldo. Recárgala en console.anthropic.com.");
    if (e instanceof Anthropic.APIConnectionError) throw new Error("No se pudo hablar con la IA. Intenta de nuevo.");
    if (e instanceof Anthropic.APIError) throw new Error("La IA no pudo responder. Intenta de nuevo.");
    throw e;
  }
  if (response.stop_reason === "refusal") throw new Error("La IA no quiso responder a ese texto. Revísalo e intenta de nuevo.");
  if (response.stop_reason === "max_tokens") throw new Error("La respuesta de la IA salió incompleta. Intenta con un texto más corto.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("La IA respondió algo que no se pudo leer. Intenta de nuevo.");
  }
}
