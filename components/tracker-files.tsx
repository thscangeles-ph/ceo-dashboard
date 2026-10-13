"use client";

import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { count } from "@/lib/analyze";
import type { SheetSummary } from "@/lib/parse";
import { downloadTemplate, sheetKey } from "@/lib/parse";

const added = (d?: Date) => (d ? d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "");

/** The concierge inquiry tracker files uploaded into the Inquiry Tracker, and the button to upload another. */
export function TrackerFiles({ sheets, busy, onUpload }: { sheets: SheetSummary[]; busy: boolean; onUpload: () => void }) {
  const files = sheets.filter((s) => s.kind === "concierge");
  return (
    <section className="panel files-panel no-print" aria-label="Tracker files">
      <div className="queue-head">
        <h3><FileSpreadsheet size={16} />{files.length ? "Tracker files" : "No tracker file uploaded yet"}</h3>
        <button type="button" className="btn btn-primary btn-sm" onClick={onUpload} disabled={busy}><Upload size={14} />{busy ? "Working…" : "Upload tracker file"}</button>
      </div>
      {files.length ? (
        <ul className="file-list">
          {files.map((sheet) => (
            <li key={sheetKey(sheet)}>
              <div>
                <strong>{sheet.file}</strong>
                <small>{[sheet.sheet, `${count(sheet.rows)} inquiries`, sheet.uploadedAt ? `uploaded ${added(sheet.uploadedAt)}` : "uploaded earlier"].join(" · ")}</small>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <p className="empty-note">Upload the concierge inquiry tracker (.xlsx), or add inquiries one by one with <strong>Add inquiry</strong>. The tracker needs columns such as <code>Channel / Source</code>, <code>Name</code> and <code>Inquired</code>.</p>
          <button type="button" className="btn btn-outline btn-sm" style={{ margin: "12px 0" }} onClick={downloadTemplate}><Download size={14} />Download template</button>
        </>
      )}
      <p className="drill-meta">Uploading adds new inquiries and updates the ones already here; nothing is duplicated, so you can upload the latest tracker any time. Changes made in the app are kept.</p>
    </section>
  );
}
