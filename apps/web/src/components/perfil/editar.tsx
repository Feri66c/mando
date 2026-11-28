"use client";

// «Mi perfil» (decisión 96): foto, avatar con IA, qué se muestra y modo de pantalla.

import { useRef, useState, useTransition } from "react";
import { createAvatarAction, setLookAction, setPhotoAction } from "@/app/actions/perfil";
import type { CierreState } from "@/app/actions/cierre";
import { profileFilePath } from "@mando/core/command";
import { DISPLAY_MODES, type DisplayMode } from "@mando/core/data";
import { getBrowserClient } from "@/lib/supabase/browser";
import { buttonPrimary, buttonSecondary } from "@/components/operacion/ui";
import { playTap } from "@/components/operacion/pieza";
import { MODE_COOKIE } from "@/lib/modo";

const INITIAL: CierreState = { ok: false, error: null };
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

function Feedback({ state }: { state: CierreState }) {
  if (state.error)
    return (
      <p role="alert" className="mt-2 border border-critical/40 bg-critical/10 px-3 py-2 text-sm">
        {state.error}
      </p>
    );
  if (state.ok && state.message)
    return (
      <p role="status" className="mt-2 text-sm text-ok">
        {state.message}
      </p>
    );
  return null;
}

const isHeic = (file: File) => /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

/** Abre la imagen para dibujarla. Safari abre HEIC solo; en Chrome la foto del iPhone (HEIC) se convierte antes. */
async function decode(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

/** Achica la foto en el navegador antes de subirla: 1024 px de lado y JPG. Así sube rápido con poca señal. */
async function shrink(file: File): Promise<Blob> {
  let source: Blob = file;
  let image: Awaited<ReturnType<typeof decode>>;
  try {
    image = await decode(source);
  } catch {
    if (!isHeic(file)) return file;
    const { heicTo } = await import("heic-to");
    image = await heicTo({ blob: file, type: "bitmap" });
    source = file;
  }
  const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.88));
  return blob ?? source;
}

