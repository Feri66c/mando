import { accessListCsv } from "@mando/core/command";
import { getAccessList, getEventContext } from "@/lib/data";

/**
 * Lista de ingreso del evento como CSV, que Excel abre directo. Con `?cargo=` baja solo ese cargo.
 * Lleva documentos: la base solo se la entrega a producción (niveles 1 y 2 con visibilidad completa).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getEventContext(id);
  if (!ctx || !ctx.isTeam) return new Response("No encontrado", { status: 404 });
  try {
    const rows = await getAccessList(id);
    const cargo = new URL(request.url).searchParams.get("cargo") ?? "";
    const day = new Date().toISOString().slice(0, 10);
    return new Response(accessListCsv(ctx.event.name, rows, cargo), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="mando-lista-de-ingreso-${day}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
}
