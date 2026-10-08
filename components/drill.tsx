"use client";

import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { Download, X } from "lucide-react";
import type { Drill } from "@/lib/analyze";
import { count, pct, peso, titleCase, typeGroup } from "@/lib/analyze";
import type { SalesRow } from "@/lib/parse";

const DrillContext = createContext<(drill: Drill) => void>(() => undefined);
export const DrillProvider = DrillContext.Provider;
export const useDrill = () => useContext(DrillContext);

/** Props that make any element (table row, card, legend item) open a details panel on click or Enter. */
export function clickable(onSelect: () => void, label: string) {
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": label,
    title: "Click for details",
    onClick: onSelect,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); }
    },
  };
}

const TYPE_LABEL: Record<string, string> = { new: "NEW", scheduled: "Scheduled", walkin: "Walk-in", hmo: "HMO", returning: "Returning", home: "Home service", sendin: "Send-in", trial: "Clinical trial", other: "Other" };
const MAX_ROWS = 300;
const fmtDate = (date: Date | null) => (date ? date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "—");

function breakdown(rows: SalesRow[], keyOf: (row: SalesRow) => string) {
  const map = new Map<string, { patients: Set<string>; revenue: number }>();
  for (const row of rows) {
    const key = keyOf(row) || "—";
    const v = map.get(key) || { patients: new Set<string>(), revenue: 0 };
    v.patients.add(row.patient); v.revenue += row.revenue; map.set(key, v);
  }
  return Array.from(map, ([name, v]) => ({ name, patients: v.patients.size, revenue: v.revenue })).sort((a, b) => b.revenue - a.revenue);
}

