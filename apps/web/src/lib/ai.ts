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
  attachments = [],
  timeoutMs = 60_000,
}: {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  /** Documentos o imágenes que la IA lee antes del pedido (PDF, fotos de noticias…). */
  attachments?: Attachment[];
  timeoutMs?: number;
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
        messages: [{ role: "user", content: [...attachments.map(toBlock), { type: "text", text: prompt }] }],
        output_config: { effort: "low", format: { type: "json_schema", schema } },
      },
      { timeout: timeoutMs },
    );
  } catch (e) {
    throw friendlyError(e);
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

export type Attachment = { kind: "pdf" | "image"; mediaType: string; data: string; name: string };

function toBlock(a: Attachment): Anthropic.Beta.BetaContentBlockParam {
  if (a.kind === "pdf")
    return { type: "document", title: a.name.slice(0, 200), source: { type: "base64", media_type: "application/pdf", data: a.data } };
  return { type: "image", source: { type: "base64", media_type: a.mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: a.data } };
}

function friendlyError(e: unknown): unknown {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
    return new AiUnavailable("La clave de la IA no funciona. Revísala en Vercel.");
  if (e instanceof Anthropic.RateLimitError) return new Error("La IA está muy pedida en este momento. Intenta en un minuto.");
  if (e instanceof Anthropic.BadRequestError && /credit|balance|billing/i.test(e.message))
    return new AiUnavailable("La cuenta de la IA se quedó sin saldo. Recárgala en console.anthropic.com.");
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new Error("La IA tardó demasiado. Intenta de nuevo.");
  if (e instanceof Anthropic.APIConnectionError) return new Error("No se pudo hablar con la IA. Intenta de nuevo.");
  if (e instanceof Anthropic.APIError) return new Error("La IA no pudo responder. Intenta de nuevo.");
  return e;
}

/**
 * Busca en internet lo que el brief necesita verificar (por ejemplo, noticias del local o permisos)
 * y devuelve apuntes en texto con sus fuentes. Si la búsqueda falla, devuelve "" y el proceso sigue.
 */
export async function researchNotes({ system, prompt, maxSearches = 5 }: { system: string; prompt: string; maxSearches?: number }): Promise<string> {
  const ai = getClient();
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  try {
    for (let turn = 0; turn < 3; turn++) {
      const response = await ai.beta.messages.create(
        {
          model: AI_MODEL,
          max_tokens: 6000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system,
          messages,
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: maxSearches }],
          output_config: { effort: "low" },
        },
        { timeout: 90_000 },
      );
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }
      if (response.stop_reason === "refusal") return "";
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
      const sources = new Set<string>();
      for (const b of response.content)
        if (b.type === "web_search_tool_result" && Array.isArray(b.content))
          for (const r of b.content) if (r.type === "web_search_result") sources.add(`${r.title} — ${r.url}`);
      return [text, sources.size ? `Fuentes consultadas:\n${[...sources].slice(0, 12).join("\n")}` : ""].filter(Boolean).join("\n\n");
    }
    return "";
  } catch (e) {
    const f = friendlyError(e);
    if (f instanceof AiUnavailable) throw f;
    return "";
  }
}
