import "server-only";

// Tipo de cambio del día frente al dólar (decisión 90), para las equivalencias del Excel.
// Servicio público sin clave; si no responde, el Excel usa los valores de referencia de config/paises.json y lo dice.

import { COUNTRIES } from "@mando/core/breakdown";

export type UsdRates = { rates: Record<string, number>; source: string; live: boolean };

export async function usdRates(): Promise<UsdRates> {
  const fallback = Object.fromEntries(COUNTRIES.map((c) => [c.moneda, c.tc_referencia]));
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(5000), next: { revalidate: 6 * 3600 } });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string };
    if (data.result !== "success" || !data.rates) throw new Error("sin datos");
    const rates = { ...fallback };
    for (const code of Object.keys(rates)) if (typeof data.rates[code] === "number" && data.rates[code] > 0) rates[code] = data.rates[code];
    const day = data.time_last_update_utc ? new Date(data.time_last_update_utc).toISOString().slice(0, 10) : "";
    return { rates, source: `ExchangeRate-API (open.er-api.com)${day ? `, ${day}` : ""}`, live: true };
  } catch {
    return { rates: fallback, source: "valores de referencia de MANDO: actualízalos", live: false };
  }
}
