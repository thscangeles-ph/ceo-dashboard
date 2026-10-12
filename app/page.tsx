"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, BarChart3, CheckCircle2, ClipboardList, Download, FileSpreadsheet, MousePointerClick, Printer, RefreshCw, ShieldCheck, Smartphone, Upload, Users } from "lucide-react";
import { InstallAppButton } from "@/components/pwa";
import { CrmDashboard } from "@/components/crm";
import { DrillPanel, DrillProvider } from "@/components/drill";
import { Briefing, DailyVolume, Funnel, Kpis, PatientTypes, Physicians, RevenueMix, Sources, StillOpen } from "@/components/dashboard";
import type { Drill, Filters, PatientTypeFilter, StatusFilter } from "@/lib/analyze";
import { analyzeInquiries, analyzeSales, applyFilters, buildDecisions, buildFindings, count, isPaid, longDate, matchesType, PATIENT_TYPES, patientTypeInfo } from "@/lib/analyze";
import type { InquiryRow, SalesRow, SheetSummary } from "@/lib/parse";
import { downloadTemplate, parseWorkbooks } from "@/lib/parse";

type LaunchParams = { files: { getFile: () => Promise<File> }[] };
declare global {
  interface Window { launchQueue?: { setConsumer: (consumer: (params: LaunchParams) => void) => void } }
}

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
  const [drill, setDrill] = useState<Drill | null>(null);
  const closeDrill = useCallback(() => setDrill(null), []);
  const [filters, setFilters] = useState<Filters>({ patientType: "all", status: "paid", from: "", to: "" });
  const [tab, setTab] = useState<"summary" | "crm">("summary");

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
        patientType: "all",
        status: nextSales.some((row) => isPaid(row.status)) ? "paid" : "all",
        from: "", to: "",
      });
      setError(parsed.problems.join(" "));
      // Land on the tab the new file belongs to.
      if (parsed.inquiries.length && !parsed.sales.length) setTab("crm");
      else if (parsed.sales.length && !parsed.inquiries.length) setTab("summary");
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

  const reset = () => { setSales([]); setInquiries([]); setSheets([]); setError(""); setFilters({ patientType: "all", status: "paid", from: "", to: "" }); setTab("summary"); };

  const hasTypes = sales.some((row) => row.patientType);
  // Unique patients per patient-type option, shown in the filter so empty types are obvious.
  const typeCounts = useMemo(() => {
    const base = applyFilters(sales, { ...filters, patientType: "all" });
    return Object.fromEntries(PATIENT_TYPES.map((t) => [t.key, new Set(base.filter((row) => matchesType(t.key, row.patientType)).map((row) => row.patient)).size])) as Record<PatientTypeFilter, number>;
  }, [sales, filters]);
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
  const typeInfo = patientTypeInfo(filters.patientType);
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
    <DrillProvider value={setDrill}>
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
            {(summary || inquiries.length > 0) && <button type="button" className="btn btn-ghost" onClick={() => window.print()} aria-label="Print or save as PDF"><Printer size={16} /><span className="hide-sm">Print</span></button>}
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
            {sheets.map((sheet) => <span key={`${sheet.file}|${sheet.sheet}`} className="chip"><CheckCircle2 size={14} /><span>{sheet.file} › {sheet.sheet}</span><small>{sheet.kind === "sales" ? "sales report" : "scheduling tracker"} · {count(sheet.rows)} rows</small></span>)}
          </div>
        )}

        {hasData && (
          <nav className="tabs no-print" aria-label="Dashboard sections">
            <button type="button" className={tab === "summary" ? "on" : ""} aria-current={tab === "summary" ? "page" : undefined} onClick={() => setTab("summary")}><BarChart3 size={16} />CEO summary{!sales.length && <span className="hide-sm"> (no sales report)</span>}</button>
            <button type="button" className={tab === "crm" ? "on" : ""} aria-current={tab === "crm" ? "page" : undefined} onClick={() => setTab("crm")}><Users size={16} />Patient CRM{inquiries.length ? <small>{count(inquiries.length)}</small> : <span className="hide-sm"> (no tracker)</span>}</button>
          </nav>
        )}

        {hasData && tab === "crm" && (inquiries.length
          ? <CrmDashboard rows={inquiries} />
          : <div className="panel empty-tab"><h3><ClipboardList size={16} />Upload the scheduling tracker</h3><p className="empty-note">Add the concierge scheduling tracker (the Excel staff fill in for every inquiry) with <strong>Add files</strong>. The CRM shows inquiries, bookings, no-shows, follow-ups, reminders, referrals and channel performance.</p></div>)}

        {!hasData && (
          <div className="welcome">
            <div className="panel"><h3><FileSpreadsheet size={16} />Sales report columns</h3><p>Needs <code>Date</code>, <code>Patient Name</code> and <code>Total Payment</code>. Also uses <code>Transaction No.</code>, <code>Patient Type</code>, <code>Status</code>, <code>Source</code>, <code>Referring Physician</code>, <code>Department</code>, <code>Test Examination</code>, <code>Patient Category</code>, <code>Gross Amount</code> and <code>Discount</code> when present.</p></div>
            <div className="panel"><h3><ClipboardList size={16} />Scheduling tracker (CRM)</h3><p>The concierge sheet staff fill in: <code>New or Returning Patient</code>, <code>Date</code>, <code>Time</code>, <code>Channel / Source</code>, <code>Name</code>, <code>Contact Number</code>, <code>Procedure / Test</code>, <code>Branch</code>, <code>Inquired</code>, follow-up and reminder dates, <code>Booked</code>, <code>No Show</code>, <code>Served</code> and <code>Revenue</code>. It opens the Patient CRM tab.</p></div>
            <div className="panel"><h3><Smartphone size={16} />Use it as an app</h3><p>Tap <strong>Install app</strong> above (Chrome or Edge on PC and Android), or in Safari on iPhone tap <strong>Share → Add to Home Screen</strong>. It opens full screen and works offline.</p></div>
          </div>
        )}

        {tab === "summary" && sales.length > 0 && (
          <>
            <header className="top">
              <div>
                <h1>CEO Summary Dashboard</h1>
                <p className="sub">The Heart Specialists Clinic &amp; Diagnostic: revenue, patients and where they come from</p>
              </div>
              <div className="period">
                Reporting period<br /><strong>{period}</strong>
                <div className="filters-note">{hasTypes ? `Patient type: ${typeInfo.short}` : "All patient types"}{hasPaid ? ` · Status: ${filters.status === "paid" ? "PAID" : "All"}` : ""}</div>
              </div>
            </header>

            <div className="filterbar no-print">
              {hasTypes && (
                <label>Patient type
                  <select value={filters.patientType} onChange={(e) => setFilter("patientType", e.target.value as PatientTypeFilter)}>
                    {PATIENT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label} · {count(typeCounts[t.key])}</option>)}
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
            <p className="click-hint no-print"><MousePointerClick size={15} aria-hidden />Click any card, bar, segment or row to see the records behind it.</p>

            {summary ? (
              <>
                <Kpis s={summary} typeKey={hasTypes ? filters.patientType : "all"} />
                {hasTypes && filters.patientType === "all" && <PatientTypes s={summary} />}
                <section><Briefing s={summary} findings={findings} decisions={decisions} period={period} /></section>
                {funnel && <Funnel q={funnel} onOpenCrm={() => { setTab("crm"); window.scrollTo({ top: 0 }); }} />}
                <DailyVolume s={summary} />
                <Sources s={summary} />
                <RevenueMix s={summary} />
                <Physicians s={summary} />
                <StillOpen gaps={gaps} />
                <footer className="source">
                  Source: {salesSheets.map((sheet) => sheet.file).filter((f, i, all) => all.indexOf(f) === i).join(", ")}{hasTypes ? `, Patient Type = ${typeInfo.short}` : ""}{hasPaid && filters.status === "paid" ? ", Status = PAID" : ""}, {period} ({count(summary.lineItems)} billed line items across {count(summary.visits)} visits). Patient names are used only to count unique patients and are never shown from the sales report.
                </footer>
              </>
            ) : (
              <div className="alert"><AlertCircle size={18} /><div>No rows match these filters. Widen the date range or choose another patient type.</div></div>
            )}
          </>
        )}

        {tab === "summary" && sales.length === 0 && funnel && (
          <div className="panel empty-tab"><h3><FileSpreadsheet size={16} />Upload the Detailed Sales Report</h3><p className="empty-note">Only the scheduling tracker is loaded. Add the sales report with <strong>Add files</strong> to see revenue, patient types, sources and physicians here, or open the <button type="button" className="link-btn" onClick={() => setTab("crm")}>Patient CRM</button>.</p></div>
        )}
      </div>
      <DrillPanel drill={drill} onClose={closeDrill} context={tab === "crm" ? "Scheduling tracker" : [period, hasTypes ? (filters.patientType === "all" ? "All patient types" : typeInfo.short) : "", hasPaid && filters.status === "paid" ? "PAID" : ""].filter(Boolean).join(" · ")} />
    </main>
    </DrillProvider>
  );
}
