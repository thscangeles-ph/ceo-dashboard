"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Plus, Search, SquarePen } from "lucide-react";
import { count, longDate } from "@/lib/analyze";
import { inquiryTopic } from "@/lib/crm";
import { effectiveResponded } from "@/lib/lead";
import type { InquiryRow, SheetSummary } from "@/lib/parse";
import { TrackerFiles } from "@/components/tracker-files";
import { PdfButton } from "@/components/pdf-button";
import { trackerReport } from "@/lib/reports";
import type { CellField, NextStep, StepTone } from "@/lib/tracker";
import { applyEdit, cellValue, CHANNELS, exportTracker, nextStep, PAYMENT_MODES, STEP_LABEL, stepsOf, stepsText } from "@/lib/tracker";

type Kind = "text" | "area" | "tel" | "date" | "time" | "yesno" | "patient" | "money";
type Column = { field: CellField; label: string; kind: Kind; list?: string; show: (r: InquiryRow) => string; width?: number };

const dash = (v: string | null | undefined) => v || "—";
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

/** The scheduling tracker's own columns, in the same order as the Excel file. */
const COLUMNS: Column[] = [
  { field: "patientStatus", label: "New or Returning Patient", kind: "patient", show: (r) => dash(r.patientStatus) },
  { field: "date", label: "Date", kind: "date", show: (r) => day(r.date) },
  { field: "time", label: "Time", kind: "time", show: (r) => (r.hasTime && r.date ? r.date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—") },
  { field: "channel", label: "Channel", kind: "text", list: "trk-channels", show: (r) => (r.channel === "Not recorded" ? "—" : r.channel) },
  { field: "patient", label: "Name", kind: "text", show: (r) => dash(r.patient) },
  { field: "contact", label: "Contact Number", kind: "tel", show: (r) => dash(r.contact) },
  { field: "procedure", label: "Procedure / Test", kind: "text", list: "trk-procedures", show: (r) => dash(r.procedure) },
  { field: "branch", label: "Branch", kind: "text", list: "trk-branches", show: (r) => (r.branch === "Not recorded" ? "—" : r.branch) },
  { field: "payment", label: "Mode of Payment", kind: "text", list: "trk-payments", show: (r) => dash(r.payment) },
  { field: "inquired", label: "Inquired", kind: "area", show: (r) => dash(r.inquired), width: 240 },
  { field: "responded", label: "Responded", kind: "yesno", show: (r) => (effectiveResponded(r) ? "YES" : "NO") },
  { field: "followUpDate", label: "If not booked, schedule of follow-up", kind: "date", show: (r) => (r.followUpDate ? day(r.followUpDate) : dash(r.followUp)) },
  { field: "reminderDate", label: "If booked, send a reminder", kind: "date", show: (r) => dash(r.reminder) },
  { field: "bookedDate", label: "Booked (Date of Booking)", kind: "date", show: (r) => (r.booked ? (r.bookedDate ? day(r.bookedDate) : "Yes") : "—") },
  { field: "noShow", label: "No Show", kind: "yesno", show: (r) => (r.noShow ? "Yes" : "No") },
  { field: "served", label: "Served", kind: "yesno", show: (r) => (r.served ? "Yes" : "No") },
  { field: "revenue", label: "Revenue (Cost of Procedure)", kind: "money", show: (r) => (r.revenue ? `₱${Math.round(r.revenue).toLocaleString("en-PH")}` : "—") },
  { field: "action", label: "Other Applicable Actions (Follow-up)", kind: "area", show: (r) => dash(stepsText(stepsOf(r))), width: 240 },
];

type View = "all" | "action" | "overdue" | "notResponded" | "price" | "scheduled" | "complete";
const VIEWS: { key: View; label: string; test: (r: InquiryRow, s: NextStep) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "action", label: "Needs action", test: (_, s) => s.tone === "overdue" || s.tone === "today" || s.tone === "todo" },
  { key: "overdue", label: "Overdue", test: (_, s) => s.tone === "overdue" },
  { key: "notResponded", label: "Not responded", test: (r) => !effectiveResponded(r) },
  { key: "price", label: "Price question, no reply", test: (r) => !effectiveResponded(r) && inquiryTopic(r) === "Price & fees" },
  { key: "scheduled", label: "Scheduled", test: (_, s) => s.tone === "wait" },
  { key: "complete", label: "Complete", test: (_, s) => s.tone === "done" },
];
const TONE_ORDER: Record<StepTone, number> = { overdue: 0, today: 1, todo: 2, wait: 3, done: 4 };
const PAGE = 50;

/**
 * The working copy of the concierge scheduling tracker. Every inquiry is a row in the Excel file's own
 * columns, edited in place cell by cell, with a Next Step box that says what to do or Complete.
 * The CRM Dashboard is built from these rows.
 */
export function InquiryTracker({ rows, sheets, busy, onUpload, onSave, onAdd, onOpen, initialSearch = "", actor = "" }: {
  rows: InquiryRow[];
  sheets: SheetSummary[];
  busy: boolean;
  onUpload: () => void;
  onSave: (row: InquiryRow, base: InquiryRow) => void | Promise<void>;
  onAdd: () => void;
  onOpen: (row: InquiryRow) => void;
  /** Who is signed in, recorded on each step added. */
  actor?: string;
  initialSearch?: string;
}) {
  const today = useMemo(() => new Date(), []);
  const [search, setSearch] = useState(initialSearch);
  const [view, setView] = useState<View>(initialSearch ? "all" : "action");
  const [branch, setBranch] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "due">("newest");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<{ key: string; field: CellField } | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  const steps = useMemo(() => new Map(rows.map((r) => [r.rowKey, nextStep(r, today)])), [rows, today]);
  const stepOf = (r: InquiryRow) => steps.get(r.rowKey) || nextStep(r, today);
  const branches = useMemo(() => Array.from(new Set(rows.map((r) => r.branch))).sort(), [rows]);
  const lists = useMemo(() => {
    const unique = (pick: (r: InquiryRow) => string, extra: string[] = []) => Array.from(new Set([...rows.map(pick), ...extra].filter((v) => v && v !== "Not recorded"))).sort();
    return {
      "trk-channels": CHANNELS,
      "trk-procedures": unique((r) => r.procedure), "trk-branches": unique((r) => r.branch, ["Angeles", "Malolos"]), "trk-payments": unique((r) => r.payment, PAYMENT_MODES),
    };
  }, [rows]);

  // Search, branch and dates first, so each view chip shows how many rows it would show.
  const base = useMemo(() => {
    const q = search.trim().toUpperCase(), digits = search.replace(/\D/g, "");
    const start = from ? new Date(`${from}T00:00:00`) : null, end = to ? new Date(`${to}T23:59:59`) : null;
    return rows.filter((r) => (branch === "all" || r.branch === branch) && (!start || (r.date && r.date >= start)) && (!end || (r.date && r.date <= end)) && (!q ||
      [r.patient, r.procedure, r.inquired, r.channel, r.action, r.remarks].some((v) => v.toUpperCase().includes(q)) ||
      (digits.length >= 3 && r.contact.replace(/\D/g, "").includes(digits))));
  }, [rows, search, branch, from, to]);
  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.key, base.filter((r) => v.test(r, stepOf(r))).length])) as Record<View, number>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, steps]);
  const shown = useMemo(() => {
    const test = VIEWS.find((v) => v.key === view)!.test;
    const list = base.filter((r) => test(r, stepOf(r)));
    const time = (r: InquiryRow) => r.date?.getTime() || 0;
    return list.sort((a, b) => sort === "oldest" ? time(a) - time(b)
      : sort === "due" ? TONE_ORDER[stepOf(a).tone] - TONE_ORDER[stepOf(b).tone] || time(a) - time(b)
        : time(b) - time(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, view, sort, steps]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const current = Math.min(page, pages - 1);
  const pageRows = shown.slice(current * PAGE, current * PAGE + PAGE);
  // Row numbers follow the Excel file: oldest inquiry = 1.
  const numbers = useMemo(() => new Map([...rows].sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0)).map((r, i) => [r.rowKey, i + 1])), [rows]);

  const goTo = (n: number) => { setPage(n); scroller.current?.scrollTo({ top: 0 }); };
  const filterBy = (fn: () => void) => { fn(); setPage(0); };
  // The open cell, also kept in a ref: a blur that follows Enter or Esc must not save a second time.
  const open = useRef<string | null>(null);
  const start = (row: InquiryRow, field: CellField) => { open.current = `${row.rowKey}|${field}`; setEditing({ key: row.rowKey, field }); setDraft(cellValue(row, field)); setError(""); };
  const cancel = () => { open.current = null; setEditing(null); };
  const commit = async (row: InquiryRow, field: CellField, value: string) => {
    if (open.current !== `${row.rowKey}|${field}`) return;
    open.current = null;
    setEditing(null);
    if (value.trim() === cellValue(row, field).trim()) return;
    if (field === "patient" && !value.trim()) { setError("The name can't be empty."); return; }
    if (field === "date" && !value) { setError("The inquiry date can't be empty."); return; }
    setSaving(row.rowKey);
    try { await onSave(applyEdit(row, field, value, actor), row); } catch (e) { setError(e instanceof Error ? e.message : "Could not save. Try again."); }
    setSaving("");
  };

  const editor = (row: InquiryRow, col: Column) => {
    const keys = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
      if (e.key === "Enter" && !(col.kind === "area" && e.shiftKey)) { e.preventDefault(); void commit(row, col.field, draft); }
    };
    const common = { autoFocus: true, onKeyDown: keys, "aria-label": `${col.label} for ${row.patient || "this inquiry"}` };
    if (col.kind === "yesno" || col.kind === "patient") {
      const options = col.kind === "yesno" ? [["yes", col.field === "responded" ? "YES" : "Yes"], ["no", col.field === "responded" ? "NO" : "No"]] : [["New", "New"], ["Returning", "Returning"], ["", "—"]];
      return <select {...common} value={draft} onBlur={cancel} onChange={(e) => void commit(row, col.field, e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
    }
    // Typing is kept in capitals, like the inquiry form. The action cell adds a new step; earlier steps stay.
    if (col.kind === "area") return <textarea {...common} rows={3} value={draft} placeholder={col.field === "action" ? "ADD A STEP TAKEN…" : undefined} onChange={(e) => setDraft(e.target.value.toUpperCase())} onBlur={() => void commit(row, col.field, draft)} />;
    const type = col.kind === "date" ? "date" : col.kind === "time" ? "time" : col.kind === "tel" ? "tel" : "text";
    return <input {...common} type={type} list={col.list} inputMode={col.kind === "money" ? "decimal" : undefined} value={draft} onChange={(e) => setDraft(col.kind === "text" ? e.target.value.toUpperCase() : e.target.value)} onBlur={() => void commit(row, col.field, draft)} />;
  };

  return (
    <>
      <header className="top">
        <div>
          <h1>Inquiry Tracker</h1>
          <p className="sub">Every patient inquiry in the concierge inquiry tracker&apos;s columns. Click a cell to edit it like in Excel. The CRM Dashboard is built from this list.</p>
          <div className="crm-actions no-print">
            <button type="button" className="btn btn-primary" onClick={onAdd}><Plus size={16} />Add inquiry</button>
            <button type="button" className="btn btn-outline" onClick={() => exportTracker(rows)} disabled={!rows.length}><Download size={16} />Export Excel</button>
            {shown.length > 0 && <PdfButton make={() => trackerReport(shown.map((r) => ({ row: r, step: stepOf(r), n: numbers.get(r.rowKey) || 0 })), {
              view: VIEWS.find((v) => v.key === view)!.label,
              filters: [`Showing: ${VIEWS.find((v) => v.key === view)!.label} (${shown.length} of ${rows.length} inquiries)`, branch !== "all" ? `Branch: ${branch}` : "", from || to ? `Dates: ${from || "first"} to ${to || "last"}` : "Dates: all", search ? `Search: "${search}"` : ""].filter(Boolean).join(" · "),
              counts: VIEWS.filter((v) => v.key !== "all").map((v) => ({ label: v.label, value: counts[v.key] })),
            })} />}
          </div>
        </div>
        <div className="period">
          Inquiries in the tracker<br /><strong>{count(rows.length)}</strong>
          <div className="filters-note">Next steps as of {longDate(today)}</div>
        </div>
      </header>

      <TrackerFiles sheets={sheets} busy={busy} onUpload={onUpload} />

      <div className="filterbar trk-filters no-print">
        <label className="trk-search">Search<span><Search size={15} aria-hidden /><input type="search" value={search} placeholder="Name, number, procedure, question…" onChange={(e) => filterBy(() => setSearch(e.target.value))} /></span></label>
        <label>Branch<select value={branch} onChange={(e) => filterBy(() => setBranch(e.target.value))}><option value="all">All branches</option>{branches.map((b) => <option key={b}>{b}</option>)}</select></label>
        <label>From<input type="date" value={from} onChange={(e) => filterBy(() => setFrom(e.target.value))} /></label>
        <label>To<input type="date" value={to} onChange={(e) => filterBy(() => setTo(e.target.value))} /></label>
        <label>Sort<select value={sort} onChange={(e) => filterBy(() => setSort(e.target.value as typeof sort))}><option value="newest">Newest first</option><option value="oldest">Oldest first (as in Excel)</option><option value="due">Most urgent first</option></select></label>
      </div>
      <div className="chips trk-views no-print" role="group" aria-label="Show inquiries">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" className={`chip-btn${v.key === "overdue" || v.key === "price" ? " overdue" : ""}${view === v.key ? " on" : ""}`} aria-pressed={view === v.key} onClick={() => filterBy(() => setView(v.key))}>
            {v.label} {count(counts[v.key])}
          </button>
        ))}
      </div>

      {error && <div className="alert" role="alert"><div>{error}</div></div>}

      <div className="panel trk-panel">
        {shown.length ? (
          <div className="trk-scroll" ref={scroller}>
            <table className="trk">
              <thead>
                <tr className="trk-group">
                  <th className="pin pin-1" /><th className="pin pin-2" />
                  {COLUMNS.map((c) => c.field === "noShow" ? <th key={c.field} colSpan={2} className="grp">OUTCOME (REMARKS)</th> : c.field === "served" ? null : <th key={c.field} />)}
                </tr>
                <tr>
                  <th className="pin pin-1">#</th>
                  <th className="pin pin-2">Next step / status</th>
                  {COLUMNS.map((c) => <th key={c.field} style={c.width ? { minWidth: c.width } : undefined}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const step = stepOf(r);
                  return (
                    <tr key={r.rowKey} className={saving === r.rowKey ? "saving" : undefined}>
                      <td className="pin pin-1 num">{numbers.get(r.rowKey)}</td>
                      <td className="pin pin-2">
                        <button type="button" className={`step ${step.tone}`} onClick={() => onOpen(r)} title="Open the full form">
                          <strong>{step.text}</strong>
                          <small><span className="step-tag">{STEP_LABEL[step.tone]}</span> · {step.detail}</small>
                          <SquarePen size={13} className="step-open" aria-hidden />
                        </button>
                      </td>
                      {COLUMNS.map((c) => {
                        const isEditing = editing?.key === r.rowKey && editing.field === c.field;
                        const value = c.show(r);
                        const flag = c.field === "responded" && value === "NO" ? " flag" : "";
                        return (
                          <td key={c.field} className={`cell ${c.kind}${flag}${isEditing ? " editing" : ""}`} style={c.width ? { minWidth: c.width } : undefined}
                            tabIndex={isEditing ? -1 : 0} aria-label={isEditing ? undefined : `${c.label}: ${value}. Press Enter to edit.`}
                            onClick={() => !isEditing && start(r, c.field)}
                            onKeyDown={(e) => { if (!isEditing && (e.key === "Enter" || e.key === "F2")) { e.preventDefault(); start(r, c.field); } }}>
                            {isEditing ? editor(r, c) : <span className={value === "—" ? "blank" : undefined}>{value}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-note">{rows.length ? "No inquiries match. Try another view or clear the search." : "No inquiries yet. Click Add inquiry, or upload the concierge inquiry tracker with Add files."}</p>
        )}
        {shown.length > 0 && (
          <div className="trk-foot no-print">
            <span>{count(shown.length)} {shown.length === 1 ? "inquiry" : "inquiries"}{pages > 1 ? ` · showing ${count(current * PAGE + 1)}–${count(Math.min(shown.length, current * PAGE + PAGE))}` : ""} · Enter saves, Esc cancels</span>
            {pages > 1 && (
              <span className="trk-pages">
                <button type="button" className="btn btn-outline btn-sm" disabled={current === 0} onClick={() => goTo(current - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button>
                Page {current + 1} of {pages}
                <button type="button" className="btn btn-outline btn-sm" disabled={current >= pages - 1} onClick={() => goTo(current + 1)} aria-label="Next page"><ChevronRight size={15} /></button>
              </span>
            )}
          </div>
        )}
      </div>
      {Object.entries(lists).map(([id, values]) => <datalist key={id} id={id}>{values.map((v) => <option key={v} value={v} />)}</datalist>)}
    </>
  );
}
