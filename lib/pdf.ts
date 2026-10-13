import type { jsPDF as JsPDF } from "jspdf";

/**
 * A small report writer on top of jsPDF, shared by every tab's "Download PDF" button. The library is
 * loaded only when someone downloads a report. The built-in PDF fonts can't draw "₱" or some dashes,
 * so text goes through `pdfText` (₱ becomes "PHP ").
 */
export const pdfText = (value: unknown) => String(value ?? "")
  .replace(/₱\s?/g, "PHP ").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, "\"").replace(/…/g, "...").replace(/→/g, "->").replace(/[^\x20-\xFF\n]/g, "");

type Cell = string | number;
export type ReportOptions = {
  title: string; period: string; filters?: string; landscape?: boolean;
  /** Shown in the footer of every page when the report lists patients by name. */
  confidential?: boolean;
};

const INK: [number, number, number] = [27, 25, 21];
const SOFT: [number, number, number] = [107, 98, 82];
const GOLD: [number, number, number] = [168, 123, 16];
const LINE: [number, number, number] = [230, 222, 208];
const TINT: [number, number, number] = [248, 245, 239];
const BAR: [number, number, number] = [184, 134, 11];

async function logoData() {
  try {
    const blob = await (await fetch("/theheartspecialists.png")).blob();
    return await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob); });
  } catch { return null; }
}

