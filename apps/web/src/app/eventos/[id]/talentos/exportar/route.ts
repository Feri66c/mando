import { FICHA_FIELDS } from "@mando/core/casting";
import { talentsToCsv } from "@mando/core/talents";
import { getEventContext, getTalentBank } from "@/lib/data";

/**
 * Exporta el banco de talentos como CSV, que Excel abre directo. Con `?plantilla=1` baja una lista vacía
 * con los títulos que MANDO reconoce al importar. Solo responde a quienes manejan la base (niveles 1 y 2):
 * la función de la base lo vuelve a comprobar.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  const level = ctx?.event.level ?? null;
  if (!ctx || !ctx.isTeam || level === null || level > 2) return new Response("No encontrado", { status: 404 });

  const headers = (name: string) => ({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "no-store",
  });
  if (new URL(request.url).searchParams.get("plantilla") === "1") {
    const titles = ["Nombre", "Apellido", "Tipo de documento", "Documento", "Celular", "Categoría", ...FICHA_FIELDS.map((f) => f.nombre)];
    return new Response(`﻿${titles.join(",")}\r\n`, { headers: headers("mando-plantilla-talentos.csv") });
  }
  try {
    const talents = await getTalentBank(id);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(talentsToCsv(talents), { headers: headers(`mando-banco-de-talentos-${day}.csv`) });
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
}
