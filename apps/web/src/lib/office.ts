import "server-only";

// Archivos de Office que arma MANDO (decisión 89): el Excel del desglose para cotizar y el brief en Word.
// El Excel lleva una hoja oculta con el desglose original de la IA; así, cuando vuelve recortado,
// MANDO sabe con exactitud qué se quitó y qué cambió.

import ExcelJS from "exceljs";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { RUBROS, rubroName, type BreakdownItem } from "@mando/core/breakdown";

const NAVY = "FF0B1B3A";
const GOLD = "FFE7B53C";
const BASE_SHEET = "Base IA";
const HEAD = ["Código", "Rubro", "Ítem", "Detalle", "Unidad", "Cantidad", "Días", "Precio unitario (S/)", "Total (S/)", "Criterio de la IA", "Origen"];

export type ReviewFinding = { tipo: "falta" | "quitaste" | "cantidad" | "inconsistencia"; item: string; mensaje: string; sugerencia: string };

const TIPO: Record<ReviewFinding["tipo"], string> = {
  falta: "Falta",
  quitaste: "Lo quitaste",
  cantidad: "Revisa la cantidad",
  inconsistencia: "No cuadra",
};

export async function buildBreakdownXlsx({ eventName, synopsis, items, date }: { eventName: string; synopsis: string; items: BreakdownItem[]; date: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MANDO";
  const ws = wb.addWorksheet("Desglose", { views: [{ state: "frozen", ySplit: 5 }] });
  ws.columns = [10, 26, 34, 48, 12, 11, 8, 16, 16, 48, 11].map((width) => ({ width }));
  ws.mergeCells("A1:K1");
  ws.getCell("A1").value = `Desglose para cotizar · ${eventName}`;
  ws.getCell("A1").font = { bold: true, size: 16, color: { argb: NAVY } };
  ws.mergeCells("A2:K2");
  ws.getCell("A2").value =
    `Estimado preliminar armado por la IA de MANDO el ${date}. Borra las filas que no van, corrige cantidades y pon tus precios. ` +
    "Luego vuelve a subir este mismo archivo a MANDO para que la IA revise lo que falta o no cuadra. No cambies la columna Código.";
  ws.getCell("A2").alignment = { wrapText: true, vertical: "top" };
  ws.getRow(2).height = 32;
  ws.mergeCells("A3:K3");
  ws.getCell("A3").value = synopsis ? `Sinopsis: ${synopsis}` : "";
  ws.getCell("A3").alignment = { wrapText: true, vertical: "top" };
  ws.getRow(3).height = synopsis ? 44 : 6;
  const head = ws.getRow(5);
  head.values = HEAD;
  head.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { vertical: "middle", wrapText: true };
  });
  head.height = 30;
  let row = 6;
  for (const it of items) {
    const r = ws.getRow(row);
    r.values = [it.codigo, rubroName(it.rubro), it.item, it.detalle, it.unidad, it.cantidad, it.dias, null, null, it.criterio, it.origen === "brief" ? "Brief" : "Estándar"];
    r.getCell(9).value = { formula: `F${row}*G${row}*H${row}` };
    r.getCell(8).numFmt = r.getCell(9).numFmt = '#,##0.00';
    r.getCell(4).alignment = r.getCell(10).alignment = { wrapText: true, vertical: "top" };
    row++;
  }
  const total = ws.getRow(row + 1);
  total.getCell(3).value = "TOTAL";
  total.getCell(9).value = { formula: `SUM(I6:I${row})` };
  total.getCell(9).numFmt = '#,##0.00';
  total.eachCell((c) => {
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GOLD } };
  });
  ws.autoFilter = { from: "A5", to: `K${row - 1}` };

  // Hoja resumen, como la «top sheet» de los programas de presupuesto: un subtotal por rubro,
  // y abajo los parámetros (fee de producción e IGV) que el productor ajusta en una sola celda.
  const top = wb.addWorksheet("Resumen", { properties: { tabColor: { argb: GOLD } } });
  top.columns = [{ width: 10 }, { width: 34 }, { width: 12 }, { width: 18 }];
  top.mergeCells("A1:D1");
  top.getCell("A1").value = `Resumen del presupuesto · ${eventName}`;
  top.getCell("A1").font = { bold: true, size: 14, color: { argb: NAVY } };
  const th = top.getRow(3);
  th.values = ["Rubro", "Nombre", "Ítems", "Subtotal (S/)"];
  th.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  });
  const used = RUBROS.filter((r) => items.some((i) => i.rubro === r.codigo));
  used.forEach((r, k) => {
    const n = 4 + k;
    const name = r.nombre.replace(/"/g, "");
    top.getRow(n).values = [r.codigo, r.nombre];
    top.getCell(`C${n}`).value = { formula: `COUNTIF(Desglose!B:B,"${name}")` };
    top.getCell(`D${n}`).value = { formula: `SUMIF(Desglose!B:B,"${name}",Desglose!I:I)` };
    top.getCell(`D${n}`).numFmt = "#,##0.00";
  });
  const last = 3 + used.length;
  const p = last + 2;
  const lines: [string, string | null, string][] = [
    ["Subtotal", null, `SUM(D4:D${last})`],
    ["Fee de producción", "0.15", `D${p}*C${p + 1}`],
    ["Base imponible", null, `D${p}+D${p + 1}`],
    ["IGV", "0.18", `D${p + 2}*C${p + 3}`],
    ["TOTAL", null, `D${p + 2}+D${p + 3}`],
  ];
  lines.forEach(([labelText, rate, formula], k) => {
    const n = p + k;
    top.getCell(`B${n}`).value = labelText;
    if (rate) {
      top.getCell(`C${n}`).value = Number(rate);
      top.getCell(`C${n}`).numFmt = "0%";
      top.getCell(`C${n}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4CC" } };
    }
    top.getCell(`D${n}`).value = { formula };
    top.getCell(`D${n}`).numFmt = "#,##0.00";
    top.getCell(`B${n}`).font = top.getCell(`D${n}`).font = { bold: labelText === "TOTAL" || labelText === "Subtotal" };
  });
  top.getCell(`B${p + lines.length + 1}`).value = "Ajusta el fee y el IGV en las celdas amarillas. Los subtotales se actualizan solos cuando borras filas en Desglose.";

  const base = wb.addWorksheet(BASE_SHEET, { state: "veryHidden" });
  base.addRow(["codigo", "rubro", "item", "unidad", "cantidad", "dias"]);
  for (const it of items) base.addRow([it.codigo, it.rubro, it.item, it.unidad, it.cantidad, it.dias]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("result" in v) return String(v.result ?? "");
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    return "";
  }
  return String(v);
};
const cellNum = (v: ExcelJS.CellValue): number => {
  const n = Number(cellText(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export type ReadBreakdown = { current: BreakdownItem[]; base: BreakdownItem[] | null };

/** Lee el Excel que volvió: las filas de la hoja Desglose y, si está, la hoja oculta con el original. */
export async function readBreakdownXlsx(data: ArrayBuffer): Promise<ReadBreakdown> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    throw new Error("No pude abrir ese archivo. Guárdalo como Excel (.xlsx) e intenta de nuevo.");
  }
  const ws = wb.getWorksheet("Desglose") ?? wb.worksheets.find((w) => w.state === "visible");
  if (!ws) throw new Error("Ese Excel no tiene hojas.");
  let headerRow = 0;
  const cols = new Map<string, number>();
  ws.eachRow((r, n) => {
    if (headerRow) return;
    const texts = (r.values as ExcelJS.CellValue[]).map((v) => cellText(v).trim().toLowerCase());
    if (texts.includes("ítem") || texts.includes("item")) {
      headerRow = n;
      texts.forEach((t, i) => t && cols.set(t, i));
    }
  });
  if (!headerRow) throw new Error("No encontré la fila de títulos (Código, Rubro, Ítem…). Usa el Excel que armó MANDO.");
  const col = (...names: string[]) => names.map((n) => cols.get(n)).find((i) => i !== undefined);
  const c = {
    codigo: col("código", "codigo"),
    rubro: col("rubro"),
    item: col("ítem", "item"),
    detalle: col("detalle", "descripción", "descripcion"),
    unidad: col("unidad"),
    cantidad: col("cantidad"),
    dias: col("días", "dias"),
    precio: col("precio unitario (s/)", "precio unitario", "precio"),
  };
  const byName = new Map(RUBROS.map((r) => [r.nombre.toLowerCase(), r.codigo]));
  const current: BreakdownItem[] = [];
  ws.eachRow((r, n) => {
    if (n <= headerRow || current.length >= 400) return;
    const get = (i?: number) => (i ? r.getCell(i).value : null);
    const item = cellText(get(c.item)).trim();
    if (!item || /^total$/i.test(item)) return;
    const codigo = cellText(get(c.codigo)).trim().toUpperCase();
    const rubroText = cellText(get(c.rubro)).trim();
    const rubro = codigo.split("-")[0] && RUBROS.some((x) => x.codigo === codigo.split("-")[0]) ? codigo.split("-")[0] : byName.get(rubroText.toLowerCase()) ?? "PRD";
    current.push({
      codigo,
      rubro,
      item: item.slice(0, 120),
      detalle: cellText(get(c.detalle)).trim().slice(0, 300),
      unidad: cellText(get(c.unidad)).trim().slice(0, 30),
      cantidad: cellNum(get(c.cantidad)),
      dias: cellNum(get(c.dias)) || 1,
      criterio: c.precio && cellNum(get(c.precio)) ? `precio unitario S/ ${cellNum(get(c.precio))}` : "",
      origen: "estandar",
    });
  });
  const baseSheet = wb.getWorksheet(BASE_SHEET);
  let base: BreakdownItem[] | null = null;
  if (baseSheet) {
    base = [];
    baseSheet.eachRow((r, n) => {
      if (n === 1) return;
      const v = (i: number) => r.getCell(i).value;
      base!.push({ codigo: cellText(v(1)), rubro: cellText(v(2)), item: cellText(v(3)), detalle: "", unidad: cellText(v(4)), cantidad: cellNum(v(5)), dias: cellNum(v(6)) || 1, criterio: "", origen: "estandar" });
    });
  }
  return { current, base };
}

/** Devuelve el mismo Excel con una hoja nueva «Revisión IA» al inicio. */
export async function addReviewSheet(data: ArrayBuffer, findings: ReviewFinding[], date: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const old = wb.getWorksheet("Revisión IA");
  if (old) wb.removeWorksheet(old.id);
  const ws = wb.addWorksheet("Revisión IA", { properties: { tabColor: { argb: GOLD } } });
  ws.columns = [{ width: 20 }, { width: 34 }, { width: 60 }, { width: 50 }];
  ws.mergeCells("A1:D1");
  ws.getCell("A1").value = `Revisión de la IA de MANDO · ${date}`;
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: NAVY } };
  const head = ws.addRow(["Tipo", "Ítem", "Lo que noto", "Sugerencia"]);
  head.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  });
  for (const f of findings) {
    const r = ws.addRow([TIPO[f.tipo] ?? f.tipo, f.item, f.mensaje, f.sugerencia]);
    r.alignment = { wrapText: true, vertical: "top" };
  }
  if (!findings.length) ws.addRow(["", "", "La IA no encontró omisiones ni cosas que no cuadren.", ""]);
  // El archivo abre en la hoja de la revisión.
  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: wb.worksheets.indexOf(ws), visibility: "visible" }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export type BriefDocInput = {
  eventName: string;
  subtitle: string;
  synopsis: string;
  brief: string;
  recommendations: { titulo: string; detalle: string; nivel: string }[];
  documents: string[];
  date: string;
};

/** El brief en Word, para mandarlo o imprimirlo: sinopsis, brief, recomendaciones y documentos de apoyo. */
export async function buildBriefDocx(d: BriefDocInput): Promise<Buffer> {
  const para = (text: string) => new Paragraph({ children: [new TextRun(text)], spacing: { after: 120 } });
  const blocks = (text: string) =>
    text.split(/\n+/).map((line) => {
      const t = line.trim();
      if (/^#{1,3}\s/.test(t)) return new Paragraph({ text: t.replace(/^#+\s*/, ""), heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 80 } });
      if (/^[-•*]\s/.test(t)) return new Paragraph({ text: t.replace(/^[-•*]\s*/, ""), bullet: { level: 0 } });
      return para(t);
    });
  const children: Paragraph[] = [
    new Paragraph({ text: d.eventName, heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: d.subtitle, color: "555555" })], spacing: { after: 240 } }),
    new Paragraph({ text: "Sinopsis", heading: HeadingLevel.HEADING_1 }),
    para(d.synopsis || "Sin sinopsis todavía."),
    new Paragraph({ text: "Brief del evento", heading: HeadingLevel.HEADING_1 }),
    ...blocks(d.brief),
  ];
  if (d.recommendations.length) {
    children.push(new Paragraph({ text: "Recomendaciones: posibles puntos ciegos", heading: HeadingLevel.HEADING_1 }));
    for (const r of d.recommendations)
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: `${r.titulo} (${r.nivel}). `, bold: true }), new TextRun(r.detalle)],
        }),
      );
  }
  if (d.documents.length) {
    children.push(new Paragraph({ text: "Documentos complementarios", heading: HeadingLevel.HEADING_1 }));
    for (const name of d.documents) children.push(new Paragraph({ text: name, bullet: { level: 0 } }));
  }
  children.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 400 },
      children: [new TextRun({ text: `Exportado de MANDO el ${d.date}.`, color: "888888", size: 18 })],
    }),
  );
  const doc = new Document({ creator: "MANDO", title: d.eventName, styles: { default: { document: { run: { font: "Calibri", size: 22 } } } }, sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
