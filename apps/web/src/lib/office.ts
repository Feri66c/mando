import "server-only";

// Archivos de Office que arma MANDO (decisión 89): el Excel del desglose para cotizar y el brief en Word.
// El Excel lleva una hoja oculta con el desglose original de la IA; así, cuando vuelve recortado,
// MANDO sabe con exactitud qué se quitó y qué cambió.

import ExcelJS from "exceljs";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { COUNTRIES, RUBROS, rubroName, type BreakdownItem, type Country } from "@mando/core/breakdown";

const NAVY = "FF0B1B3A";
const GOLD = "FFE7B53C";
const BASE_SHEET = "Base IA";

export type ReviewFinding = { tipo: "falta" | "quitaste" | "cantidad" | "inconsistencia"; item: string; mensaje: string; sugerencia: string };

const TIPO: Record<ReviewFinding["tipo"], string> = {
  falta: "Falta",
  quitaste: "Lo quitaste",
  cantidad: "Revisa la cantidad",
  inconsistencia: "No cuadra",
};

export type BreakdownSheetInput = {
  eventName: string;
  client: string;
  venue: string;
  eventDate: string;
  synopsis: string;
  items: BreakdownItem[];
  date: string;
  country: Country;
  /** Unidades de cada moneda por 1 dólar, y de dónde salieron. */
  fx: { rates: Record<string, number>; source: string };
};

const INK = "FF0F172A";
const MUTED = "FF64748B";
const LINE = "FFE2E8F0";
const ZEBRA = "FFF8FAFC";
const SOFT_GOLD = "FFFFF4CC";
const GROUP = "FFEEF2FF";
const MONEY = "#,##0.00";
const font = (extra: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: "Calibri", size: 11, color: { argb: INK }, ...extra });
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const hair: Partial<ExcelJS.Borders> = { bottom: { style: "hair", color: { argb: LINE } } };

function band(ws: ExcelJS.Worksheet, row: number, from: number, to: number, argb: string) {
  for (let c = from; c <= to; c++) ws.getRow(row).getCell(c).fill = fill(argb);
}

/**
 * El Excel del desglose con la identidad de MANDO (decisiones 89 y 90):
 * - «MANDO»: portada con los números clave, en moneda local y en dólares.
 * - «Resumen»: el país se elige en una lista; moneda, impuesto y tipo de cambio cambian solos.
 *   Subtotal por rubro con su equivalencia en dólares, fee, impuesto y total.
 * - «Desglose»: agrupado por rubro con subtotales que se pliegan; cada fila calcula solo con su propia fila,
 *   y los totales usan rangos y columnas completas, así borrar filas nunca rompe las fórmulas.
 * - «Países»: monedas, impuestos y tipo de cambio del día (editable).
 * - Hoja oculta con el original de la IA, para revisar el Excel recortado.
 */
