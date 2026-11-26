// GRABA AQUÍ: convierte lo que dijo la persona («dame una hora más en sonido») en una propuesta de cambio.
// Este intérprete cubre las frases de todos los días sin internet ni costo. Si no entiende, la app le pide
// la interpretación a Claude en el servidor. En ambos casos la persona ve la vista previa y confirma.

export type VoiceItem = { id: string; title: string; areaName?: string | null; status?: string };

export type VoiceProposal = {
  itemId: string;
  itemTitle: string;
  kind: "extend" | "move";
  /** Minutos a sumar (positivo) o restar (negativo). Null si es «a las HH:MM». */
  minutes: number | null;
  /** «HH:MM» cuando la persona dijo una hora concreta («pasa la apertura a las 19:30»). */
  at: string | null;
  /** Frase para mostrar: «Alargar «Prueba de sonido» 60 min». */
  summary: string;
};

const NUMBERS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  doce: 12, quince: 15, veinte: 20, veinticinco: 25, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, noventa: 90,
};

/** Minúsculas, sin tildes ni signos. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9: ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(word: string): number | null {
  if (/^\d+$/.test(word)) return Number(word);
  return NUMBERS[word] ?? null;
}

/** Duración dicha, en minutos: «una hora», «hora y media», «media hora», «45 minutos», «un cuarto de hora». */
export function parseDuration(text: string): number | null {
  const t = normalize(text).replace(/cuarenta y cinco/g, "45").replace(/treinta y cinco/g, "35");
  if (/\bhoras? y media\b/.test(t)) {
    const m = /\b(\w+) horas? y media\b/.exec(t);
    const h = m ? toNumber(m[1]) : 1;
    return (h ?? 1) * 60 + 30;
  }
  if (/\bmedia hora\b/.test(t)) return 30;
  if (/\bcuarto de hora\b/.test(t)) return 15;
  let total = 0;
  let found = false;
  const hours = /\b(\w+) (horas?|h)\b/.exec(t);
  if (hours) {
    const n = toNumber(hours[1]);
    if (n !== null) {
      total += n * 60;
      found = true;
    }
  } else if (/\buna hora\b|\bla hora\b/.test(t)) {
    total += 60;
    found = true;
  }
  const mins = /\b(\w+) (minutos?|mins?|min)\b/.exec(t);
  if (mins) {
    const n = toNumber(mins[1]);
    if (n !== null) {
      total += n;
      found = true;
    }
  }
  return found && total > 0 ? total : null;
}

/** «a las 19:30», «a las 7 y media», «a las 20». Devuelve «HH:MM» o null. */
export function parseClock(text: string): string | null {
  const t = normalize(text);
  const m = /\ba las (\d{1,2})(?::(\d{2}))?( y media| y cuarto)?\b/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  let min = m[2] ? Number(m[2]) : 0;
  if (m[3] === " y media") min = 30;
  if (m[3] === " y cuarto") min = 15;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const STOP = new Set(["de", "del", "la", "el", "los", "las", "y", "en", "a", "al", "con", "para", "por", "prueba"]);

function words(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/** La actividad que la persona nombró: la que comparte más palabras con lo dicho. Empate o ninguna: null. */
export function matchItem<T extends VoiceItem>(text: string, items: T[]): T | null {
  const said = new Set(words(text));
  let best: T | null = null;
  let bestScore = 0;
  let tie = false;
  for (const item of items) {
    if (item.status === "done" || item.status === "cancelled") continue;
    const score = words(`${item.title} ${item.areaName ?? ""}`).filter((w) => said.has(w)).length;
    if (score > bestScore) {
      best = item;
      bestScore = score;
      tie = false;
    } else if (score === bestScore && score > 0) {
      tie = true;
    }
  }
  return bestScore > 0 && !tie ? best : null;
}

const SHORTEN = /\b(menos|acorta|acortar|recorta|recortar|quita|quitale|reduce)\b/;
const MOVE_LATER = /\b(mueve|mover|muevelo|muevela|atrasa|atrasar|retrasa|retrasar|corre|correr|posterga|postergar|pasa|pasala|pasalo|despues)\b/;
const MOVE_EARLIER = /\b(adelanta|adelantar|antes)\b/;

/**
 * Interpreta la frase. `currentItemId` es la actividad de «Ahora»: se usa si la persona no nombra ninguna.
 * Devuelve null si no hay suficiente información (la app pregunta o se lo pide a Claude).
 */
export function parseVoiceCommand<T extends VoiceItem>(text: string, items: T[], currentItemId?: string | null): VoiceProposal | null {
  const t = normalize(text);
  if (!t) return null;
  const item = matchItem(t, items) ?? items.find((i) => i.id === currentItemId) ?? null;
  if (!item) return null;

  const at = parseClock(t);
  const duration = parseDuration(t.replace(/\ba las [^ ]+( y media| y cuarto)?/, ""));

  if (at && (MOVE_LATER.test(t) || !duration)) {
    return { itemId: item.id, itemTitle: item.title, kind: "move", minutes: null, at, summary: `Mover «${item.title}» a las ${at}` };
  }
  if (!duration) return null;
  if (MOVE_EARLIER.test(t)) {
    return { itemId: item.id, itemTitle: item.title, kind: "move", minutes: -duration, at: null, summary: `Adelantar «${item.title}» ${duration} min` };
  }
  if (MOVE_LATER.test(t) && !/\bmas\b/.test(t)) {
    return { itemId: item.id, itemTitle: item.title, kind: "move", minutes: duration, at: null, summary: `Atrasar «${item.title}» ${duration} min` };
  }
  if (SHORTEN.test(t)) {
    return { itemId: item.id, itemTitle: item.title, kind: "extend", minutes: -duration, at: null, summary: `Acortar «${item.title}» ${duration} min` };
  }
  return { itemId: item.id, itemTitle: item.title, kind: "extend", minutes: duration, at: null, summary: `Alargar «${item.title}» ${duration} min` };
}
