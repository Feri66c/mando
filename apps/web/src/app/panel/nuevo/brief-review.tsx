"use client";

import { useState, useTransition } from "react";
import { reviseBrief } from "@/app/actions/ia";
import { playTap } from "@/components/operacion/pieza";
import { inputClass } from "@/components/operacion/ui";
import { customModule } from "@mando/core/custom-event";
import { MicIcon, useDictation } from "./use-dictation";
import { AudioUpload } from "./audio-upload";

const name = (k: string) => customModule(k)?.nombre ?? k;

/** El mensaje que viaja por WhatsApp: el brief y la pregunta de qué corregir. */
export function reviewMessage(typeName: string, brief: string): string {
  const title = typeName.trim() ? `«${typeName.trim()}»` : "nuestro evento";
  return (
    `Hola, te comparto el brief de ${title}. Revísalo y respóndeme por aquí, con texto o audio: ` +
    `qué falta, qué sobra o estoy exagerando, y qué no entendí bien.\n\n${brief.trim()}`
  );
}

/**
 * Ronda de revisión del brief: se manda por WhatsApp o se copia, y lo que respondan
 * (pegado o dictado) vuelve a la IA, que corrige el brief y ajusta los componentes.
 */
export function BriefReview({
  typeName,
  brief,
  selected,
  onBrief,
  onAdd,
  onRemove,
}: {
  typeName: string;
  brief: string;
  selected: ReadonlySet<string>;
  onBrief: (v: string) => void;
  onAdd: (keys: string[]) => void;
  onRemove: (keys: string[]) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState<{
    n: number;
    changes: string[];
    add: { clave: string; palabra: string }[];
    remove: { clave: string; palabra: string }[];
  } | null>(null);
  const [revising, startRevising] = useTransition();
  const dictation = useDictation();
  const message = reviewMessage(typeName, brief);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("No se pudo copiar. Selecciona el brief y cópialo a mano.");
    }
  }

  function toggleMic() {
    playTap(dictation.listening ? "down" : "up");
    if (!dictation.listening) return dictation.start();
    const said = dictation.stop();
    if (said) setFeedback((prev) => `${prev.trim()} ${said}`.trim());
  }

  function revise(text = feedback) {
    playTap("up");
    setError(null);
    startRevising(async () => {
      const r = await reviseBrief({ brief, feedback: text, typeName, selected: [...selected] });
      if (!r.ok) return setError(r.error);
      onBrief(r.brief);
      if (r.add.length) onAdd(r.add.map((a) => a.clave));
      if (r.remove.length) onRemove(r.remove.map((a) => a.clave));
      setRound((prev) => ({ n: (prev?.n ?? 0) + 1, changes: r.changes, add: r.add, remove: r.remove }));
      setFeedback("");
    });
  }

  if (!brief.trim()) return null;
  const live = `${dictation.heard.final} ${dictation.heard.interim}`.trim();

  return (
    <section aria-label="Revisión del brief" className="revision">
      <p className="bloque-titulo">Revisión con tu equipo o el cliente</p>
      <p className="text-sm text-ink-muted">
        Mándalo a revisar. Lo que te respondan lo pegas o lo dictas abajo y la IA corrige el brief.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noreferrer"
          className="revision-accion"
          onClick={() => playTap("up")}
        >
          Enviar por WhatsApp
        </a>
        <button type="button" className="revision-accion" onClick={copy}>
          {copied ? "¡Copiado!" : "Copiar el brief"}
        </button>
      </div>

      <label htmlFor="respuesta-revision" className="mt-2 block text-base font-semibold">
        Lo que te respondieron
      </label>
      <div className="revision-caja">
        <textarea
          id="respuesta-revision"
          rows={4}
          maxLength={10000}
          value={dictation.listening && live ? `${feedback} ${live}`.trim() : feedback}
          onChange={(e) => setFeedback(e.target.value)}
          readOnly={dictation.listening}
          placeholder="Ejemplo: el cliente también pide un photocall y quita el DJ. O pega aquí la transcripción del audio de WhatsApp."
          className={`${inputClass} py-2 text-base`}
        />
        {dictation.supported && (
          <button
            type="button"
            className="revision-mic"
            data-escucha={dictation.listening ? "" : undefined}
            aria-pressed={dictation.listening}
            aria-label={dictation.listening ? "Terminar de dictar" : "Dictar lo que te respondieron"}
            onClick={toggleMic}
          >
            <MicIcon size={22} />
          </button>
        )}
      </div>
      <AudioUpload
        label="Subir el audio que te mandaron"
        disabled={revising || dictation.listening}
        onText={(text) => {
          // El audio se escribe en la caja y la IA corrige el brief de una vez.
          const all = `${feedback.trim()} ${text}`.trim();
          setFeedback(all);
          revise(all);
        }}
      />
      <p className="text-xs text-ink-muted">
        En el iPhone: en WhatsApp mantén presionado el audio, toca Reenviar, luego Compartir y «Guardar en Archivos». Después elígelo aquí.
      </p>
      {dictation.error && (
        <p role="alert" className="text-sm text-[#ff6f86]">
          {dictation.error}
        </p>
      )}
      <button
        type="button"
        className="leer-brief"
        disabled={revising || dictation.listening || feedback.trim().length < 5}
        onClick={() => revise()}
      >
        {revising ? "La IA está corrigiendo el brief…" : "Corregir el brief con esto"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-[#ff6f86]">
          {error}
        </p>
      )}
      {round && (
        <div aria-live="polite" className="revision-cambios">
          <p className="font-semibold text-ink">Ronda {round.n}: así cambió el brief</p>
          {round.changes.length > 0 ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {round.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1">La IA no encontró nada que cambiar.</p>
          )}
          {round.add.length > 0 && (
            <p className="mt-2">
              <span className="font-semibold text-ink">Sumé:</span> {round.add.map((a) => `${name(a.clave)} (${a.palabra})`).join(", ")}.
            </p>
          )}
          {round.remove.length > 0 && (
            <p className="mt-1">
              <span className="font-semibold text-ink">Quité:</span> {round.remove.map((a) => `${name(a.clave)} (${a.palabra})`).join(", ")}.
            </p>
          )}
          <p className="mt-2">Revisa el brief arriba. Puedes mandarlo de nuevo y repetir.</p>
        </div>
      )}
    </section>
  );
}