export async function buildBreakdownXlsx(d: BreakdownSheetInput): Promise<Buffer> {
  const { items, country } = d;
  const wb = new ExcelJS.Workbook();
  wb.creator = "MANDO";
  wb.title = `Desglose para cotizar · ${d.eventName}`;
  const used = RUBROS.filter((r) => items.some((i) => i.rubro === r.codigo));

  const cover = wb.addWorksheet("MANDO", { views: [{ showGridLines: false }], properties: { tabColor: { argb: GOLD } } });
  const top = wb.addWorksheet("Resumen", { views: [{ showGridLines: false }], properties: { tabColor: { argb: NAVY } } });
  const ws = wb.addWorksheet("Desglose", { views: [{ state: "frozen", ySplit: 6, showGridLines: false }], properties: { outlineLevelRow: 1 } });
  const ctry = wb.addWorksheet("Países", { views: [{ showGridLines: false }] });

  // ---- Países ---------------------------------------------------------------------------
  ctry.columns = [{ width: 18 }, { width: 10 }, { width: 8 }, { width: 12 }, { width: 10 }, { width: 18 }];
  ctry.addRow(["País", "Moneda", "Símbolo", "Impuesto", "Tasa", "1 US$ equivale a"]);
  ctry.getRow(1).eachCell((c) => {
    c.font = font({ bold: true, color: { argb: "FFFFFFFF" }, size: 10 });
    c.fill = fill(NAVY);
  });
  COUNTRIES.forEach((c) => {
    const r = ctry.addRow([c.nombre, c.moneda, c.simbolo, c.impuesto, c.tasa, d.fx.rates[c.moneda] ?? c.tc_referencia]);
    r.getCell(5).numFmt = "0%";
    r.getCell(6).numFmt = "#,##0.0000";
    r.getCell(5).fill = r.getCell(6).fill = fill(SOFT_GOLD);
    r.eachCell((cell) => (cell.border = hair));
  });
  const nC = COUNTRIES.length + 1;
  ctry.getCell(`A${nC + 2}`).value = `Tipo de cambio: ${d.fx.source}. Las tasas de impuesto son las generales de cada país: confírmalas con tu contador. Las celdas amarillas se pueden cambiar.`;
  ctry.getCell(`A${nC + 2}`).font = font({ size: 9, color: { argb: MUTED } });
  const table = `'Países'!$A$2:$F$${nC}`;

  // ---- Resumen: el país manda ------------------------------------------------------------
  top.columns = [{ width: 3 }, { width: 9 }, { width: 32 }, { width: 9 }, { width: 18 }, { width: 16 }, { width: 8 }, { width: 22 }];
  top.mergeCells("B2:H2");
  top.getCell("B2").value = `Resumen · ${d.eventName}`;
  top.getCell("B2").font = font({ name: "Arial Black", size: 16, color: { argb: NAVY } });
  const params: [string, ExcelJS.CellValue, string, string][] = [
    ["País", country.nombre, "Pais", "@"],
    ["Moneda", { formula: `VLOOKUP(Pais,${table},2,FALSE)` }, "Moneda", "@"],
    ["Impuesto", { formula: `VLOOKUP(Pais,${table},4,FALSE)&" "&TEXT(VLOOKUP(Pais,${table},5,FALSE),"0%")` }, "ImpuestoNombre", "@"],
    ["1 US$ equivale a", { formula: `VLOOKUP(Pais,${table},6,FALSE)` }, "TipoCambio", "#,##0.0000"],
  ];
  params.forEach(([labelText, value, name, fmt], k) => {
    const n = 4 + k;
    top.getCell(`C${n}`).value = labelText;
    top.getCell(`C${n}`).font = font({ size: 10, color: { argb: MUTED } });
    const v = top.getCell(`D${n}`);
    top.mergeCells(`D${n}:E${n}`);
    v.value = value;
    v.numFmt = fmt;
    v.font = font({ bold: true });
    v.border = hair;
    wb.definedNames.add(`'Resumen'!$D$${n}`, name);
  });
  top.getCell("D4").fill = fill(SOFT_GOLD);
  top.getCell("D4").dataValidation = { type: "list", allowBlank: false, formulae: [`'Países'!$A$2:$A$${nC}`], showErrorMessage: true, errorTitle: "País", error: "Elige un país de la lista." };
  top.getCell("F4").value = "◂ elige el país";
  top.getCell("F4").font = font({ size: 9, color: { argb: MUTED }, italic: true });

  const H = 9; // fila de títulos de la tabla
  const th = top.getRow(H);
  const heads: ExcelJS.CellValue[] = ["Rubro", "Nombre", "Ítems", { formula: `"Subtotal ("&Moneda&")"` }, "Subtotal (US$)", "%", ""];
  heads.forEach((t, i) => (th.getCell(i + 2).value = t));
  for (let c = 2; c <= 8; c++) {
    th.getCell(c).font = font({ bold: true, color: { argb: "FFFFFFFF" }, size: 10 });
    th.getCell(c).fill = fill(NAVY);
  }
  th.height = 22;
  const first = H + 1;
  const last = H + used.length;
  const totalRow = last + 1;
  used.forEach((r, k) => {
    const n = first + k;
    const name = r.nombre.replace(/"/g, "");
    const row = top.getRow(n);
    row.getCell(2).value = r.codigo;
    row.getCell(3).value = r.nombre;
    row.getCell(4).value = { formula: `COUNTIF(Desglose!$B:$B,"${name}")` };
    row.getCell(5).value = { formula: `SUMIF(Desglose!$B:$B,"${name}",Desglose!$I:$I)` };
    row.getCell(6).value = { formula: `IFERROR(E${n}/TipoCambio,0)` };
    row.getCell(7).value = { formula: `IF($E$${totalRow}=0,0,E${n}/$E$${totalRow})` };
    row.getCell(8).value = { formula: `REPT("█",ROUND(G${n}*30,0))` };
    row.getCell(5).numFmt = row.getCell(6).numFmt = MONEY;
    row.getCell(7).numFmt = "0%";
    for (let c = 2; c <= 8; c++) {
      row.getCell(c).border = hair;
      row.getCell(c).font = font({ color: { argb: c === 2 ? MUTED : INK } });
      if (k % 2) row.getCell(c).fill = fill(ZEBRA);
    }
    row.getCell(8).font = font({ size: 9, color: { argb: GOLD } });
  });
  const lines: [string | ExcelJS.CellValue, ExcelJS.CellValue | null, string][] = [
    ["Subtotal", null, `SUM(E${first}:E${last})`],
    ["Fee de producción", 0.15, `E${totalRow}*D${totalRow + 1}`],
    ["Base imponible", null, `E${totalRow}+E${totalRow + 1}`],
    [{ formula: `VLOOKUP(Pais,${table},4,FALSE)` }, { formula: `VLOOKUP(Pais,${table},5,FALSE)` }, `E${totalRow + 2}*D${totalRow + 3}`],
    ["TOTAL", null, `E${totalRow + 2}+E${totalRow + 3}`],
  ];
  lines.forEach(([labelText, rate, formula], k) => {
    const n = totalRow + k;
    const row = top.getRow(n);
    row.getCell(3).value = labelText;
    if (rate !== null) {
      row.getCell(4).value = rate;
      row.getCell(4).numFmt = "0%";
      row.getCell(4).font = font({ bold: true });
      if (typeof rate === "number") row.getCell(4).fill = fill(SOFT_GOLD);
    }
    row.getCell(5).value = { formula };
    row.getCell(6).value = { formula: `IFERROR(E${n}/TipoCambio,0)` };
    row.getCell(5).numFmt = row.getCell(6).numFmt = MONEY;
    const isTotal = labelText === "TOTAL";
    for (let c = 3; c <= 6; c++) row.getCell(c).font = font({ bold: isTotal || labelText === "Subtotal", size: isTotal ? 13 : 11, color: { argb: isTotal ? (c === 5 ? GOLD : "FFFFFFFF") : INK } });
    if (isTotal) for (let c = 2; c <= 8; c++) row.getCell(c).fill = fill(NAVY);
    if (labelText === "Subtotal") for (let c = 2; c <= 8; c++) row.getCell(c).border = { top: { style: "thin", color: { argb: NAVY } } };
  });
  wb.definedNames.add(`'Resumen'!$E$${totalRow}`, "Subtotal");
  wb.definedNames.add(`'Resumen'!$E$${totalRow + 4}`, "TotalLocal");
  top.getCell(`C${totalRow + 6}`).value = "Cambia el país, el fee o el impuesto en las celdas amarillas: todo se recalcula, también cuando borras filas en Desglose.";
  top.getCell(`C${totalRow + 6}`).font = font({ size: 9, color: { argb: MUTED } });

  // ---- Portada ---------------------------------------------------------------------------
  cover.columns = [{ width: 3 }, { width: 24 }, { width: 24 }, { width: 24 }, { width: 24 }, { width: 3 }];
  for (let r = 1; r <= 30; r++) band(cover, r, 1, 6, NAVY);
  cover.getRow(2).height = 8;
  cover.getCell("B3").value = "MANDO";
  cover.getCell("B3").font = font({ name: "Arial Black", size: 12, color: { argb: GOLD } });
  cover.getCell("B4").value = "DESGLOSE PARA COTIZAR";
  cover.getCell("B4").font = font({ size: 9, color: { argb: "FF94A3B8" }, bold: true });
  cover.mergeCells("B6:E6");
  cover.getCell("B6").value = d.eventName;
  cover.getCell("B6").font = font({ name: "Arial Black", size: 22, color: { argb: "FFFFFFFF" } });
  cover.getRow(6).height = 36;
  cover.mergeCells("B7:E7");
  cover.getCell("B7").value = { formula: `"${[d.client, d.venue, d.eventDate].filter(Boolean).join("   ·   ").replace(/"/g, "")}${[d.client, d.venue, d.eventDate].some(Boolean) ? "   ·   " : ""}"&Pais&"   ·   "&Moneda` };
  cover.getCell("B7").font = font({ size: 11, color: { argb: "FFCBD5E1" } });
  cover.mergeCells("B9:E11");
  cover.getCell("B9").value = d.synopsis || "";
  cover.getCell("B9").font = font({ size: 11, italic: true, color: { argb: "FFE2E8F0" } });
  cover.getCell("B9").alignment = { wrapText: true, vertical: "top" };
  const kpis: [ExcelJS.CellValue, ExcelJS.CellValue, string][] = [
    ["ÍTEMS", { formula: `SUM('Resumen'!D${first}:D${last})` }, "0"],
    [{ formula: `"SUBTOTAL ("&Moneda&")"` }, { formula: "Subtotal" }, MONEY],
    [{ formula: `"TOTAL ("&Moneda&")"` }, { formula: "TotalLocal" }, MONEY],
    ["TOTAL (US$)", { formula: "IFERROR(TotalLocal/TipoCambio,0)" }, MONEY],
  ];
  kpis.forEach(([labelText, value, fmt], k) => {
    const cell = cover.getRow(14).getCell(2 + k);
    cell.value = labelText;
    cell.font = font({ size: 9, bold: true, color: { argb: GOLD } });
    const v = cover.getRow(15).getCell(2 + k);
    v.value = value;
    v.numFmt = fmt;
    v.font = font({ name: "Arial Black", size: 16, color: { argb: "FFFFFFFF" } });
    v.alignment = { horizontal: "left" };
    cover.getRow(16).getCell(2 + k).border = { top: { style: "medium", color: { argb: GOLD } } };
  });
  cover.getRow(15).height = 30;
  [
    "1   Elige el país en «Resumen»: moneda, impuesto y dólares cambian solos.",
    "2   En «Desglose» borra las filas que no van, corrige cantidades y escribe tu precio unitario.",
    "3   Vuelve a subir este archivo en MANDO: la IA revisa lo que falta o no cuadra.",
  ].forEach((t, k) => {
    cover.mergeCells(`B${19 + k}:E${19 + k}`);
    cover.getCell(`B${19 + k}`).value = t;
    cover.getCell(`B${19 + k}`).font = font({ size: 11, color: { argb: "FFE2E8F0" } });
  });
  cover.mergeCells("B24:E26");
  cover.getCell("B24").value =
    `Estimado preliminar armado por la IA de MANDO el ${d.date}. Las cantidades salen del brief y de reglas de producción; cada ítem dice su criterio. ` +
    `Tipo de cambio: ${d.fx.source}. No cambies la columna Código: así MANDO reconoce lo que quitaste.`;
  cover.getCell("B24").font = font({ size: 9, color: { argb: "FF94A3B8" } });
  cover.getCell("B24").alignment = { wrapText: true, vertical: "top" };

  // ---- Desglose --------------------------------------------------------------------------
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: true };
  ws.columns = [10, 24, 34, 46, 11, 10, 8, 16, 17, 15, 46, 10, 6, 6].map((width) => ({ width }));
  // M y N: copias numéricas de los totales, ocultas, para que los subtotales no se rompan.
  ws.getColumn(13).hidden = true;
  ws.getColumn(14).hidden = true;
  ws.mergeCells("A1:L1");
  ws.getCell("A1").value = `Desglose para cotizar · ${d.eventName}`;
  ws.getCell("A1").font = font({ name: "Arial Black", size: 16, color: { argb: NAVY } });
  ws.mergeCells("A2:L2");
  ws.getCell("A2").value = { formula: `Pais&" · "&Moneda&" · 1 US$ = "&TEXT(TipoCambio,"#,##0.00")&" · Estimado de la IA de MANDO el ${d.date}. Usa + y − a la izquierda para plegar cada rubro."` };
  ws.getCell("A2").font = font({ size: 10, color: { argb: MUTED } });
  band(ws, 4, 1, 12, GOLD);
  ws.getRow(4).height = 4;
  const head = ws.getRow(6);
  const labels: ExcelJS.CellValue[] = [
    "Código", "Rubro", "Ítem", "Detalle", "Unidad", "Cantidad", "Días",
    { formula: `"Precio unitario ("&Moneda&")"` }, { formula: `"Total ("&Moneda&")"` }, "Total (US$)", "Criterio de la IA", "Origen",
  ];
  labels.forEach((v, i) => (head.getCell(i + 1).value = v));
  head.eachCell((c) => {
    c.font = font({ bold: true, color: { argb: "FFFFFFFF" }, size: 10 });
    c.fill = fill(NAVY);
    c.alignment = { vertical: "middle", wrapText: true };
  });
  head.height = 30;
  let row = 7;
  for (const r of used) {
    const group = ws.getRow(row);
    const list = items.filter((i) => i.rubro === r.codigo);
    group.getCell(1).value = `■ ${r.codigo}`;
    // Los subtotales buscan por nombre de rubro en columnas completas (y en las columnas
    // auxiliares M y N, ocultas): borrar filas o rubros enteros nunca deja un #REF!.
    group.getCell(3).value = { formula: `"${r.nombre.toUpperCase()}  ·  "&COUNTIF($B:$B,"${r.nombre}")&" ítems"`, result: `${r.nombre.toUpperCase()}  ·  ${list.length} ítems` };
    group.getCell(9).value = { formula: `SUMIF($B:$B,"${r.nombre}",$M:$M)` };
    group.getCell(10).value = { formula: `SUMIF($B:$B,"${r.nombre}",$N:$N)` };
    group.getCell(9).numFmt = group.getCell(10).numFmt = MONEY;
    for (let c = 1; c <= 12; c++) {
      group.getCell(c).fill = fill(GROUP);
      group.getCell(c).font = font({ bold: true, color: { argb: NAVY } });
      group.getCell(c).border = { top: { style: "thin", color: { argb: NAVY } } };
    }
    group.height = 22;
    row++;
    list.forEach((it, z) => {
      const line = ws.getRow(row);
      line.values = [it.codigo, rubroName(it.rubro), it.item, it.detalle, it.unidad, it.cantidad, it.dias, null, null, null, it.criterio, it.origen === "brief" ? "Brief" : "Estándar"];
      // Cada fila calcula solo con su propia fila: borrar otras filas no la rompe.
      line.getCell(9).value = { formula: `IF(H${row}="","",F${row}*G${row}*H${row})` };
      line.getCell(10).value = { formula: `IF(I${row}="","",IFERROR(I${row}/TipoCambio,""))` };
      line.getCell(13).value = { formula: `N(I${row})` };
      line.getCell(14).value = { formula: `N(J${row})` };
      line.getCell(8).numFmt = line.getCell(9).numFmt = line.getCell(10).numFmt = MONEY;
      line.outlineLevel = 1;
      for (let c = 1; c <= 12; c++) {
        const cell = line.getCell(c);
        cell.font = font({ size: 10, color: { argb: c === 1 || c === 2 || c === 11 ? MUTED : INK } });
        cell.border = hair;
        cell.alignment = { vertical: "top", wrapText: c === 4 || c === 11 };
        if (z % 2) cell.fill = fill(ZEBRA);
      }
      line.getCell(8).fill = fill(SOFT_GOLD);
      line.getCell(3).font = font({ size: 10, bold: true });
      if (it.origen === "brief") line.getCell(12).font = font({ size: 10, bold: true, color: { argb: "FFB45309" } });
      row++;
    });
  }
  const total = ws.getRow(row + 1);
  total.getCell(3).value = "TOTAL";
  total.getCell(9).value = { formula: "SUM($M:$M)" };
  total.getCell(10).value = { formula: "SUM($N:$N)" };
  total.getCell(9).numFmt = total.getCell(10).numFmt = MONEY;
  for (let c = 1; c <= 12; c++) {
    total.getCell(c).fill = fill(NAVY);
    total.getCell(c).font = font({ bold: true, color: { argb: c === 9 || c === 10 ? GOLD : "FFFFFFFF" }, size: 12 });
  }
  total.height = 24;
  ws.autoFilter = { from: "A6", to: `L${row - 1}` };
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  ws.headerFooter = { oddFooter: "&LMANDO · Desglose para cotizar&Rpágina &P de &N" };

  // ---- Original de la IA (oculto) --------------------------------------------------------
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
    const codigo = cellText(get(c.codigo)).trim().toUpperCase();
    // Filas de rubro (■ AUD) y la fila TOTAL no son ítems.
    if (!item || /^total$/i.test(item) || codigo.startsWith("■")) return;
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