/** Subir la foto de una persona: la propia o, si eres el backend, la de alguien de tu equipo. */
export function PhotoUpload({ profileId, label = "Subir foto", compact = false }: { profileId: string; label?: string; compact?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<CierreState & { working?: string }>(INITIAL);

  async function upload(file: File) {
    try {
      if (!/^image\/(png|jpe?g|webp|heic|heif)$/i.test(file.type) && !/\.(png|jpe?g|webp|heic|heif)$/i.test(file.name)) {
        throw new Error("Elige una foto (JPG, PNG, WebP o la del iPhone).");
      }
      if (file.size > MAX_PHOTO_BYTES * 3) throw new Error("La foto es muy pesada. Elige otra.");
      setState({ ...INITIAL, working: "Preparando la foto…" });
      const blob = await shrink(file).catch((e: unknown) => {
        console.error("[MANDO] foto", file.type, file.name, e);
        throw new Error("No pude abrir esa foto del iPhone. Prueba en Safari, o envíatela por WhatsApp y súbela desde ahí (llega como JPG).");
      });
      if (blob.size > MAX_PHOTO_BYTES) throw new Error("La foto pesa más de 8 MB. Elige otra.");
      const isJpg = blob.type === "image/jpeg";
      const path = profileFilePath(profileId, crypto.randomUUID(), isJpg ? "foto.jpg" : file.name);
      if (!path) throw new Error("No pude convertir esa foto. Prueba con otra.");
      const supabase = getBrowserClient();
      if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
      setState({ ...INITIAL, working: "Subiendo…" });
      const { error } = await supabase.storage.from("evidences").upload(path, blob, { contentType: blob.type || file.type, upsert: false });
      if (error) throw new Error(/row-level|policy|permission/i.test(error.message) ? "No tienes permiso para poner esta foto." : `No se pudo subir: ${error.message}`);
      setState(await setPhotoAction({ profileId, path }));
    } catch (e) {
      setState({ ok: false, error: e instanceof Error ? e.message : "No se pudo subir la foto." });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <button
        type="button"
        disabled={Boolean(state.working)}
        onClick={() => {
          playTap("up");
          fileRef.current?.click();
        }}
        className={compact ? "min-h-11 px-2 text-sm font-medium text-ice-300 underline underline-offset-4" : `${buttonSecondary} w-full`}
      >
        {state.working ?? label}
      </button>
      <Feedback state={state} />
    </div>
  );
}

const STYLES = [
  { clave: "heroe", nombre: "Héroe 3D" },
  { clave: "comic", nombre: "Cómic" },
  { clave: "pixel", nombre: "Pixel" },
];

/** Crear el avatar con IA desde la foto, y elegir qué se muestra. */
export function AvatarMaker({ hasPhoto, hasAvatar, showAvatar }: { hasPhoto: boolean; hasAvatar: boolean; showAvatar: boolean }) {
  const [style, setStyle] = useState("heroe");
  const [state, setState] = useState<CierreState>(INITIAL);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Estilo del avatar" className="grid grid-cols-3 gap-2">
        {STYLES.map((s) => (
          <button
            key={s.clave}
            type="button"
            role="radio"
            aria-checked={style === s.clave}
            onClick={() => {
              playTap("up");
              setStyle(s.clave);
            }}
            className="modo-opcion min-h-12 px-2 text-sm font-semibold"
            data-on={style === s.clave ? "" : undefined}
          >
            {s.nombre}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={!hasPhoto || pending}
        onClick={() => {
          playTap("up");
          setState(INITIAL);
          start(async () => setState(await createAvatarAction(style)));
        }}
        className={`${buttonPrimary} w-full`}
      >
        {pending ? "Dibujando tu avatar… (hasta 1 minuto)" : hasAvatar ? "Crear otro avatar" : "Crear mi avatar con IA"}
      </button>
      {!hasPhoto && <p className="text-sm text-ink-muted">Primero sube tu foto: el avatar se crea a partir de ella.</p>}
      {hasAvatar && (
        <div role="radiogroup" aria-label="Qué se muestra" className="grid grid-cols-2 gap-2">
          {[
            { v: false, n: "Mostrar mi foto" },
            { v: true, n: "Mostrar mi avatar" },
          ].map((o) => (
            <button
              key={String(o.v)}
              type="button"
              role="radio"
              aria-checked={showAvatar === o.v}
              data-on={showAvatar === o.v ? "" : undefined}
              disabled={pending}
              onClick={() => {
                playTap("up");
                start(async () => setState(await setLookAction({ showAvatar: o.v })));
              }}
              className="modo-opcion min-h-12 px-2 text-sm font-semibold"
            >
              {o.n}
            </button>
          ))}
        </div>
      )}
      <Feedback state={state} />
    </div>
  );
}

/** Neón, Sol o Sobrio. Cambia al instante y queda guardado. */
export function ModePicker({ mode }: { mode: DisplayMode }) {
  const [current, setCurrent] = useState<DisplayMode>(mode);
  const [state, setState] = useState<CierreState>(INITIAL);
  const [, start] = useTransition();

  return (
    <div>
      <div role="radiogroup" aria-label="Modo de pantalla" className="grid gap-2 sm:grid-cols-3">
        {DISPLAY_MODES.map((m) => (
          <button
            key={m.clave}
            type="button"
            role="radio"
            aria-checked={current === m.clave}
            data-on={current === m.clave ? "" : undefined}
            data-muestra={m.clave}
            onClick={() => {
              playTap("up");
              setCurrent(m.clave);
              document.documentElement.dataset.modo = m.clave;
              document.cookie = `${MODE_COOKIE}=${m.clave}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
              start(async () => setState(await setLookAction({ mode: m.clave })));
            }}
            className="modo-opcion min-h-24 p-3 text-left"
          >
            <span className="block font-display text-xl font-bold uppercase tracking-wide">{m.nombre}</span>
            <span className="mt-1 block text-sm opacity-80">{m.detalle}</span>
          </button>
        ))}
      </div>
      <Feedback state={state} />
    </div>
  );
}