export async function createReport(opts: ReportOptions) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc: JsPDF = new jsPDF({ orientation: opts.landscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 14, BOTTOM = H - 16;
  let y = M;
  const generated = new Date().toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

  // Header: logo, clinic, title, period and filters.
  const logo = await logoData();
  if (logo) doc.addImage(logo, "PNG", M, y, 11, 14);
  const tx = logo ? M + 15 : M;
  doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(...GOLD).text("THE HEART SPECIALISTS CLINIC & DIAGNOSTIC", tx, y + 3.5);
  doc.setFontSize(16).setTextColor(...INK).text(pdfText(opts.title), tx, y + 10);
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...SOFT).text(pdfText(`Period: ${opts.period}`), tx, y + 15);
  doc.text(pdfText(`Generated ${generated}`), W - M, y + 3.5, { align: "right" });
  y += 18;
  if (opts.filters) { doc.setFontSize(8).text(doc.splitTextToSize(pdfText(opts.filters), W - 2 * M), M, y); y += 5; }
  doc.setDrawColor(...INK).setLineWidth(0.5).line(M, y, W - M, y);
  y += 6;

  const ensure = (space: number) => { if (y + space > BOTTOM) { doc.addPage(); y = M; } };
  const lastY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;

  const report = {
    heading(text: string, note?: string) {
      // Keep a heading with the start of what follows it.
      ensure(note ? 34 : 28);
      y += 2;
      doc.setFont("helvetica", "bold").setFontSize(11.5).setTextColor(...INK).text(pdfText(text), M, y);
      y += 5;
      if (note) report.note(note);
    },
    note(text: string) {
      const lines = doc.splitTextToSize(pdfText(text), W - 2 * M);
      ensure(lines.length * 3.6 + 2);
      doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...SOFT).text(lines, M, y);
      y += lines.length * 3.6 + 2;
    },
    /** A row of figure boxes, like the cards on screen. */
    kpis(items: { label: string; value: string; note?: string; accent?: boolean }[]) {
      const perRow = items.length <= 6 ? items.length : 4, gap = 3;
      const w = (W - 2 * M - gap * (perRow - 1)) / perRow, h = 22;
      const valueSize = w >= 42 ? 13 : w >= 33 ? 11 : 10;
      items.forEach((item, i) => {
        if (i % perRow === 0) { if (i) y += h + gap; ensure(h); }
        const x = M + (i % perRow) * (w + gap);
        doc.setFillColor(...(item.accent ? [248, 236, 203] as [number, number, number] : TINT)).setDrawColor(...LINE).setLineWidth(0.2).rect(x, y, w, h, "FD");
        doc.setFillColor(...(item.accent ? BAR : INK)).rect(x, y, 1.2, h, "F");
        doc.setFont("helvetica", "normal").setFontSize(6.3).setTextColor(...SOFT);
        const label = doc.splitTextToSize(pdfText(item.label.toUpperCase()), w - 5).slice(0, 2);
        doc.text(label, x + 3.5, y + 4.5);
        const vy = y + (label.length > 1 ? 13.5 : 11.5);
        doc.setFont("helvetica", "bold").setFontSize(valueSize).setTextColor(...(item.accent ? GOLD : INK)).text(pdfText(item.value), x + 3.5, vy);
        if (item.note) doc.setFont("helvetica", "normal").setFontSize(6.3).setTextColor(...SOFT).text(doc.splitTextToSize(pdfText(item.note), w - 5).slice(0, 2), x + 3.5, vy + 4);
      });
      y += h + 6;
    },
    /** Horizontal bars with the value written at the end. */
    bars(items: { label: string; value: number; display: string }[]) {
      const max = Math.max(...items.map((i) => i.value), 0) || 1;
      const labelW = 52, valueW = 42, trackW = W - 2 * M - labelW - valueW - 4;
      items.forEach((item) => {
        ensure(7);
        doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...INK).text(doc.splitTextToSize(pdfText(item.label), labelW - 2)[0], M, y + 3.2);
        doc.setFillColor(...TINT).rect(M + labelW, y, trackW, 4, "F");
        doc.setFillColor(...BAR).rect(M + labelW, y, Math.max(0.6, (item.value / max) * trackW), 4, "F");
        doc.setFontSize(7.8).setTextColor(...SOFT).text(pdfText(item.display), W - M, y + 3.2, { align: "right" });
        y += 6.2;
      });
      y += 3;
    },
    table(head: string[], body: Cell[][], o: { right?: number[]; widths?: Record<number, number>; boldLast?: boolean; fontSize?: number } = {}) {
      ensure(18);
      const columnStyles: Record<number, { halign?: "right"; cellWidth?: number }> = {};
      (o.right || []).forEach((i) => { columnStyles[i] = { ...columnStyles[i], halign: "right" }; });
      Object.entries(o.widths || {}).forEach(([i, w]) => { columnStyles[Number(i)] = { ...columnStyles[Number(i)], cellWidth: w }; });
      autoTable(doc, {
        startY: y, head: [head.map(pdfText)], body: body.map((r) => r.map((c) => pdfText(c))), margin: { left: M, right: M, bottom: H - BOTTOM },
        theme: "plain", styles: { fontSize: o.fontSize ?? 8, cellPadding: 1.6, textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.15 } as unknown as number, overflow: "linebreak" },
        headStyles: { fillColor: INK, textColor: [240, 200, 100], fontStyle: "bold", fontSize: (o.fontSize ?? 8) - 0.5 },
        alternateRowStyles: { fillColor: TINT }, columnStyles,
        didParseCell: (data) => {
          if (data.section === "head" && (o.right || []).includes(data.column.index)) data.cell.styles.halign = "right";
          if (o.boldLast && data.section === "body" && data.row.index === body.length - 1) data.cell.styles.fontStyle = "bold";
        },
      });
      y = lastY() + 6;
    },
    /** Findings as label · value, then the explanation. */
    findings(items: { label: string; value: string; text: string }[]) {
      items.forEach((f) => {
        const lines = doc.splitTextToSize(pdfText(`${f.value} ${f.text}`), W - 2 * M - 4);
        ensure(lines.length * 3.6 + 7);
        doc.setFillColor(...GOLD).rect(M, y - 0.5, 1, lines.length * 3.6 + 4.5, "F");
        doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...INK).text(pdfText(f.label), M + 3, y + 2.5);
        doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...SOFT).text(lines, M + 3, y + 6.2);
        y += lines.length * 3.6 + 7.5;
      });
      y += 1;
    },
    save(filename: string) {
      // Footer on every page.
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i += 1) {
        doc.setPage(i);
        doc.setDrawColor(...LINE).setLineWidth(0.2).line(M, H - 11, W - M, H - 11);
        doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...SOFT);
        doc.text(pdfText(`THSC Summary Dashboard · ${opts.title}${opts.confidential ? " · CONFIDENTIAL: contains patient information (Data Privacy Act of 2012)" : ""}`), M, H - 7);
        doc.text(`Page ${i} of ${pages}`, W - M, H - 7, { align: "right" });
      }
      doc.save(filename);
    },
  };
  return report;
}

/** "2026-08-26 to 2026-09-30" for file names. */
export const fileRange = (from?: Date | null, to?: Date | null) => {
  const d = (x?: Date | null) => (x ? `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}` : "");
  return from && to ? (d(from) === d(to) ? d(from) : `${d(from)} to ${d(to)}`) : d(new Date());
};
