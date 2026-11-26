"use client";

// Banco de talentos (decisiones 55 a 58): buscar y filtrar, registrar con su ficha, pasar al casting
// con un toque e ingresar la lista de una castinera.

import { useActionState, useMemo, useRef, useState } from "react";
import type { CierreState } from "@/app/actions/cierre";
import { addCastingFromTalentAction, importTalentsAction, saveTalentAction, type ImportState } from "@/app/actions/talentos";
import { DOC_TYPES, cleanDocNumber, docType } from "@mando/core/casting";
import { MAX_EVIDENCE_BYTES, personFilePath } from "@mando/core/evidence";
import { categoryLabel, filterTalents, readTalentCsv, type Talent, type TalentImport as Parsed } from "@mando/core/talents";
import { getBrowserClient } from "@/lib/supabase/browser";
import { FichaFields, FichaView, NextSteps, readFicha } from "./mando";
import { buttonGhost, buttonPrimary, buttonSecondary, inputClass } from "./ui";

const INITIAL: CierreState = { ok: false, error: null };
type Working = CierreState & { working?: string };

function Feedback({ state }: { state: Working }) {
  if (state.working)
    return (
      <p role="status" className="mt-2 text-sm text-ink-muted">
        {state.working}
      </p>
    );
  if (state.error)
    return (
      <p role="alert" className="mt-2 rounded-2xl bg-[#3a1620] px-3 py-2 text-sm text-[#ffd3c9]">
        {state.error}
      </p>
    );
  if (state.ok && state.message)
    return (
      <p role="status" className="mt-2 text-sm text-[#8fe0b8]">
        {state.message}
      </p>
    );
  return null;
}

const chip = (on: boolean) =>
  `inline-flex min-h-11 items-center justify-center rounded-full border px-4 text-sm font-semibold ${on ? "border-gold-300 bg-gold-300 text-navy-950" : "border-line text-ink"}`;

