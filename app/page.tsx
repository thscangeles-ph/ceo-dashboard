"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ClipboardList, Download, FileSpreadsheet, Printer, RefreshCw, ShieldCheck, Smartphone, Upload } from "lucide-react";
import { InstallAppButton } from "@/components/pwa";
import { Briefing, DailyVolume, Funnel, Kpis, Physicians, RevenueMix, Sources, StillOpen } from "@/components/dashboard";
import type { Filters, PatientTypeFilter, StatusFilter } from "@/lib/analyze";
import { analyzeInquiries, analyzeSales, applyFilters, buildDecisions, buildFindings, count, isNewType, isPaid, longDate } from "@/lib/analyze";
import type { InquiryRow, SalesRow, SheetSummary } from "@/lib/parse";
import { downloadTemplate, parseWorkbooks } from "@/lib/parse";

type LaunchParams = { files: { getFile: () => Promise<File> }[] };
declare global {
  interface Window { launchQueue?: { setConsumer: (consumer: (params: LaunchParams) => void) => void } }
}

const PATIENT_TYPE_LABEL: Record<PatientTypeFilter, string> = { new: "NEW + HMO/NEW", cash: "NEW", hmo: "HMO/NEW", all: "All" };
const EXCEL = /\.(xlsx|xlsm|xls)$/i;
const toInputDate = (date: Date | null) => (date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : "");

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sales, setSales] = useState<SalesRow[]>([]);
  const [inquiries, setInquiries] = useState<InquiryRow[]>([]);
  const [sheets, setSheets] = useState<SheetSummary[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [filters, setFilters] = useState<Filters>({ patientType: "new", status: "paid", from: "", to: "" });

  const processFiles = useCallback(async (incoming: File[]) => {
    const excelFiles = incoming.filter((file) => EXCEL.test(file.name));
    if (!excelFiles.length) { setError("Please upload an Excel file in .xlsx or .xls format."); return; }
    setBusy(true);
    try {
      const parsed = await parseWorkbooks(excelFiles);
      if (!parsed.sales.length && !parsed.inquiries.length) throw new Error(parsed.problems.join(" ") || "No usable rows were found in the workbook.");
      // Adding files merges them with what is already loaded; identical rows are counted once.
      const salesMap = new Map(sales.map((row) => [row.rowKey, row]));
      parsed.sales.forEach((row) => salesMap.set(row.rowKey, row));
      const inquiryMap = new Map(inquiries.map((row) => [row.rowKey, row]));
      parsed.inquiries.forEach((row) => inquiryMap.set(row.rowKey, row));
      const nextSales = Array.from(salesMap.values());
      setSales(nextSales);
      setInquiries(Array.from(inquiryMap.values()));
      setSheets((current) => {
        const merged = new Map(current.map((item) => [`${item.file}|${item.sheet}`, item]));
        parsed.sheets.forEach((item) => merged.set(`${item.file}|${item.sheet}`, item));
        return Array.from(merged.values());
      });
      setFilters({
        patientType: nextSales.some((row) => isNewType(row.patientType)) ? "new" : "all",
        status: nextSales.some((row) => isPaid(row.status)) ? "paid" : "all",
        from: "", to: "",
      });
      setError(parsed.problems.join(" "));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The workbook could not be read.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [sales, inquiries]);

  // Installed on a computer, the app can be chosen in "Open with" for Excel files.
  const latestProcess = useRef(processFiles);
  useEffect(() => { latestProcess.current = processFiles; }, [processFiles]);
  useEffect(() => {
    window.launchQueue?.setConsumer(async (params) => {
      if (!params.files?.length) return;
      const files = await Promise.all(params.files.map((handle) => handle.getFile()));
      void latestProcess.current(files);
    });
  }, []);

  const reset = () => { setSales([]); setInquiries([]); setSheets([]); setError(""); setFilters({ patientType: "new", status: "paid", from: "", to: "" }); };

  const hasTypes = sales.some((row) => row.patientType);
  const hasNew = sales.some((row) => isNewType(row.patientType));
  const hasPaid = sales.some((row) => isPaid(row.status));
  const filtered = useMemo(() => applyFilters(sales, filters), [sales, filters]);
  const summary = useMemo(() => (filtered.length ? analyzeSales(filtered) : null), [filtered]);
  const funnel = useMemo(() => (inquiries.length ? analyzeInquiries(inquiries) : null), [inquiries]);
  const findings = useMemo(() => (summary ? buildFindings(summary, funnel) : []), [summary, funnel]);
  const decisions = useMemo(() => (summary ? buildDecisions(summary, funnel) : []), [summary, funnel]);
  const allDates = useMemo(() => {
    const times = sales.map((row) => row.date?.getTime()).filter((t): t is number => typeof t === "number");
    return times.length ? { min: new Date(Math.min(...times)), max: new Date(Math.max(...times)) } : null;
  }, [sales]);

  const period = summary?.minDate && summary.maxDate
    ? summary.minDate.toDateString() === summary.maxDate.toDateString() ? longDate(summary.minDate) : `${longDate(summary.minDate)} – ${longDate(summary.maxDate)}`
    : "—";
  const newOnly = filters.patientType !== "all";
  const salesSheets = sheets.filter((sheet) => sheet.kind === "sales");
  const columns = new Set(salesSheets.flatMap((sheet) => sheet.columns));
  const gaps = [
    !funnel && "No concierge log was uploaded, so inquiries that never became paying patients are invisible. Add the Central Concierge workbook (or a sheet with Channel and Status columns) to see the full funnel.",
    funnel && funnel.inquiries < 30 && `The concierge log has only ${count(funnel.inquiries)} inquiries. Conversion rates need weeks of real volume before they are decision-grade.`,
    funnel && summary && "The concierge log and the billing report can't be joined patient-by-patient yet. Once both share a common patient ID, this becomes one continuous Inquiry → Revenue view.",
    salesSheets.length > 0 && !columns.has("physician") && "The sales report has no referring-physician column, so the physician concentration and top-referrer list are hidden.",
    salesSheets.length > 0 && !columns.has("category") && "The sales report has no patient category column (REGULAR, SENIOR, PWD), so statutory and discretionary discounts can't be separated.",
    salesSheets.length > 0 && !columns.has("source") && "The sales report has no Source column, so revenue can't be credited to channels.",
  ].filter((gap): gap is string => Boolean(gap));

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  const hasData = sales.length > 0 || inquiries.length > 0;

  return (
    <main onDragEnter={(e) => { e.preventDefault(); setDragging(true); }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setDragging(false); void processFiles(Array.from(e.dataTransfer.files)); }}>
      <div className="appbar">
        <div className="appbar-inner">
          <div className="appbar-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/theheartspecialists.png" alt="" width={36} height={48} />
            <div style={{ minWidth: 0 }}><div className="clinic">THE HEART SPECIALISTS CLINIC</div><div className="app">CEO Dashboard</div></div>
          </div>
          <div className="appbar-actions">
            <InstallAppButton />
            {hasData && <button type="button" className="btn btn-ghost" onClick={() => inputRef.current?.click()} aria-label="Add Excel files"><Upload size={16} /><span className="hide-sm">Add files</span></button>}
            {summary && <button type="button" className="btn btn-ghost" onClick={() => window.print()} aria-label="Print or save as PDF"><Printer size={16} /><span className="hide-sm">Print</span></button>}
            {hasData && <button type="button" className="btn btn-ghost" onClick={reset} aria-label="Start over"><RefreshCw size={16} /><span className="hide-sm">Start over</span></button>}
          </div>
        </div>
      </div>
      <input ref={inputRef} type="file" multiple accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="sr-only" onChange={(e) => void processFiles(Array.from(e.target.files || []))} />

      <div className="wrap">
        {!hasData && (
          <>
            <div className={`dropzone${dragging ? " dragging" : ""}`} onDragLeave={() => setDragging(false)}>
              <div className="drop-icon"><Upload size={26} /></div>
              <div>
                <h2>Upload the Excel report</h2>
                <p>Use the Detailed Sales Report export. Add the Central Concierge log too (as another file or another sheet) to see the inquiry funnel. The summary dashboard is generated instantly.</p>
                <div className="actions">
                  <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={busy}><FileSpreadsheet size={17} />{busy ? "Reading…" : "Choose Excel files"}</button>
                  <button type="button" className="btn btn-outline" onClick={downloadTemplate}><Download size={16} />Download template</button>
                  <span className="hint">.xlsx or .xls · or drag files here</span>
                </div>
              </div>
            </div>
            <div className="privacy"><ShieldCheck size={17} /><span>Workbooks are read on this device. Nothing is uploaded to a server, and the data is cleared when you close the app.</span></div>
          </>
        )}

        {error && <div className="alert" role="alert"><AlertCircle size={18} /><div><strong>Check the workbook.</strong> {error}</div></div>}
        {sheets.length > 0 && (
          <div className="loaded no-print" aria-label="Loaded sheets">
            {sheets.map((sheet) => <span key={`${sheet.file}|${sheet.sheet}`} className="chip"><CheckCircle2 size={14} /><span>{sheet.file} › {sheet.sheet}</span><small>{sheet.kind === "sales" ? "sales" : "concierge"} · {count(sheet.rows)} rows</small></span>)}
          </div>
        )}

        {!hasData && (
          <div className="welcome">
            <div className="panel"><h3><FileSpreadsheet size={16} />Sales report columns</h3><p>Needs <code>Date</code>, <code>Patient Name</code> and <code>Total Payment</code>. Also uses <code>Transaction No.</code>, <code>Patient Type</code>, <code>Status</code>, <code>Source</code>, <code>Referring Physician</code>, <code>Department</code>, <code>Test Examination</code>, <code>Patient Category</code>, <code>Gross Amount</code> and <code>Discount</code> when present.</p></div>
            <div className="panel"><h3><ClipboardList size={16} />Concierge log columns</h3><p>Needs <code>Channel</code> and <code>Status</code> (Booked, Served, No-show, No booking). Also uses <code>Date</code>, <code>Patient Name</code>, <code>Branch</code>, <code>Procedure</code>, <code>Follow-up Date</code> and <code>Remarks</code>.</p></div>
            <div className="panel"><h3><Smartphone size={16} />Use it as an app</h3><p>Tap <strong>Install app</strong> above (Chrome or Edge on PC and Android), or in Safari on iPhone tap <strong>Share → Add to Home Screen</strong>. It opens full screen and works offline.</p></div>
          </div>
        )}

        {sales.length > 0 && (
          <>
            <header className="top">
              <div>
                <h1>CEO Summary Dashboard</h1>
                <p className="sub">The Heart Specialists Clinic &amp; Diagnostic: revenue, patients and where they come from</p>
              </div>
              <div className="period">
                Reporting period<br /><strong>{period}</strong>
                <div className="filters-note">{hasTypes ? `Patient type: ${PATIENT_TYPE_LABEL[filters.patientType]}` : "All patient types"}{hasPaid ? ` · Status: ${filters.status === "paid" ? "PAID" : "All"}` : ""}</div>
              </div>
            </header>

            <div className="filterbar no-print">
              {hasTypes && (
                <label>Patient type
                  <select value={filters.patientType} onChange={(e) => setFilter("patientType", e.target.value as PatientTypeFilter)}>
                    {hasNew && <option value="new">New (NEW + HMO/NEW)</option>}
                    {hasNew && <option value="cash">NEW only</option>}
                    {hasNew && <option value="hmo">HMO/NEW only</option>}
                    <option value="all">All patient types</option>
                  </select>
                </label>
              )}
              {hasPaid && (
                <label>Status
                  <select value={filters.status} onChange={(e) => setFilter("status", e.target.value as StatusFilter)}>
                    <option value="paid">Paid only</option>
                    <option value="all">All statuses</option>
                  </select>
                </label>
              )}
              <label>From<input type="date" value={filters.from} min={toInputDate(allDates?.min ?? null)} max={toInputDate(allDates?.max ?? null)} onChange={(e) => setFilter("from", e.target.value)} /></label>
              <label>To<input type="date" value={filters.to} min={toInputDate(allDates?.min ?? null)} max={toInputDate(allDates?.max ?? null)} onChange={(e) => setFilter("to", e.target.value)} /></label>
            </div>

            {summary ? (
              <>
                <Kpis s={summary} newOnly={newOnly && hasTypes} />
                <section><Briefing s={summary} findings={findings} decisions={decisions} period={period} /></section>
                {funnel && <Funnel q={funnel} />}
                <DailyVolume s={summary} />
                <Sources s={summary} />
                <RevenueMix s={summary} />
                <Physicians s={summary} />
                <StillOpen gaps={gaps} />
                <footer className="source">
                  Source: {salesSheets.map((sheet) => sheet.file).filter((f, i, all) => all.indexOf(f) === i).join(", ")}{hasTypes ? `, Patient Type = ${PATIENT_TYPE_LABEL[filters.patientType]}` : ""}{hasPaid && filters.status === "paid" ? ", Status = PAID" : ""}, {period} ({count(summary.lineItems)} billed line items across {count(summary.visits)} visits). Patient names are used only to count unique patients and are never shown from the sales report.
                </footer>
              </>
            ) : (
              <div className="alert"><AlertCircle size={18} /><div>No rows match these filters. Widen the date range or choose another patient type.</div></div>
            )}
          </>
        )}

        {sales.length === 0 && funnel && (
          <>
            <header className="top"><div><h1>CEO Summary Dashboard</h1><p className="sub">Only a concierge log is loaded. Add the Detailed Sales Report to see revenue and patients.</p></div></header>
            <Funnel q={funnel} />
          </>
        )}
      </div>
    </main>
  );
}
