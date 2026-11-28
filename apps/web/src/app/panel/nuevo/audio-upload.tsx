"use client";

import { useRef, useState, useTransition } from "react";
import { transcribeAudio } from "@/app/actions/ia";
import { playTap } from "@/components/operacion/pieza";

const MAX_BYTES = 4 * 1024 * 1024;

/** «Subir audio»: una nota de voz de WhatsApp se convierte en texto y sigue a la IA. */
export function AudioUpload({ label, busyLabel, onText, disabled }: { label: string; busyLabel?: string; onText: (text: string) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [working, startWorking] = useTransition();

  function pick(file: File | null) {
    if (input.current) input.current.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) return setError("El audio pesa más de 4 MB. Mándalo en partes más cortas.");
    setName(file.name);
    const fd = new FormData();
    fd.append("audio", file);
    startWorking(async () => {
      const r = await transcribeAudio(fd);
      if (!r.ok) return setError(r.error);
      onText(r.text);
    });
  }

  return (
    <div className="space-y-1">
      <input
        ref={input}
        type="file"
        accept="audio/*,.opus,.ogg,.oga,.m4a,.mp3,.wav,.aac,.amr,.caf,.webm"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        className="subir-audio"
        disabled={disabled || working}
        onClick={() => {
          playTap("up");
          input.current?.click();
        }}
      >
        <svg aria-hidden viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 11v2" />
        </svg>
        {working ? (busyLabel ?? `Escuchando ${name ?? "el audio"}…`) : label}
      </button>
      {error && (
        <p role="alert" className="text-sm text-[#ff6f86]">
          {error}
        </p>
      )}
    </div>
  );
}
