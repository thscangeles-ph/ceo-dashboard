"use client";

import { useMemo } from "react";
import { FileSpreadsheet, Plus, Trash2 } from "lucide-react";
import { count, shortDate } from "@/lib/analyze";
import type { SalesRow, SheetSummary } from "@/lib/parse";
import { LEGACY_UPLOAD, sheetKey } from "@/lib/parse";

const added = (d?: Date) => (d ? d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "");

/**
 * The sales report files behind the Sales Dashboard, each removable on its own. Removing a file
 * deletes only the rows no other uploaded file also contains.
 */
export function SalesFiles({ sheets, rows, busy, onAdd, onRemove }: {
  sheets: SheetSummary[]; rows: SalesRow[]; busy: boolean;
  onAdd: () => void; onRemove: (targets: SheetSummary[]) => void;
}) {
  const files = sheets.filter((s) => s.kind === "sales");
  const legacy = files.filter((s) => !s.id);
  // Rows and dates per upload, from the rows themselves.
  const stats = useMemo(() => {
    const map = new Map<string, { rows: number; min: number; max: number }>();
    for (const row of rows) {
      const t = row.date?.getTime();
      for (const owner of row.uploads ?? [LEGACY_UPLOAD]) {
        const s = map.get(owner) || { rows: 0, min: Infinity, max: -Infinity };
        s.rows += 1;
        if (t !== undefined) { s.min = Math.min(s.min, t); s.max = Math.max(s.max, t); }
        map.set(owner, s);
      }
    }
    return map;
  }, [rows]);

  const remove = (sheet: SheetSummary) => {
    // Files uploaded before uploads were tracked share their rows, so they can only go together.
    const targets = !sheet.id && legacy.length > 1 ? legacy : [sheet];
    const names = targets.map((s) => `• ${s.file} › ${s.sheet}`).join("\n");
    const message = targets.length > 1
      ? `These files were uploaded before each file was tracked separately, so they can only be removed together:\n${names}\n\nRemove all of them? Rows that are also in a newer upload stay.`
      : `Remove ${sheet.file} › ${sheet.sheet} from the Sales Dashboard?\n\nIts rows are deleted unless another uploaded file has the same rows.`;
    if (window.confirm(message)) onRemove(targets);
  };

  return (
    <section className="panel files-panel no-print" aria-label="Sales report files">
      <div className="queue-head">
        <h3><FileSpreadsheet size={16} />{files.length ? "Sales report files" : "Upload your sales report"}</h3>
        <button type="button" className="btn btn-primary btn-sm" onClick={onAdd} disabled={busy}><Plus size={14} />{busy ? "Working…" : "Add sales report"}</button>
      </div>
      {files.length ? (
        <ul className="file-list">
          {files.map((sheet) => {
            const s = stats.get(sheet.id || LEGACY_UPLOAD);
            const shared = !sheet.id && legacy.length > 1;
            const range = s && !shared && Number.isFinite(s.min) ? (s.min === s.max ? shortDate(new Date(s.min)) : `${shortDate(new Date(s.min))} – ${shortDate(new Date(s.max))}`) : "";
            const rowCount = s && !shared ? s.rows : sheet.rows;
            return (
              <li key={sheetKey(sheet)}>
                <div>
                  <strong>{sheet.file}</strong>
                  <small>{[sheet.sheet, `${count(rowCount)} rows`, range, sheet.uploadedAt ? `added ${added(sheet.uploadedAt)}` : "added earlier"].filter(Boolean).join(" · ")}</small>
                </div>
                <button type="button" className="btn btn-outline btn-sm danger" disabled={busy} onClick={() => remove(sheet)} aria-label={`Remove ${sheet.file}`}><Trash2 size={14} />Remove</button>
              </li>
            );
          })}
        </ul>
      ) : <p className="empty-note">Click <strong>Add sales report</strong> and choose the Detailed Sales Report export to see revenue, patient types, sources and physicians here.</p>}
      <p className="drill-meta">Files add up: rows that appear in more than one file are counted once. Removing a file only deletes rows no other file has.</p>
    </section>
  );
}