function ToCasting({ eventId, talent }: { eventId: string; talent: Talent }) {
  const [state, action, pending] = useActionState(addCastingFromTalentAction, INITIAL);
  if (talent.inCasting || state.ok)
    return <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#8fe0b8]">✓ En el casting de este evento</p>;
  return (
    <form action={action}>
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="person_id" value={talent.id} />
      <button type="submit" disabled={pending} aria-label={`Sumar al casting: ${talent.fullName}`} className={buttonSecondary}>
        {pending ? "Sumando…" : "Sumar al casting"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/** El banco: categorías arriba, buscador y una tarjeta por persona con su foto y su mini ficha. */
export function TalentBank({ eventId, talents, categories, canCast }: { eventId: string; talents: Talent[]; categories: string[]; canCast: boolean }) {
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(24);
  const found = useMemo(() => filterTalents(talents, category, query), [talents, category, query]);
  const count = (c: string) => talents.filter((t) => t.categories.includes(c)).length;
  return (
    <div>
      <div role="group" aria-label="Categorías" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={category === ""} onClick={() => setCategory("")} className={chip(category === "")}>
          Todos <span className="ml-1.5 font-mono">{talents.length}</span>
        </button>
        {categories.map((c) => (
          <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(category === c ? "" : c)} className={chip(category === c)}>
            {categoryLabel(c)} <span className="ml-1.5 font-mono">{count(c)}</span>
          </button>
        ))}
      </div>
      <label htmlFor="talento-buscar" className="sr-only">
        Buscar en el banco
      </label>
      <input
        id="talento-buscar"
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setShown(24);
        }}
        placeholder="Busca por nombre, documento, talla o habilidad"
        className={`${inputClass} mt-3`}
      />
      <p className="mt-2 font-mono text-xs text-ink-muted" role="status">
        {found.length} de {talents.length}
      </p>
      {found.length === 0 ? (
        <p className="mt-2 rounded-card border border-dashed border-line p-4 text-sm text-ink-muted">{talents.length === 0 ? "Tu banco todavía está vacío. Registra a alguien abajo o ingresa una lista." : "Nadie coincide con esa búsqueda."}</p>
      ) : (
        <ul aria-label="Banco de talentos" className="mt-2 grid gap-2">
          {found.slice(0, shown).map((t) => (
            <li key={t.id} className="rounded-card bg-surface-100 p-4">
              <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                {t.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- enlace firmado de corta duración
                  <img src={t.photoUrl} alt={`Foto de ${t.fullName}`} className="h-32 w-24 shrink-0 bg-surface-200 object-cover" />
                ) : (
                  <div aria-hidden="true" className="grid h-32 w-24 shrink-0 place-items-center bg-surface-200 font-mono text-[10px] text-ink-muted">
                    sin foto
                  </div>
                )}
                <div className="min-w-[9rem] flex-1">
                  <p className="font-display text-lg font-bold leading-tight">{t.fullName}</p>
                  <p className="mt-0.5 font-mono text-xs text-ink-muted">
                    {t.docNumber ? `${docType(t.docType).nombre} ${t.docNumber}` : "Sin documento"}
                    {t.phone ? ` · ${t.phone}` : ""}
                  </p>
                  {t.categories.length > 0 && (
                    <p className="mt-1.5 flex flex-wrap gap-1.5">
                      {t.categories.map((c) => (
                        <span key={c} className="bg-surface-000 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-ice-300">
                          {categoryLabel(c)}
                        </span>
                      ))}
                    </p>
                  )}
                  <p className="mt-1.5 font-mono text-xs text-ink-muted">
                    {t.events === 0 ? "Aún sin eventos" : t.events === 1 ? "1 evento" : `${t.events} eventos`}
                    {!t.consent && <span className="text-gold-300"> · ◆ falta su autorización</span>}
                  </p>
                </div>
                <div className="w-full min-w-0 border-t border-line pt-3 sm:w-[44%] sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                  <FichaView profile={t.profile} />
                </div>
              </div>
              {canCast && (
                <div className="mt-3">
                  <ToCasting eventId={eventId} talent={t} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {found.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + 24)} className={`${buttonGhost} mt-3 w-full`}>
          Ver más ({found.length - shown})
        </button>
      )}
    </div>
  );
}

async function uploadPhoto(organizationId: string, file: File): Promise<string> {
  if (file.size > MAX_EVIDENCE_BYTES) throw new Error("La foto pesa más de 50 MB.");
  const supabase = getBrowserClient();
  if (!supabase) throw new Error("La app aún no está conectada a Supabase.");
  const path = personFilePath(organizationId, "foto", crypto.randomUUID(), file.name);
  const { error } = await supabase.storage.from("evidences").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (error) throw new Error(/row-level|policy|permission/i.test(error.message) ? "No tienes permiso para subir fotos aquí." : `No se pudo subir: ${error.message}`);
  return path;
}

/** Registrar un talento. Si su documento ya está en el banco, vuelve con sus datos y solo se actualiza. */
export function TalentForm({ eventId, organizationId, categories }: { eventId: string; organizationId: string; categories: string[] }) {
  const photoRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<Working>(INITIAL);
  const [round, setRound] = useState(0);
  const [type, setType] = useState("dni");
  const [number, setNumber] = useState("");
  const [extra, setExtra] = useState("");
  const busy = Boolean(state.working);
  const doc = docType(type);
  const short = number.length > 0 && number.length < doc.largo_min;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      const photo = photoRef.current?.files?.[0];
      if (photo) setState({ ...INITIAL, working: "Subiendo la foto…" });
      const photoPath = photo ? await uploadPhoto(organizationId, photo) : null;
      setState({ ...INITIAL, working: "Guardando…" });
      setState(
        await saveTalentAction({
          eventId,
          fullName: String(fd.get("nombre") ?? ""),
          docType: type,
          docNumber: number,
          categories: [...fd.getAll("categoria").map(String), ...extra.split(",")].map((c) => c.trim()).filter(Boolean),
          profile: readFicha(fd),
          phone: String(fd.get("telefono") ?? ""),
          photoPath,
          consent: fd.get("autoriza") === "si",
        }),
      );
    } catch (err) {
      setState({ ok: false, error: err instanceof Error ? err.message : "No se pudo guardar." });
    }
  }

  function next() {
    setState(INITIAL);
    setNumber("");
    setExtra("");
    setRound((r) => r + 1);
  }

  if (state.ok && state.message) return <NextSteps eventId={eventId} message={state.message} nextLabel="Siguiente talento" onNext={next} />;

  return (
    <form key={round} onSubmit={submit} className="grid gap-3">
      <div>
        <label htmlFor="t-nombre" className="block text-sm font-medium">
          Nombre y apellido
        </label>
        <input id="t-nombre" name="nombre" required maxLength={120} autoComplete="off" autoFocus={round > 0} className={`${inputClass} mt-1.5`} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="t-tipo" className="block text-sm font-medium">
            Documento
          </label>
          <select
            id="t-tipo"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setNumber(cleanDocNumber(e.target.value, number));
            }}
            className={`${inputClass} mt-1.5`}
          >
            {DOC_TYPES.map((d) => (
              <option key={d.clave} value={d.clave}>
                {d.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="t-doc" className="block text-sm font-medium">
            Número
          </label>
          <input
            id="t-doc"
            value={number}
            onChange={(e) => setNumber(cleanDocNumber(type, e.target.value))}
            inputMode={doc.solo_numeros ? "numeric" : "text"}
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={doc.largo_max}
            aria-describedby="t-doc-ayuda"
            aria-invalid={short}
            className={`${inputClass} mt-1.5 font-mono ${short ? "border-[#ff6f86]" : ""}`}
          />
        </div>
        <p id="t-doc-ayuda" className={`col-span-2 -mt-1.5 font-mono text-xs ${short ? "text-[#ff6f86]" : "text-ink-muted"}`}>
          {doc.ayuda} · {number.length} de {doc.largo_max}. Si ya está en tu banco, vuelve con sus datos.
        </p>
      </div>
      <fieldset>
        <legend className="block text-sm font-medium">Categorías</legend>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
          {categories.map((c) => (
            <label key={c} className="inline-flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="categoria" value={c} className="size-5 accent-[var(--gold-300)]" />
              {categoryLabel(c)}
            </label>
          ))}
        </div>
        <label htmlFor="t-otra" className="mt-2 block text-xs font-medium text-ink-muted">
          ＋ Agregar otra categoría
        </label>
        <input id="t-otra" value={extra} onChange={(e) => setExtra(e.target.value)} maxLength={60} placeholder="Escríbela aquí" className={`${inputClass} mt-1`} />
      </fieldset>
      <FichaFields uid={`talento-${round}`} />
      <div>
        <label htmlFor="t-tel" className="block text-sm font-medium">
          Celular
        </label>
        <input id="t-tel" name="telefono" type="tel" inputMode="tel" maxLength={30} className={`${inputClass} mt-1.5`} />
      </div>
      <div>
        <label htmlFor="t-foto" className="block text-sm font-medium">
          Foto real (basta una del celular, sin filtros)
        </label>
        <input ref={photoRef} id="t-foto" type="file" accept="image/*" className="mt-1.5 block w-full text-sm text-ink-muted file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-surface-200 file:px-4 file:text-sm file:font-semibold file:text-ink" />
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="autoriza" value="si" className="mt-0.5 size-5 accent-[var(--gold-300)]" />
        <span>Esta persona autorizó que guardemos sus datos y su foto para futuros castings.</span>
      </label>
      <button type="submit" disabled={busy || short} className={`${buttonPrimary} justify-self-start`}>
        {busy ? "Guardando…" : "Guardar en el banco"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/** «Ingresar CSV»: se elige la lista, MANDO muestra cuántas personas entran y cuáles no, y recién ahí se ingresa. */
export function TalentImport({ eventId, categories }: { eventId: string; categories: string[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [fileName, setFileName] = useState("");
  const [category, setCategory] = useState("");
  const [raw, setRaw] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<ImportState & { working?: string }>(INITIAL);

  async function pick(file: File | null) {
    setState(INITIAL);
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setState({ ok: false, error: "La lista pesa más de 2 MB. Guárdala como CSV, sin fotos." });
    const content = await file.text();
    setRaw(content);
    setFileName(file.name);
    setParsed(readTalentCsv(content, category));
  }

  function changeCategory(value: string) {
    setCategory(value);
    if (raw) setParsed(readTalentCsv(raw, value));
  }

  async function send() {
    if (!parsed) return;
    setState({ ...INITIAL, working: "Ingresando la lista…" });
    const result = await importTalentsAction({ eventId, rows: parsed.rows, consent });
    setState(result);
    if (result.ok) {
      setParsed(null);
      setRaw("");
      setConsent(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const skipped = state.result?.skipped ?? [];
  return (
    <div className="grid gap-3">
      <p className="text-sm text-ink-muted">
        Sube la lista de tu castinera en CSV (Excel: «Guardar como» → «CSV»). Lo mínimo es <strong className="text-ink">Nombre</strong> y{" "}
        <strong className="text-ink">Apellido</strong>; si trae Edad, Talla, DNI o Celular, también entran.
      </p>
      <div>
        <label htmlFor="csv-categoria" className="block text-sm font-medium">
          Entran al banco de
        </label>
        <select id="csv-categoria" value={category} onChange={(e) => changeCategory(e.target.value)} className={`${inputClass} mt-1.5`}>
          <option value="">La categoría que diga la lista</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </select>
      </div>
      <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="sr-only" tabIndex={-1} aria-label="Lista en CSV" onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => fileRef.current?.click()} className={buttonSecondary}>
          Ingresar CSV
        </button>
        <a href={`/eventos/${eventId}/talentos/exportar?plantilla=1`} className={buttonGhost}>
          Bajar plantilla
        </a>
      </div>
      {parsed && (
        <div className="rounded-card border border-line bg-surface-000 p-4 text-sm">
          <p className="font-mono text-xs text-ink-muted">{fileName}</p>
          <p className="mt-1 font-display text-lg font-bold">
            {parsed.rows.length === 1 ? "1 persona lista para entrar" : `${parsed.rows.length} personas listas para entrar`}
          </p>
          {parsed.columns.length > 0 && <p className="text-ink-muted">Columnas reconocidas: {parsed.columns.join(", ")}.</p>}
          {parsed.unknown.length > 0 && <p className="text-ink-muted">No se usan: {parsed.unknown.join(", ")}.</p>}
          {parsed.rows.length > 0 && (
            <ul className="mt-2 grid gap-0.5 text-ink-muted">
              {parsed.rows.slice(0, 3).map((r, i) => (
                <li key={i} className="truncate">
                  {r.nombre}
                  {r.documento ? ` · ${r.documento}` : ""}
                  {Object.keys(r.ficha).length > 0 ? ` · ${Object.values(r.ficha).join(", ")}` : ""}
                </li>
              ))}
              {parsed.rows.length > 3 && <li>y {parsed.rows.length - 3} más…</li>}
            </ul>
          )}
          {parsed.problems.length > 0 && (
            <div className="mt-2 text-[#ff6f86]">
              <p className="font-semibold">{parsed.problems.length === 1 ? "1 fila no entra:" : `${parsed.problems.length} filas no entran:`}</p>
              <ul>
                {parsed.problems.slice(0, 8).map((p) => (
                  <li key={p.fila}>
                    Fila {p.fila}: {p.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {parsed.rows.length > 0 && (
            <>
              <label className="mt-3 flex items-start gap-3">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-5 accent-[var(--gold-300)]" />
                <span>Estas personas autorizaron que guardemos sus datos para futuros castings.</span>
              </label>
              <button type="button" disabled={!consent || Boolean(state.working)} onClick={() => void send()} className={`${buttonPrimary} mt-3`}>
                {state.working ? "Ingresando…" : `Ingresar ${parsed.rows.length} al banco`}
              </button>
            </>
          )}
        </div>
      )}
      <Feedback state={state} />
      {skipped.length > 0 && (
        <ul className="text-sm text-[#ff6f86]">
          {skipped.map((s) => (
            <li key={s.fila}>No entró: {s.motivo}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
