"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, BarChart3, PhilippinePeso, ClipboardList, ListChecks, Cloud, HardDrive, LogOut, MousePointerClick, Printer, RefreshCw, Upload, UserCog, Users } from "lucide-react";
import { InstallAppButton } from "@/components/pwa";
import { EditorProvider, InquiryEditor } from "@/components/inquiry-editor";
import type { Workspace } from "@/lib/store";
import { clearWorkspace, getRemember, loadWorkspace, saveWorkspace, setRemember, splitWorkspace } from "@/lib/store";
import type { Session } from "@supabase/supabase-js";
import type { Role } from "@/lib/cloud";
import { isFullAccess, ROLE_LABEL } from "@/lib/cloud";
import { cloudConfigured, configProblem, deleteInquiry as removeInquiry, deletePersonal, deleteSales, deleteSheets, getCloud, loadCloud, loadInquiries, loadProfile, revive, saveInquiries, savePersonal, saveSales, saveSheets, saveSpend } from "@/lib/cloud";
import { AcquisitionDashboard } from "@/components/acquisition";
import type { AcquisitionSpend } from "@/lib/acquisition";
import { spendKey } from "@/lib/acquisition";
import { linkErrorText, LoadingScreen, LoginScreen, NoAccessScreen, SetPasswordScreen, TeamPanel, VerifyLinkScreen } from "@/components/auth";
import { CrmDashboard } from "@/components/crm";
import { InquiryTracker } from "@/components/tracker";
import { SalesFiles } from "@/components/sales-files";
import { PdfButton } from "@/components/pdf-button";
import { salesReport } from "@/lib/reports";
import { DrillPanel, DrillProvider } from "@/components/drill";
import { Briefing, DailyVolume, Funnel, Kpis, PatientTypes, Physicians, RevenueMix, Sources, StillOpen } from "@/components/dashboard";
import type { Drill, Filters, PatientTypeFilter, StatusFilter } from "@/lib/analyze";
import { analyzeInquiries, analyzeSales, applyFilters, buildDecisions, buildFindings, count, isPaid, longDate, matchesType, PATIENT_TYPES, patientTypeInfo } from "@/lib/analyze";
import type { InquiryRow, SalesRow, SheetSummary } from "@/lib/parse";
import { inquiryKey, LEGACY_UPLOAD, parseWorkbooks, sheetKey } from "@/lib/parse";

type LaunchParams = { files: { getFile: () => Promise<File> }[] };
declare global {
  interface Window { launchQueue?: { setConsumer: (consumer: (params: LaunchParams) => void) => void } }
}

const EXCEL = /\.(xlsx|xlsm|xls)$/i;
type AuthState =
  | { status: "local" } // no Supabase configured: data stays on this device
  | { status: "loading" }
  | { status: "signedOut"; linkError?: string }
  | { status: "verifyLink"; tokenHash: string; type: "invite" | "recovery" }
  | { status: "setPassword"; email: string }
  | { status: "noAccess"; email: string; error?: string }
  | { status: "signedIn"; userId: string; email: string; role: Role };