function SalesDetails({ drill }: { drill: Extract<Drill, { kind: "sales" }> }) {
  const rows = useMemo(() => [...drill.rows].sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0)), [drill.rows]);
  const stats = useMemo(() => {
    const patients = new Set(rows.map((r) => r.patient)).size;
    const visits = new Set(rows.map((r) => r.transaction || `${r.patient}|${r.date?.toDateString()}`)).size;
    const revenue = rows.reduce((sum, r) => sum + r.revenue, 0);
    const discount = rows.reduce((sum, r) => sum + r.discount, 0);
    return { patients, visits, revenue, discount };
  }, [rows]);
  const byType = useMemo(() => breakdown(rows, (r) => TYPE_LABEL[typeGroup(r.patientType)]), [rows]);
  const byService = useMemo(() => breakdown(rows, (r) => titleCase(r.serviceLine || r.service)).slice(0, 6), [rows]);
  // Source only helps when it varies; returning patients carry N/A.
  const hasSource = new Set(rows.map((r) => r.source).filter((x) => x && !/^N\/?A$/i.test(x))).size > 1;

  const exportRows = () => {
    const sheet = XLSX.utils.json_to_sheet(rows.map((r) => ({
      Date: r.date ? fmtDate(r.date) : "", "Transaction No.": r.transaction, "Patient Type": r.patientType, Status: r.status, Source: r.source,
      "Referring Physician": r.physician, Department: r.serviceLine, "Test Examination": r.service, Category: r.category,
      "Gross Amount": r.gross, Discount: r.discount, "Total Payment": r.revenue,
    })));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Details");
    XLSX.writeFile(book, `${drill.title.replace(/[^\w\s-]/g, "").trim() || "details"}.xlsx`);
  };

  return (
    <>
      <div className="drill-stats">
        <div><span>Patients</span><b>{count(stats.patients)}</b></div>
        <div><span>Visits</span><b>{count(stats.visits)}</b></div>
        <div><span>Revenue</span><b>{peso(stats.revenue)}</b></div>
        <div><span>Avg / patient</span><b>{stats.patients ? peso(stats.revenue / stats.patients) : "—"}</b></div>
      </div>
      <p className="drill-meta">{count(rows.length)} billed line items{stats.discount ? ` · ${peso(stats.discount)} discount` : ""}</p>

      <div className="drill-breakdowns">
        {byType.length > 1 && (
          <div>
            <h4>By patient type</h4>
            <table><tbody>{byType.map((b) => <tr key={b.name}><td className="name">{b.name}</td><td className="num">{count(b.patients)} pts</td><td className="num">{peso(b.revenue)}</td><td className="num">{pct(b.revenue / (stats.revenue || 1), 0)}</td></tr>)}</tbody></table>
          </div>
        )}
        {byService.length > 1 && (
          <div>
            <h4>Top services</h4>
            <table><tbody>{byService.map((b) => <tr key={b.name}><td className="name">{b.name}</td><td className="num">{count(b.patients)} pts</td><td className="num">{peso(b.revenue)}</td><td className="num">{pct(b.revenue / (stats.revenue || 1), 0)}</td></tr>)}</tbody></table>
          </div>
        )}
      </div>

      <div className="drill-records-head">
        <h4>Records</h4>
        <button type="button" className="btn btn-outline" onClick={exportRows}><Download size={15} />Download Excel</button>
      </div>
      <div className="table-scroll">
        <table className="drill-table">
          <tbody>
            <tr><th>Date</th><th>Trans. No.</th><th>Type</th>{hasSource && <th>Source</th>}<th>Service</th><th className="num">Amount</th></tr>
            {rows.slice(0, MAX_ROWS).map((r) => (
              <tr key={r.rowKey}>
                <td>{fmtDate(r.date)}</td><td>{r.transaction || "—"}</td><td className="name">{r.patientType || "—"}</td>
                {hasSource && <td className="name">{r.source || "—"}</td>}
                <td className="name">{r.service || titleCase(r.serviceLine) || "—"}</td><td className="num">{peso(r.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > MAX_ROWS && <p className="drill-meta">Showing the first {MAX_ROWS} of {count(rows.length)} records. Download Excel for all of them.</p>}
    </>
  );
}

function InquiryDetails({ drill }: { drill: Extract<Drill, { kind: "inquiries" }> }) {
  const booked = drill.rows.filter((r) => r.booked).length;
  const served = drill.rows.filter((r) => r.served).length;
  return (
    <>
      <div className="drill-stats">
        <div><span>Inquiries</span><b>{count(drill.rows.length)}</b></div>
        <div><span>Booked</span><b>{count(booked)}</b></div>
        <div><span>Served</span><b>{count(served)}</b></div>
        <div><span>Booking rate</span><b>{drill.rows.length ? pct(booked / drill.rows.length, 0) : "—"}</b></div>
      </div>
      <h4>Inquiries</h4>
      <div className="table-scroll">
        <table className="drill-table">
          <tbody>
            <tr><th>Date</th><th>Patient</th><th>Channel</th><th>Branch</th><th>Procedure</th><th>Status</th><th>Remarks</th></tr>
            {drill.rows.map((r) => (
              <tr key={r.rowKey}>
                <td>{fmtDate(r.date)}</td><td className="name">{r.patient || "—"}</td><td className="name">{r.channel}</td><td className="name">{r.branch}</td>
                <td className="name">{r.procedure || "—"}</td><td className="name">{r.noShow ? "No-show" : r.served ? "Served" : r.booked ? "Booked" : "Not booked"}</td><td className="name">{r.remarks || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Slide-over panel (bottom sheet on phones) listing the records behind whatever was clicked. */
export function DrillPanel({ drill, context, onClose }: { drill: Drill | null; context: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!drill) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; previous?.focus?.(); };
  }, [drill, onClose]);
  if (!drill) return null;
  return (
    <div className="drill-overlay no-print" onClick={onClose}>
      <aside className="drill" role="dialog" aria-modal="true" aria-labelledby="drill-title" onClick={(e) => e.stopPropagation()}>
        <div className="drill-head">
          <div>
            <span className="tag">Details</span>
            <h2 id="drill-title">{drill.title}</h2>
            <p className="drill-meta">{drill.subtitle ? `${drill.subtitle} · ` : ""}{context}</p>
          </div>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close details"><X size={20} /></button>
        </div>
        <div className="drill-body">
          {drill.rows.length === 0 ? <p className="empty-note">No records.</p> : drill.kind === "sales" ? <SalesDetails drill={drill} /> : <InquiryDetails drill={drill} />}
        </div>
      </aside>
    </div>
  );
}
