"use client";

import { useState } from "react";
import { buttonGhost, buttonPrimary, buttonSecondary } from "./ui";

/** Compartir el minuto a minuto: PDF (imprimir), WhatsApp o copiar el texto. */
export function ShareMinute({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="no-imprimir grid gap-2 sm:grid-cols-3">
      <button type="button" onClick={() => window.print()} className={buttonPrimary}>
        Guardar como PDF
      </button>
      <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className={buttonSecondary}>
        Enviar por WhatsApp
      </a>
      <button type="button" onClick={copy} className={buttonGhost} aria-live="polite">
        {copied ? "Copiado" : "Copiar el texto"}
      </button>
    </div>
  );
}