const toInputDate = (date: Date | null) => (date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : "");

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  // The Sales Dashboard's files: with accounts, each person's own (nobody else sees them).
  const [sales, setSales] = useState<SalesRow[]>([]);
  const [mySheets, setMySheets] = useState<SheetSummary[]>([]);
  // The team's shared sales reports behind Patient Acquisition Cost (same for everyone).
  const [teamSales, setTeamSales] = useState<SalesRow[]>([]);
  const [personalMissing, setPersonalMissing] = useState(false);
  const [inquiries, setInquiries] = useState<InquiryRow[]>([]);
  // Shared file lists: tracker files and the team's sales reports.
  const [sheets, setSheets] = useState<SheetSummary[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [drill, setDrill] = useState<Drill | null>(null);
  const closeDrill = useCallback(() => setDrill(null), []);
  const [filters, setFilters] = useState<Filters>({ patientType: "all", status: "paid", from: "", to: "" });
  const [tab, setTab] = useState<"summary" | "acquisition" | "crm" | "tracker">("summary");
  // Marketing spend for the Patient Acquisition Cost tab: shared in the cloud, or kept in this browser without accounts.
  const [spends, setSpends] = useState<AcquisitionSpend[]>([]);
  // Opening the tracker from the CRM's follow-up queue searches for that patient.
  const [trackerFocus, setTrackerFocus] = useState({ search: "", n: 0 });
  const openTracker = useCallback((search = "") => { setTrackerFocus((f) => ({ search, n: f.n + 1 })); setTab("tracker"); window.scrollTo({ top: 0 }); }, []);
  // Data saved on this device survives a refresh or closing the app (see lib/store.ts).
  const [remember, setRememberState] = useState(true);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [restoring, setRestoring] = useState(true);

  // With Supabase configured, everyone signs in and shares one set of data (see lib/cloud.ts).
  const [auth, setAuth] = useState<AuthState>(cloudConfigured ? (configProblem ? { status: "signedOut" } : { status: "loading" }) : { status: "local" });
  const role: Role = auth.status === "signedIn" ? auth.role : "admin";
  const cloud = auth.status === "signedIn";
  const canEdit = role !== "marketing"; // Marketing accounts are read-only
  const full = isFullAccess(role); // Admin, ManCom and Doctors: sales reports and Team
  const [team, setTeam] = useState(false);
  const [notice, setNotice] = useState("");
  const [deviceData, setDeviceData] = useState<Workspace | null>(null);
  const linkType = useRef<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!cloudConfigured || configProblem) return; // a setup problem is shown on the sign-in screen
    const sb = getCloud()!;
    // Invite and password-reset emails land here. Older email templates put the type in the URL hash;
    // the recommended templates send ?token_hash=…&type=…, which is only used when the person clicks
    // Continue, so email scanners that pre-open links can't use it up.
    linkType.current = /type=(invite|recovery)/.exec(window.location.hash)?.[1] || null;
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const tokenHash = query.get("token_hash"), tokenType = query.get("type");
    const pending = tokenHash && (tokenType === "invite" || tokenType === "recovery") ? { tokenHash, type: tokenType as "invite" | "recovery" } : null;
    const errorCode = hash.get("error_code") || query.get("error_code");
    const linkError = errorCode ? linkErrorText(errorCode, hash.get("error_description") || query.get("error_description") || "") : "";
    if (pending || errorCode) window.history.replaceState(null, "", window.location.pathname);
    let live = true;
    const handle = async (session: Session | null, recovery: boolean) => {
      if (!live) return;
      if (pending && !linkType.current) { setAuth({ status: "verifyLink", ...pending }); return; }
      if (!session) { setAuth({ status: "signedOut", linkError }); return; }
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
    const [myId, myRole] = cloudKey.split("|") as [string, Role];
    setBusy(true);
    try {
      const data = await loadCloud(sb, myRole, myId);
      setSales(data.mySales); setMySheets(data.mySheets); setTeamSales(data.teamSales); setPersonalMissing(data.personalMissing);
      setInquiries(data.inquiries); setSheets(data.sheets); setSpends(data.spends); setSyncedAt(new Date()); setError("");
      setFilters((f) => ({ ...f, status: data.mySales.some((row) => isPaid(row.status)) ? "paid" : "all" }));
      // Concierge work in the Inquiry Tracker; without any sales report the CRM is the first thing to show.
      if (myRole === "concierge") setTab((t) => (t === "summary" ? "tracker" : t));
      else if (!data.mySales.length && !data.teamSales.length && data.inquiries.length) setTab((t) => (t === "summary" ? "crm" : t));
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

  // The Inquiry Tracker and CRM stay in step for everyone: changes arrive live from the database (Supabase
  // Realtime). Where live updates aren't available (not switched on yet, or Marketing's de-identified view),
  // the inquiries are re-read every 30 seconds while the app is open.
  useEffect(() => {
    const sb = getCloud();
    if (!sb || !cloudKey) return;
    const myRole = cloudKey.split("|")[1] as Role;
    const pending = new Map<string, InquiryRow | null>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let live = true;
    const flush = () => {
      const changes = new Map(pending); pending.clear();
      setInquiries((list) => {
        const map = new Map(list.map((r) => [r.rowKey, r]));
        changes.forEach((row, key) => (row ? map.set(key, row) : map.delete(key)));
        return Array.from(map.values());
      });
      setSyncedAt(new Date());
    };
    const startPolling = () => {
      if (poll || !live) return;
      poll = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        void loadInquiries(sb, myRole).then((rows) => { setInquiries(rows); setSyncedAt(new Date()); }).catch(() => undefined);
      }, 30_000);
    };
    if (myRole === "marketing") { startPolling(); return () => { live = false; clearInterval(poll); }; }
    const channel = sb.channel("inquiries-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "inquiries" }, (payload) => {
        const row = payload.new as { key?: string; data?: unknown } | null;
        if (payload.eventType === "DELETE") { const key = (payload.old as { key?: string })?.key; if (key) pending.set(key, null); }
        else if (row?.key && row.data) pending.set(row.key, revive<InquiryRow>(row.data));
        // A big upload arrives as many events; apply them together.
        clearTimeout(flushTimer); flushTimer = setTimeout(flush, 400);
      })
      .subscribe((status) => { if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") startPolling(); });
    return () => { live = false; clearTimeout(flushTimer); clearInterval(poll); void sb.removeChannel(channel); };
  }, [cloudKey]);

  const signOut = async () => {
    await getCloud()?.auth.signOut();
    // Shared data lives in the cloud and is not kept on the device; any older device-only data stays until an admin moves or discards it.
    setSales([]); setMySheets([]); setTeamSales([]); setInquiries([]); setSheets([]); setSpends([]); setDeviceData(null); setTeam(false); setTab("summary");
  };

  const uploadDeviceData = async () => {
    const sb = getCloud();
    if (!sb || !deviceData) return;
    setBusy(true);
    try {
      const known = new Map(inquiries.map((r) => [r.rowKey, r]));
      const device = splitWorkspace(deviceData);
      if (canEdit) await saveInquiries(sb, device.inquiries.filter((r) => !known.has(r.rowKey) || r.editedAt));
      // The device's Sales Dashboard files become this account's own; its team files become the team's.
      if (role !== "concierge" && auth.status === "signedIn") await savePersonal(sb, auth.userId, { rows: device.sales, sheets: device.mySheets });
      if (full) await saveSales(sb, device.teamSales);
      await saveSheets(sb, device.sheets.filter((s) => (full ? true : canEdit && s.kind === "concierge")));
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
        const w = splitWorkspace(saved);
        setSales(w.sales); setMySheets(w.mySheets); setTeamSales(w.teamSales); setInquiries(w.inquiries); setSheets(w.sheets); setSavedAt(saved.savedAt);
        setFilters((f) => ({ ...f, status: w.sales.some((row) => isPaid(row.status)) ? "paid" : "all" }));
        if (!w.sales.length && !w.teamSales.length && w.inquiries.length) setTab("crm");
      }
      setRestoring(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Without accounts, everything is saved on this device shortly after it changes (signed-in data is saved to the cloud instead).
  useEffect(() => {
    if (cloudConfigured || restoring) return;
    const timer = setTimeout(async () => {
      if (!remember || (!sales.length && !inquiries.length && !teamSales.length)) { await clearWorkspace(); setSavedAt(null); return; }
      setSavedAt(await saveWorkspace({ sales, inquiries, sheets, mySheets, teamSales }));
    }, 300);
    return () => clearTimeout(timer);
  }, [sales, inquiries, sheets, mySheets, teamSales, remember, restoring]);

  // Logging and updating inquiries in the app (the CRM's working side).
  const [editor, setEditor] = useState<{ row: InquiryRow | null } | null>(null);
  const openEditor = useCallback((row?: InquiryRow) => { setDrill(null); setEditor({ row: row ?? null }); }, []);
  const closeEditor = useCallback(() => setEditor(null), []);
  const closeTeam = useCallback(() => setTeam(false), []);
  // Tracker cells save one after another, faster than React re-renders, so edits build on the latest list.
  const latestInquiries = useRef(inquiries);
  useEffect(() => { latestInquiries.current = inquiries; }, [inquiries]);
  const saveInquiry = async (row: InquiryRow, base?: InquiryRow) => {
    if (cloud) await saveInquiries(getCloud()!, [row]); // throws → the form or cell shows the error
    const list = latestInquiries.current;
    const next = base ? list.map((r) => (r.rowKey === base.rowKey ? row : r)) : [row, ...list];
    latestInquiries.current = next;
    setInquiries(next); setEditor(null);
    if (!base) setTab("tracker");
  };
  const deleteInquiry = async (row: InquiryRow) => {
    if (cloud) await removeInquiry(getCloud()!, row.rowKey);
    const next = latestInquiries.current.filter((r) => r.rowKey !== row.rowKey);
    latestInquiries.current = next;
    setInquiries(next); setEditor(null);
  };

  const toggleRemember = (keep: boolean) => {
    setRemember(keep); setRememberState(keep);
  };

  /**
   * Reads Excel files. Sales reports go to the Sales Dashboard (this account's own files) or, from the
   * Patient Acquisition Cost tab, to the team's shared reports. `only` comes from the Add sales report /
   * Add team sales report / Upload tracker file buttons: other kinds of sheets in the file are ignored.
   */
  const processFiles = useCallback(async (incoming: File[], only?: "sales" | "team" | "concierge") => {
    const target: "mine" | "team" = only === "team" || (!only && tab === "acquisition") ? "team" : "mine";
    const canAddSales = target === "team" ? full : role !== "concierge";
    if (!canEdit && only === "concierge") { setError("Marketing accounts can view the CRM but not add tracker files."); return; }
    if (!canAddSales && only && only !== "concierge") { setError("The team's sales reports are added by an Admin, ManCom or Doctors account."); return; }
    const excelFiles = incoming.filter((file) => EXCEL.test(file.name));
    if (!excelFiles.length) { setError("Please upload an Excel file in .xlsx or .xls format."); return; }
    setBusy(true);
    try {
      const parsed = await parseWorkbooks(excelFiles);
      const names = excelFiles.map((f) => f.name).join(", ");
      if (only === "concierge") {
        if (!parsed.inquiries.length) throw new Error(`No concierge inquiry tracker was found in ${names}. The tracker needs columns such as Channel / Source, Name and Inquired. To add a sales report, use Add sales report on the Sales Dashboard.`);
        parsed.sales = []; parsed.sheets = parsed.sheets.filter((s) => s.kind === "concierge");
      }
      if (only === "sales" || only === "team") {
        if (!parsed.sales.length) throw new Error(`No sales report was found in ${names}. It needs the columns Date, Patient Name and Total Payment. To add the concierge inquiry tracker, use Upload tracker file in the Inquiry Tracker.`);
        parsed.inquiries = []; parsed.sheets = parsed.sheets.filter((s) => s.kind === "sales");
      }
      if (!parsed.sales.length && !parsed.inquiries.length) throw new Error(parsed.problems.join(" ") || "No usable rows were found in the workbook.");
      const newSales = canAddSales ? parsed.sales : [];
      const newSalesSheets = canAddSales ? parsed.sheets.filter((s) => s.kind === "sales") : [];
      const newInquiries = canEdit ? parsed.inquiries : [];
      const newTrackerSheets = canEdit ? parsed.sheets.filter((s) => s.kind === "concierge") : [];
      if (!newSales.length && !newInquiries.length) throw new Error(target === "team" ? "The team's sales reports are added by an Admin, ManCom or Doctors account." : "Your account can add the concierge inquiry tracker, not sales reports.");

      // Adding files merges them with what is already loaded; identical rows are counted once.
      const current = target === "team" ? teamSales : sales;
      const salesMap = new Map(current.map((row) => [row.rowKey, row]));
      // A row already loaded from another file keeps that file as an owner too, so removing either file leaves it in place.
      const touchedSales = new Map<string, SalesRow>();
      newSales.forEach((row) => {
        const old = salesMap.get(row.rowKey);
        const next = old ? { ...row, uploads: Array.from(new Set([...(old.uploads ?? [LEGACY_UPLOAD]), ...(row.uploads ?? [])])) } : row;
        salesMap.set(row.rowKey, next); touchedSales.set(row.rowKey, next);
      });
      const inquiryMap = new Map(inquiries.map((row) => [row.rowKey, row]));
      // Inquiries added in the app come back from an exported tracker under a key made from their
      // columns; match them to the app's row so re-uploading the export doesn't duplicate them.
      const byContent = new Map(inquiries.map((row) => [inquiryKey(row.patient, row.contact, row.channel, row.date, row.procedure), row.rowKey]));
      const incomingRows = newInquiries.map((row) => (inquiryMap.has(row.rowKey) || !byContent.has(row.rowKey) ? row : { ...row, rowKey: byContent.get(row.rowKey)! }));
      // An inquiry updated in the app wins over an older copy of the same row in a re-uploaded sheet.
      const changedInquiries = incomingRows.filter((row) => !inquiryMap.get(row.rowKey)?.editedAt);
      const addedCount = new Set(changedInquiries.filter((row) => !inquiryMap.has(row.rowKey)).map((row) => row.rowKey)).size;
      // Field order differs once rows come back from the database, so compare with sorted keys.
      const same = (a?: InquiryRow, b?: InquiryRow) => {
        if (!a || !b) return false;
        const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
        return JSON.stringify(a, keys) === JSON.stringify(b, keys);
      };
      const updatedCount = new Set(changedInquiries.filter((row) => inquiryMap.has(row.rowKey) && !same(inquiryMap.get(row.rowKey), row)).map((row) => row.rowKey)).size;
      const unchangedCount = new Set(changedInquiries.filter((row) => same(inquiryMap.get(row.rowKey), row)).map((row) => row.rowKey)).size;
      const keptCount = incomingRows.length - changedInquiries.length;
      changedInquiries.forEach((row) => inquiryMap.set(row.rowKey, row));
      if (cloud) {
        const sb = getCloud()!;
        await saveInquiries(sb, changedInquiries);
        if (target === "team") { await saveSales(sb, Array.from(touchedSales.values())); await saveSheets(sb, newSalesSheets); }
        else if (newSales.length && auth.status === "signedIn") await savePersonal(sb, auth.userId, { rows: Array.from(touchedSales.values()), sheets: newSalesSheets });
        await saveSheets(sb, newTrackerSheets);
        setSyncedAt(new Date());
      }
      setNotice([
        newInquiries.length ? `Inquiry tracker: ${count(addedCount)} new ${addedCount === 1 ? "inquiry" : "inquiries"} added, ${count(updatedCount)} updated, ${count(unchangedCount)} already up to date${keptCount ? `, ${count(keptCount)} kept as edited in the app` : ""}.` : "",
        newSales.length ? (target === "team" ? "Sales report added to the team's Patient Acquisition Cost, for everyone." : cloud ? "Sales report added to your own Sales Dashboard; other accounts don't see it." : "") : "",
        parsed.sales.length && !newSales.length ? (target === "team" ? "The sales report was skipped: the team's sales reports are added by an Admin, ManCom or Doctors account." : "The sales report was skipped: this account can't add sales reports.") : "",
        parsed.inquiries.length && !newInquiries.length ? "The inquiry tracker was skipped: Marketing accounts can't change it." : "",
      ].filter(Boolean).join(" "));
      const nextSales = Array.from(salesMap.values());
      const mergeSheets = (list: SheetSummary[], add: SheetSummary[]) => { const m = new Map(list.map((x) => [sheetKey(x), x])); add.forEach((x) => m.set(sheetKey(x), x)); return Array.from(m.values()); };
      if (target === "team") { setTeamSales(nextSales); setSheets((list) => mergeSheets(list, [...newSalesSheets, ...newTrackerSheets])); }
      else {
        setSales(nextSales); setMySheets((list) => mergeSheets(list, newSalesSheets)); setSheets((list) => mergeSheets(list, newTrackerSheets));
        if (newSales.length) setFilters({ patientType: "all", status: nextSales.some((row) => isPaid(row.status)) ? "paid" : "all", from: "", to: "" });
      }
      setInquiries(Array.from(inquiryMap.values()));
      setError(parsed.problems.join(" "));
      // Land on the tab the new file belongs to (a button inside a tab keeps you there).
      if (only) { /* stay */ } else if (newInquiries.length && !newSales.length) setTab((t) => (t === "tracker" ? t : "crm"));
      else if (newSales.length && !newInquiries.length) setTab(target === "team" ? "acquisition" : "summary");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The workbook could not be read.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [sales, teamSales, inquiries, full, cloud, canEdit, role, tab, auth]);

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

  // Removes uploaded sales report files (this account's own, or the team's); rows another file also contains stay.
  const removeSalesFiles = async (targets: SheetSummary[], target: "mine" | "team") => {
    const owners = new Set(targets.map((s) => s.id || LEGACY_UPLOAD));
    const keep: SalesRow[] = [], changed: SalesRow[] = [], dropped: string[] = [];
    for (const row of target === "team" ? teamSales : sales) {
      const mine = row.uploads ?? [LEGACY_UPLOAD];
      const left = mine.filter((owner) => !owners.has(owner));
      if (!left.length) dropped.push(row.rowKey);
      else if (left.length < mine.length) { const next = { ...row, uploads: left }; changed.push(next); keep.push(next); }
      else keep.push(row);
    }
    const removed = new Set(targets.map(sheetKey));
    setBusy(true);
    try {
      if (cloud) {
        const sb = getCloud()!;
        if (target === "team") {
          await saveSales(sb, changed);
          await deleteSales(sb, dropped);
          await deleteSheets(sb, Array.from(removed));
        } else if (auth.status === "signedIn") {
          await savePersonal(sb, auth.userId, { rows: changed });
          await deletePersonal(sb, auth.userId, { rowKeys: dropped, sheets: targets });
        }
        setSyncedAt(new Date());
      }
      if (target === "team") { setTeamSales(keep); setSheets((list) => list.filter((s) => !removed.has(sheetKey(s)))); }
      else { setSales(keep); setMySheets((list) => list.filter((s) => !removed.has(sheetKey(s)))); }
      setError("");
      setNotice(`Removed ${targets.map((s) => s.file).join(", ")}: ${count(dropped.length)} sales rows deleted${changed.length ? `, ${count(changed.length)} kept because another file has them` : ""}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Copies the team's shared sales reports into this account's own Sales Dashboard (a starting point; later changes stay separate).
  const copyTeamSales = async () => {
    setBusy(true);
    try {
      const teamSheets = sheets.filter((s) => s.kind === "sales");
      if (cloud && auth.status === "signedIn") await savePersonal(getCloud()!, auth.userId, { rows: teamSales, sheets: teamSheets });
      setSales(teamSales); setMySheets(teamSheets); setError("");
      setFilters({ patientType: "all", status: teamSales.some((row) => isPaid(row.status)) ? "paid" : "all", from: "", to: "" });
      setNotice("The team's sales reports were copied into your Sales Dashboard. Files you add or remove here now only change your own view.");
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  // The upload buttons share the file picker but accept only their own kind of file.
  const uploadKind = useRef<"sales" | "team" | "concierge" | undefined>(undefined);
  const pickFiles = (only?: "sales" | "team" | "concierge") => { uploadKind.current = only; inputRef.current?.click(); };

  const SPEND_STORE = "thsc-acquisition-spend";
  useEffect(() => {
    if (cloudConfigured) return;
    try { const saved = JSON.parse(localStorage.getItem(SPEND_STORE) || "[]") as AcquisitionSpend[]; if (saved.length) setTimeout(() => setSpends(saved), 0); } catch { /* storage blocked: start empty */ }
  }, []);
  const saveAcquisitionSpend = async (spend: AcquisitionSpend) => {
    if (cloud) await saveSpend(getCloud()!, spend); // throws → the tab shows the error
    const next = [...spends.filter((s) => spendKey(s.from, s.to) !== spendKey(spend.from, spend.to)), spend];
    setSpends(next);
    if (!cloud) { try { localStorage.setItem(SPEND_STORE, JSON.stringify(next)); } catch { /* not kept */ } }
  };

  const reset = () => { try { localStorage.removeItem(SPEND_STORE); } catch { /* ignore */ } setSpends([]); void clearWorkspace(); setSavedAt(null); setSales([]); setMySheets([]); setTeamSales([]); setInquiries([]); setSheets([]); setError(""); setFilters({ patientType: "all", status: "paid", from: "", to: "" }); setTab("summary"); };

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
  const salesSheets = mySheets;
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
  if (auth.status === "signedOut") return <LoginScreen linkError={auth.linkError} />;
  if (auth.status === "verifyLink") {
    return <VerifyLinkScreen tokenHash={auth.tokenHash} type={auth.type}
      onVerified={(email, type) => { linkType.current = type; setAuth({ status: "setPassword", email }); }}
      onFailed={(message) => setAuth({ status: "signedOut", linkError: message })} />;
  }
  if (auth.status === "setPassword") return <SetPasswordScreen email={auth.email} onDone={() => { linkType.current = null; window.location.replace(window.location.pathname); }} />;
  if (auth.status === "noAccess") return <NoAccessScreen email={auth.email} error={auth.error} onSignOut={() => void signOut()} />;
  const syncTime = (d: Date | null) => (d ? d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

  return (
    <DrillProvider value={setDrill}>
    {/* Inquiries are added and updated in the Inquiry Tracker only; the dashboards are read-only views of it. */}
    <EditorProvider value={canEdit && tab === "tracker" ? openEditor : null}>
    <main onDragEnter={(e) => { e.preventDefault(); setDragging(true); }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setDragging(false); if (!canEdit) return; void processFiles(Array.from(e.dataTransfer.files)); }}>
      <div className="appbar">
        <div className="appbar-inner">
          <div className="appbar-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/theheartspecialists.png" alt="" width={36} height={48} />
            <div style={{ minWidth: 0 }}><div className="clinic">THE HEART SPECIALISTS CLINIC</div><div className="app">Summary Dashboard</div></div>
          </div>
          <div className="appbar-actions">
            <InstallAppButton />
            {canEdit && <button type="button" className="btn btn-ghost" onClick={() => pickFiles()} aria-label="Add Excel files"><Upload size={16} /><span className="hide-sm">Add files</span></button>}
            {(summary || inquiries.length > 0) && <button type="button" className="btn btn-ghost" onClick={() => window.print()} aria-label="Print or save as PDF"><Printer size={16} /><span className="hide-sm">Print</span></button>}
            {cloud && <button type="button" className="btn btn-ghost" onClick={() => void refreshCloud()} disabled={busy} aria-label="Refresh shared data"><RefreshCw size={16} /><span className="hide-sm">Refresh</span></button>}
            {cloud && full && <button type="button" className="btn btn-ghost" onClick={() => setTeam(true)} aria-label="Team access"><UserCog size={16} /><span className="hide-sm">Team</span></button>}
            {cloud && <button type="button" className="btn btn-ghost" onClick={() => void signOut()} aria-label="Sign out"><LogOut size={16} /><span className="hide-sm">Sign out</span></button>}
            {!cloud && hasData && <button type="button" className="btn btn-ghost" onClick={reset} aria-label="Start over"><RefreshCw size={16} /><span className="hide-sm">Start over</span></button>}
          </div>
        </div>
      </div>
      <input ref={inputRef} type="file" multiple accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="sr-only" onChange={(e) => void processFiles(Array.from(e.target.files || []), uploadKind.current)} />

      <div className="wrap">
        {cloud && restoring && <p className="empty-note" role="status" style={{ marginTop: 20 }}>Loading shared data…</p>}
        {error && <div className="alert" role="alert"><AlertCircle size={18} /><div><strong>Something needs attention.</strong> {error}</div></div>}
        {notice && <div className="notice" role="status"><div>{notice}</div></div>}
        {cloud && deviceData && (
          <div className="notice device-move" role="status">
            <div><strong>This device still has data saved before sign-in</strong> ({count(deviceData.inquiries.length)} inquiries{full ? `, ${count(deviceData.sales.length)} sales rows` : ""}). Move it to the shared database so the whole team sees it?</div>
            <div className="device-move-actions">
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void uploadDeviceData()}><Upload size={14} />Move to shared</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => { void clearWorkspace(); setDeviceData(null); }}>Discard</button>
            </div>
          </div>
        )}
        {cloud && (
          <div className="storage-bar no-print">
            <span><Cloud size={15} aria-hidden />{syncedAt ? <>Shared database · synced {syncTime(syncedAt)}</> : "Shared database"}</span>
            <span>Signed in as <strong>{auth.status === "signedIn" ? auth.email : ""}</strong> · {ROLE_LABEL[role]}{role === "marketing" ? " (read-only, patient details hidden)" : ""}</span>
          </div>
        )}
        {!cloud && (
          <div className="storage-bar no-print">
            <span><HardDrive size={15} aria-hidden />{!hasData ? "Nothing added yet. Excel files are read on this device and never uploaded to a server." : remember ? (savedAt ? <>Saved on this device · {savedAt.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</> : "Saving on this device…") : "Not saved: data is cleared when you close the app"}</span>
            <label className="remember"><input type="checkbox" checked={remember} onChange={(e) => toggleRemember(e.target.checked)} /> Keep on this device</label>
            {remember && <span className="storage-hint">Only this device keeps it. Seeing the same data on every phone and computer needs accounts.</span>}
          </div>
        )}
        {/* Uploaded files are listed in their own tabs: sales reports on the Sales Dashboard, tracker files in the Inquiry Tracker. */}

        {/* The tabs are always there, with or without files; each tab says what is missing. */}
        {!restoring && (
          <nav className="tabs no-print" aria-label="Dashboard sections">
            {role !== "concierge" && <button type="button" className={tab === "summary" ? "on" : ""} aria-current={tab === "summary" ? "page" : undefined} onClick={() => setTab("summary")}><BarChart3 size={16} /><span>Sales<span className="hide-sm"> Dashboard</span>{!sales.length && <span className="hide-sm"> (no sales report)</span>}</span></button>}
            {role !== "concierge" && <button type="button" className={tab === "acquisition" ? "on" : ""} aria-current={tab === "acquisition" ? "page" : undefined} onClick={() => setTab("acquisition")}><PhilippinePeso size={16} /><span><span className="hide-sm">Patient </span>Acquisition<span className="hide-sm"> Cost</span></span></button>}
            <button type="button" className={tab === "crm" ? "on" : ""} aria-current={tab === "crm" ? "page" : undefined} onClick={() => setTab("crm")}><Users size={16} /><span>CRM<span className="hide-sm"> Dashboard</span>{!inquiries.length && <span className="hide-sm"> (no tracker)</span>}</span></button>
            {canEdit && <button type="button" className={tab === "tracker" ? "on" : ""} aria-current={tab === "tracker" ? "page" : undefined} onClick={() => openTracker()}><ListChecks size={16} />Inquiry Tracker{inquiries.length > 0 && <small className="hide-sm">{count(inquiries.length)}</small>}</button>}
          </nav>
        )}

        {!restoring && tab === "acquisition" && role !== "concierge" && (
          <AcquisitionDashboard key={teamSales.length ? "data" : "empty"} rows={teamSales} spends={spends} canEdit={full}
            onSaveSpend={saveAcquisitionSpend} onAddSales={full ? () => pickFiles("team") : undefined}
            files={<SalesFiles heading="Team sales report files" readOnly={!full}
              scope={cloud ? "Shared: everyone sees the same Patient Acquisition Cost. Admin, ManCom and Doctors add or remove these files; each person's Sales Dashboard has its own files." : undefined}
              sheets={sheets.filter((s) => s.kind === "sales")} rows={teamSales} busy={busy} onAdd={() => pickFiles("team")} onRemove={(targets) => void removeSalesFiles(targets, "team")} />} />
        )}

        {!restoring && tab === "crm" && (inquiries.length
          ? <CrmDashboard rows={inquiries} deidentified={role === "marketing"} onOpenTracker={canEdit ? openTracker : undefined} onUploadTracker={canEdit ? () => pickFiles("concierge") : undefined} />
          : <div className="panel empty-tab"><h3><ClipboardList size={16} />No inquiries yet</h3><p className="empty-note">The CRM Dashboard is built from the Inquiry Tracker. {canEdit ? <>Upload the concierge inquiry tracker, or add inquiries in the Inquiry Tracker.</> : "The concierge team hasn't added any inquiries yet."} The CRM then shows inquiries, bookings, no-shows, follow-ups, reminders, referrals and channel performance.</p>{canEdit && <div className="crm-actions"><button type="button" className="btn btn-primary" onClick={() => pickFiles("concierge")} disabled={busy}><Upload size={16} />Upload tracker file</button><button type="button" className="btn btn-outline" onClick={() => openTracker()}><ListChecks size={16} />Open the Inquiry Tracker</button></div>}</div>)}

        {!restoring && tab === "tracker" && canEdit && (
          <InquiryTracker key={trackerFocus.n} rows={inquiries} initialSearch={trackerFocus.search}
            sheets={sheets} busy={busy} onUpload={() => pickFiles("concierge")}
            onSave={saveInquiry} onAdd={() => openEditor()} onOpen={(row) => openEditor(row)} />
        )}

        {tab === "summary" && sales.length > 0 && (
          <>
            <header className="top">
              <div>
                <h1>Sales Dashboard</h1>
                <p className="sub">The Heart Specialists Clinic &amp; Diagnostic: revenue, patients and where they come from</p>
                {summary && (
                  <div className="crm-actions no-print">
                    <PdfButton make={() => salesReport(summary, {
                      period, findings, decisions, typeLabel: hasTypes ? `${typeInfo.short} patients` : "Patients",
                      filters: [hasTypes ? `Patient type: ${typeInfo.label}` : "", hasPaid ? `Status: ${filters.status === "paid" ? "PAID only" : "all statuses"}` : "", `Dates: ${filters.from || filters.to ? `${filters.from || "first"} to ${filters.to || "last"}` : "all uploaded dates"}`, `Source: ${salesSheets.map((s) => s.file).filter((f, i, all) => all.indexOf(f) === i).join(", ")}`].filter(Boolean).join(" · "),
                    })} />
                  </div>
                )}
              </div>
              <div className="period">
                Reporting period<br /><strong>{period}</strong>
                <div className="filters-note">{hasTypes ? `Patient type: ${typeInfo.short}` : "All patient types"}{hasPaid ? ` · Status: ${filters.status === "paid" ? "PAID" : "All"}` : ""}</div>
              </div>
            </header>

            <SalesFiles heading="My sales report files" scope={cloud ? "Your own files: only your account sees them, and other people's uploads never change this dashboard." : undefined} sheets={mySheets} rows={sales} busy={busy} onAdd={() => pickFiles("sales")} onRemove={(targets) => void removeSalesFiles(targets, "mine")} />

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

        {!restoring && tab === "summary" && sales.length === 0 && (
          <>
            <header className="top">
              <div>
                <h1>Sales Dashboard</h1>
                <p className="sub">The Heart Specialists Clinic &amp; Diagnostic: revenue, patients and where they come from</p>
              </div>
              <div className="period">Reporting period<br /><strong>No sales report yet</strong></div>
            </header>
            {personalMissing && <div className="alert" role="alert"><div><strong>One database step is left.</strong> Personal Sales Dashboards need the updated <code>supabase/schema.sql</code>: run it once in Supabase → SQL Editor. Until then, sales reports can&apos;t be saved here.</div></div>}
            <SalesFiles heading="My sales report files" scope={cloud ? "Your own files: only your account sees them, and other people's uploads never change this dashboard." : undefined} sheets={mySheets} rows={sales} busy={busy} onAdd={() => pickFiles("sales")} onRemove={(targets) => void removeSalesFiles(targets, "mine")}>
              {cloud && teamSales.length > 0 && (
                <p className="empty-note" style={{ marginTop: 10 }}>Or start from the team&apos;s shared sales reports ({count(teamSales.length)} rows, the ones behind Patient Acquisition Cost): <button type="button" className="link-btn" disabled={busy} onClick={() => void copyTeamSales()}>copy them into my Sales Dashboard</button>.</p>
              )}
            </SalesFiles>
          </>
        )}
      </div>
      {dragging && canEdit && (
        <div className="drop-overlay no-print" onDragLeave={() => setDragging(false)}><div><Upload size={28} />Drop Excel files to add them</div></div>
      )}
      <DrillPanel drill={drill} onClose={closeDrill} context={tab === "crm" ? "Concierge inquiry tracker" : tab === "acquisition" ? "Patient Acquisition Cost" : [period, hasTypes ? (filters.patientType === "all" ? "All patient types" : typeInfo.short) : "", hasPaid && filters.status === "paid" ? "PAID" : ""].filter(Boolean).join(" · ")} />
      {team && auth.status === "signedIn" && <TeamPanel me={auth.userId} onClose={closeTeam} />}
      {editor && <InquiryEditor key={editor.row?.rowKey || "new"} row={editor.row} isNew={!editor.row} rows={inquiries} onSave={saveInquiry} onDelete={deleteInquiry} onClose={closeEditor} />}
    </main>
    </EditorProvider>
    </DrillProvider>
  );
}
