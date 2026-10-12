"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, BarChart3, CheckCircle2, ClipboardList, Cloud, Download, FileSpreadsheet, HardDrive, LogOut, MousePointerClick, Plus, Printer, RefreshCw, ShieldCheck, Smartphone, Upload, UserCog, Users } from "lucide-react";
import { InstallAppButton } from "@/components/pwa";
import { EditorProvider, InquiryEditor } from "@/components/inquiry-editor";
import type { Workspace } from "@/lib/store";
import { clearWorkspace, getRemember, loadWorkspace, saveWorkspace, setRemember } from "@/lib/store";
import type { Session } from "@supabase/supabase-js";
import type { Role } from "@/lib/cloud";
import { cloudConfigured, deleteInquiry as removeInquiry, getCloud, loadCloud, loadProfile, saveInquiries, saveSales, saveSheets } from "@/lib/cloud";
import { LoadingScreen, LoginScreen, NoAccessScreen, SetPasswordScreen, TeamPanel } from "@/components/auth";
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
type AuthState =
  | { status: "local" } // no Supabase configured: data stays on this device
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "setPassword"; email: string }
  | { status: "noAccess"; email: string; error?: string }
  | { status: "signedIn"; userId: string; email: string; role: Role };
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
  // Data saved on this device survives a refresh or closing the app (see lib/store.ts).
  const [remember, setRememberState] = useState(true);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [restoring, setRestoring] = useState(true);

  // With Supabase configured, everyone signs in and shares one set of data (see lib/cloud.ts).
  const [auth, setAuth] = useState<AuthState>(cloudConfigured ? { status: "loading" } : { status: "local" });
  const role: Role = auth.status === "signedIn" ? auth.role : "admin";
  const cloud = auth.status === "signedIn";
  const [team, setTeam] = useState(false);
  const [notice, setNotice] = useState("");
  const [deviceData, setDeviceData] = useState<Workspace | null>(null);
  const linkType = useRef<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!cloudConfigured) return;
    const sb = getCloud()!;
    // Invite and password-reset emails land here with the link type in the URL.
    linkType.current = /type=(invite|recovery)/.exec(window.location.hash)?.[1] || null;
    let live = true;
    const handle = async (session: Session | null, recovery: boolean) => {
      if (!live) return;
      if (!session) { setAuth({ status: "signedOut" }); return; }
      const email = session.user.email || "";
      if (recovery || linkType.current) { setAuth({ status: "setPassword", email }); return; }
      try {
        const profile = await loadProfile(sb, session.user.id);
        if (!live) return;
        setAuth(profile?.role ? { status: "signedIn", userId: session.user.id, email, role: profile.role } : { status: "noAccess", email });
      } catch (e) {
        if (live) setAuth({ status: "noAccess", email, error: (e as Error).message });
      }
    };
    const { data } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED") return;
      // Supabase advises not to await its own calls inside this callback.
      setTimeout(() => void handle(session, event === "PASSWORD_RECOVERY"), 0);
    });
    return () => { live = false; data.subscription.unsubscribe(); };
  }, []);

  const cloudKey = auth.status === "signedIn" ? `${auth.userId}|${auth.role}` : "";
  const refreshCloud = useCallback(async () => {
    const sb = getCloud();
    if (!sb || !cloudKey) return;
    const myRole = cloudKey.split("|")[1] as Role;
    setBusy(true);
    try {
      const data = await loadCloud(sb, myRole);
      setSales(data.sales); setInquiries(data.inquiries); setSheets(data.sheets); setSyncedAt(new Date()); setError("");
      setFilters((f) => ({ ...f, status: data.sales.some((row) => isPaid(row.status)) ? "paid" : "all" }));
      if (myRole === "staff" || (!data.sales.length && data.inquiries.length)) setTab("crm");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false); setRestoring(false);
    }
  }, [cloudKey]);

  useEffect(() => {
    if (!cloudKey) return;
    let live = true;
    const first = setTimeout(() => void refreshCloud(), 0);
    // Data saved on this device before sign-in can be moved to the shared cloud once.
    void loadWorkspace().then((saved) => { if (live && saved && (saved.sales.length || saved.inquiries.length)) setDeviceData(saved); });
    // Pick up colleagues' changes when coming back to the app.
    let last = Date.now();
    const onVisible = () => { if (document.visibilityState === "visible" && Date.now() - last > 60_000) { last = Date.now(); void refreshCloud(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { live = false; clearTimeout(first); document.removeEventListener("visibilitychange", onVisible); };
  }, [cloudKey, refreshCloud]);

  const signOut = async () => {
    await getCloud()?.auth.signOut();
    // Shared data lives in the cloud and is not kept on the device; any older device-only data stays until an admin moves or discards it.
    setSales([]); setInquiries([]); setSheets([]); setDeviceData(null); setTeam(false); setTab("summary");
  };

  const uploadDeviceData = async () => {
    const sb = getCloud();
    if (!sb || !deviceData) return;
    setBusy(true);
    try {
      const known = new Map(inquiries.map((r) => [r.rowKey, r]));
      await saveInquiries(sb, deviceData.inquiries.filter((r) => !known.has(r.rowKey) || r.editedAt));
      if (role === "admin") await saveSales(sb, deviceData.sales);
      await saveSheets(sb, deviceData.sheets.filter((s) => role === "admin" || s.kind === "concierge"));
      await clearWorkspace(); setDeviceData(null);
      await refreshCloud();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  useEffect(() => {
    if (cloudConfigured) return;
    let cancelled = false;
    const keep = getRemember();
    (keep ? loadWorkspace() : clearWorkspace().then(() => null)).then((saved) => {
      if (cancelled) return;
      setRememberState(keep);
      if (saved) {
        setSales(saved.sales); setInquiries(saved.inquiries); setSheets(saved.sheets); setSavedAt(saved.savedAt);
        setFilters((f) => ({ ...f, status: saved.sales.some((row) => isPaid(row.status)) ? "paid" : "all" }));
        if (!saved.sales.length && saved.inquiries.length) setTab("crm");
      }
      setRestoring(false);
    });
    return () => { cancelled = true; };
  }, []);

  const persist = useCallback(async (data: { sales: SalesRow[]; inquiries: InquiryRow[]; sheets: SheetSummary[] }, keep = remember) => {
    if (cloudConfigured) return; // signed-in data is saved to the cloud instead
    if (!keep) { await clearWorkspace(); setSavedAt(null); return; }
    setSavedAt(await saveWorkspace(data));
  }, [remember]);

  // Logging and updating inquiries in the app (the CRM's working side).
  const [editor, setEditor] = useState<{ row: InquiryRow | null } | null>(null);
  const openEditor = useCallback((row?: InquiryRow) => { setDrill(null); setEditor({ row: row ?? null }); }, []);
  const closeEditor = useCallback(() => setEditor(null), []);
  const closeTeam = useCallback(() => setTeam(false), []);
  const saveInquiry = async (row: InquiryRow, base?: InquiryRow) => {
    if (cloud) await saveInquiries(getCloud()!, [row]); // throws → the form shows the error and stays open
    const next = base ? inquiries.map((r) => (r.rowKey === base.rowKey ? row : r)) : [row, ...inquiries];
    setInquiries(next); setEditor(null); setTab("crm");
    void persist({ sales, inquiries: next, sheets });
  };
  const deleteInquiry = async (row: InquiryRow) => {
    if (cloud) await removeInquiry(getCloud()!, row.rowKey);
    const next = inquiries.filter((r) => r.rowKey !== row.rowKey);
    setInquiries(next); setEditor(null);
    void persist({ sales, inquiries: next, sheets });
  };

  const toggleRemember = (keep: boolean) => {
    setRemember(keep); setRememberState(keep);
    void persist({ sales, inquiries, sheets }, keep);
  };

  const processFiles = useCallback(async (incoming: File[]) => {
    const excelFiles = incoming.filter((file) => EXCEL.test(file.name));
    if (!excelFiles.length) { setError("Please upload an Excel file in .xlsx or .xls format."); return; }
    setBusy(true);
    try {
      const parsed = await parseWorkbooks(excelFiles);
      if (!parsed.sales.length && !parsed.inquiries.length) throw new Error(parsed.problems.join(" ") || "No usable rows were found in the workbook.");
      // Only admins may add sales reports once accounts are on; staff uploads keep the tracker only.
      const newSales = role === "admin" ? parsed.sales : [];
      const newSheets = parsed.sheets.filter((s) => role === "admin" || s.kind === "concierge");
      if (!newSales.length && !parsed.inquiries.length) throw new Error("Sales reports can only be added by an admin. Your account can add the scheduling tracker.");
      // Adding files merges them with what is already loaded; identical rows are counted once.
      const salesMap = new Map(sales.map((row) => [row.rowKey, row]));
      newSales.forEach((row) => salesMap.set(row.rowKey, row));
      const inquiryMap = new Map(inquiries.map((row) => [row.rowKey, row]));
      // An inquiry updated in the app wins over an older copy of the same row in a re-uploaded sheet.
      const changedInquiries = parsed.inquiries.filter((row) => !inquiryMap.get(row.rowKey)?.editedAt);
      changedInquiries.forEach((row) => inquiryMap.set(row.rowKey, row));
      if (cloud) {
        const sb = getCloud()!;
        await saveInquiries(sb, changedInquiries);
        await saveSales(sb, newSales);
        await saveSheets(sb, newSheets);
        setSyncedAt(new Date());
      }
      setNotice(parsed.sales.length && !newSales.length ? "The sales report was skipped: only admins can add sales data." : "");
      const nextSales = Array.from(salesMap.values());
      const nextInquiries = Array.from(inquiryMap.values());
      const mergedSheets = new Map(sheets.map((item) => [`${item.file}|${item.sheet}`, item]));
      newSheets.forEach((item) => mergedSheets.set(`${item.file}|${item.sheet}`, item));
      const nextSheets = Array.from(mergedSheets.values());
      setSales(nextSales);
      setInquiries(nextInquiries);
      setSheets(nextSheets);
      void persist({ sales: nextSales, inquiries: nextInquiries, sheets: nextSheets });
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
  }, [sales, inquiries, sheets, persist, role, cloud]);

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

  const reset = () => { void clearWorkspace(); setSavedAt(null); setSales([]); setInquiries([]); setSheets([]); setError(""); setFilters({ patientType: "all", status: "paid", from: "", to: "" }); setTab("summary"); };

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

  // Sign-in gates when accounts are on.
  if (auth.status === "loading") return <LoadingScreen />;
  if (auth.status === "signedOut") return <LoginScreen />;
  if (auth.status === "setPassword") return <SetPasswordScreen email={auth.email} onDone={() => { linkType.current = null; window.location.replace(window.location.pathname); }} />;
  if (auth.status === "noAccess") return <NoAccessScreen email={auth.email} error={auth.error} onSignOut={() => void signOut()} />;
  const syncTime = (d: Date | null) => (d ? d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

  return (
    <DrillProvider value={setDrill}>
    <EditorProvider value={openEditor}>
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
            {cloud && <button type="button" className="btn btn-ghost" onClick={() => void refreshCloud()} disabled={busy} aria-label="Refresh shared data"><RefreshCw size={16} /><span className="hide-sm">Refresh</span></button>}
            {cloud && role === "admin" && <button type="button" className="btn btn-ghost" onClick={() => setTeam(true)} aria-label="Team access"><UserCog size={16} /><span className="hide-sm">Team</span></button>}
            {cloud && <button type="button" className="btn btn-ghost" onClick={() => void signOut()} aria-label="Sign out"><LogOut size={16} /><span className="hide-sm">Sign out</span></button>}
            {!cloud && hasData && <button type="button" className="btn btn-ghost" onClick={reset} aria-label="Start over"><RefreshCw size={16} /><span className="hide-sm">Start over</span></button>}
          </div>
        </div>
      </div>
      <input ref={inputRef} type="file" multiple accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="sr-only" onChange={(e) => void processFiles(Array.from(e.target.files || []))} />

      <div className="wrap">
        {!hasData && !restoring && (
          <>
            <div className={`dropzone${dragging ? " dragging" : ""}`} onDragLeave={() => setDragging(false)}>
              <div className="drop-icon"><Upload size={26} /></div>
              <div>
                <h2>Upload the Excel report</h2>
                <p>Use the Detailed Sales Report export. Add the Central Concierge log too (as another file or another sheet) to see the inquiry funnel. The summary dashboard is generated instantly.</p>
                <div className="actions">
                  <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={busy}><FileSpreadsheet size={17} />{busy ? "Reading…" : "Choose Excel files"}</button>
                  <button type="button" className="btn btn-outline" onClick={() => openEditor()}><Plus size={16} />Log an inquiry</button>
                  <button type="button" className="btn btn-outline" onClick={downloadTemplate}><Download size={16} />Download template</button>
                  <span className="hint">.xlsx or .xls · or drag files here</span>
                </div>
              </div>
            </div>
            {cloud
              ? <div className="privacy"><ShieldCheck size={17} /><span>Uploads and inquiries are saved to THSC&apos;s shared database, so everyone signed in sees the same data on any computer or phone. {role === "staff" ? "Your account can add the scheduling tracker and inquiries; sales reports are added by an admin." : ""}</span></div>
              : <>
                <div className="privacy"><ShieldCheck size={17} /><span>Workbooks are read on this device and never uploaded to a server. {remember ? "The latest data stays saved on this device, so it is still here after you refresh or close the app." : "Nothing is kept: data is cleared when you close the app."}</span></div>
                <label className="remember"><input type="checkbox" checked={remember} onChange={(e) => toggleRemember(e.target.checked)} /> Keep data on this device <small>(turn off on shared computers)</small></label>
              </>}
          </>
        )}

        {cloud && restoring && <p className="empty-note" role="status" style={{ marginTop: 20 }}>Loading shared data…</p>}
        {error && <div className="alert" role="alert"><AlertCircle size={18} /><div><strong>Something needs attention.</strong> {error}</div></div>}
        {notice && <div className="notice" role="status"><div>{notice}</div></div>}
        {cloud && deviceData && (
          <div className="notice device-move" role="status">
            <div><strong>This device still has data saved before sign-in</strong> ({count(deviceData.inquiries.length)} inquiries{role === "admin" ? `, ${count(deviceData.sales.length)} sales rows` : ""}). Move it to the shared database so the whole team sees it?</div>
            <div className="device-move-actions">
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void uploadDeviceData()}><Upload size={14} />Move to shared</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => { void clearWorkspace(); setDeviceData(null); }}>Discard</button>
            </div>
          </div>
        )}
        {cloud && (
          <div className="storage-bar no-print">
            <span><Cloud size={15} aria-hidden />{syncedAt ? <>Shared database · synced {syncTime(syncedAt)}</> : "Shared database"}</span>
            <span>Signed in as <strong>{auth.status === "signedIn" ? auth.email : ""}</strong> · {role === "admin" ? "Admin" : "Staff"}</span>
          </div>
        )}
        {!cloud && hasData && (
          <div className="storage-bar no-print">
            <span><HardDrive size={15} aria-hidden />{remember ? (savedAt ? <>Saved on this device · {savedAt.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</> : "Saving on this device…") : "Not saved: data is cleared when you close the app"}</span>
            <label className="remember"><input type="checkbox" checked={remember} onChange={(e) => toggleRemember(e.target.checked)} /> Keep on this device</label>
            {remember && <span className="storage-hint">Only this device keeps it. Seeing the same data on every phone and computer needs accounts.</span>}
          </div>
        )}
        {sheets.length > 0 && (
          <div className="loaded no-print" aria-label="Loaded sheets">
            {sheets.map((sheet) => <span key={`${sheet.file}|${sheet.sheet}`} className="chip"><CheckCircle2 size={14} /><span>{sheet.file} › {sheet.sheet}</span><small>{sheet.kind === "sales" ? "sales report" : "scheduling tracker"} · {count(sheet.rows)} rows</small></span>)}
          </div>
        )}

        {hasData && (
          <nav className="tabs no-print" aria-label="Dashboard sections">
            {role === "admin" && <button type="button" className={tab === "summary" ? "on" : ""} aria-current={tab === "summary" ? "page" : undefined} onClick={() => setTab("summary")}><BarChart3 size={16} />CEO summary{!sales.length && <span className="hide-sm"> (no sales report)</span>}</button>}
            <button type="button" className={tab === "crm" ? "on" : ""} aria-current={tab === "crm" ? "page" : undefined} onClick={() => setTab("crm")}><Users size={16} />Patient CRM{inquiries.length ? <small>{count(inquiries.length)}</small> : <span className="hide-sm"> (no tracker)</span>}</button>
          </nav>
        )}

        {hasData && tab === "crm" && (inquiries.length
          ? <CrmDashboard rows={inquiries} />
          : <div className="panel empty-tab"><h3><ClipboardList size={16} />Upload the scheduling tracker, or start logging here</h3><p className="empty-note">Add the concierge scheduling tracker (the Excel staff fill in for every inquiry) with <strong>Add files</strong>, or log inquiries directly in the app. The CRM shows inquiries, bookings, no-shows, follow-ups, reminders, referrals and channel performance.</p><button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => openEditor()}><Plus size={16} />Log first inquiry</button></div>)}

        {!hasData && !restoring && (
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
      {team && auth.status === "signedIn" && <TeamPanel me={auth.userId} onClose={closeTeam} />}
      {editor && <InquiryEditor key={editor.row?.rowKey || "new"} row={editor.row} isNew={!editor.row} rows={inquiries} onSave={saveInquiry} onDelete={deleteInquiry} onClose={closeEditor} />}
    </main>
    </EditorProvider>
    </DrillProvider>
  );
}
