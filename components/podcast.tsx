"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, ExternalLink, FileSpreadsheet, Mic, Pencil, Play, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RankedBars } from "@/components/charts";
import { PdfButton } from "@/components/pdf-button";
import { podcastReport } from "@/lib/reports";
import type { AnalyticsResponse, Format, ImportedFile, PlanFormat, PlanStatus, PodcastData, PodcastPlan, PodcastStore, Snapshot, Video } from "@/lib/podcast";
import { engagementRate, episodeName, formatOf, FORMATS, localDay, mergeVideos, newPlan, PLAN_FORMATS, PLAN_STATUSES, planAlert, planEvents, readExport, sumKnown, videoIdOf } from "@/lib/podcast";

type FormatFilter = "all" | Format;
type Period = "7d" | "30d" | "90d" | "12m" | "all";
type SortKey = "views" | "newest" | "engagement" | "watch";

const PERIODS: { id: Period; label: string; days: number | null }[] = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
  { id: "12m", label: "Last 12 months", days: 365 },
  { id: "all", label: "All time", days: null },
];
const SORTS: { id: SortKey; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "views", label: "Most views" },
  { id: "engagement", label: "Engagement rate" },
  { id: "watch", label: "Watch time" },
];
// Brand slots: episodes black, clips gold. Identity is also carried by labels and the legend.
const COLOR: Record<Format, string> = { episode: "var(--s1)", clip: "var(--s2)" };
const LIVE_CACHE = "thsc-podcast-live";

const number = new Intl.NumberFormat("en-PH");
const compact = new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 });
const hours = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 1 });
const formatDate = (iso: string | null, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) => (iso ? new Date(iso).toLocaleDateString("en-PH", options) : "—");
const show = (value: number | null | undefined) => (value === null || value === undefined ? "—" : number.format(Math.round(value)));
const percent = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(value < 0.1 ? 2 : 1)}%`);
const duration = (seconds: number | null) => seconds === null ? "—" : seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const shortTitle = (value: string, length = 46) => (value.length > length ? `${value.slice(0, length - 1)}…` : value);
/** "2026-10-19" → "Oct 19, 2026" (read as a local date, not UTC). */
const dayText = (day: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) => (day ? new Date(`${day}T00:00:00`).toLocaleDateString("en-PH", options) : "—");
/** "14:30" → "2:30 PM". */
const timeText = (time: string) => { if (!time) return ""; const [h, m] = time.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const daysAgo = (iso: string | null, now: number | null) => {
  if (!iso || !now) return "";
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};
const axisTick = { fill: "var(--ink-soft)", fontSize: 11, fontFamily: "var(--font-mono-stack)" };
const tooltipStyle = { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, maxWidth: 340, whiteSpace: "normal" as const };
const loadCache = () => { try { const raw = localStorage.getItem(LIVE_CACHE); return raw ? (JSON.parse(raw) as AnalyticsResponse) : null; } catch { return null; } };

function summarize(list: Video[]) {
  const views = sumKnown(list.map((v) => v.views));
  const likes = sumKnown(list.map((v) => v.likes));
  const comments = sumKnown(list.map((v) => v.comments));
  const watched = list.filter((v) => v.watchHours !== null);
  return { videos: list.length, views, likes, comments, rate: views ? (likes + comments) / views : null, watchHours: watched.length ? sumKnown(watched.map((v) => v.watchHours)) : null, average: list.length ? views / list.length : null };
}

/**
 * The Podcast Tracker & Scheduler tab (YouTube only): The Heart Speaks channel's figures from the YouTube
 * API, and the team's recording and publishing schedule. Admin, ManCom, Doctors and Marketing can change
 * the schedule; with accounts everything here is shared, without them it stays in this browser.
 */
export function PodcastDashboard({ store, canEdit, actor }: { store: PodcastStore; canEdit: boolean; actor: string }) {
  const [view, setView] = useState<"tracker" | "scheduler">("tracker");
  const [live, setLive] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [data, setData] = useState<PodcastData>({ plans: [], snapshots: [], imports: [] });
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState<number | null>(null);

  const refresh = useCallback(async (fresh: boolean) => {
    setLoading(true);
    try {
      const response = await fetch(fresh ? `/api/youtube?fresh=${Date.now()}` : "/api/youtube");
      if (!response.ok) throw new Error(`The YouTube service returned HTTP ${response.status}.`);
      const body = (await response.json()) as AnalyticsResponse;
      setLive(body); setFetchError(""); setNow(Date.now());
      try { localStorage.setItem(LIVE_CACHE, JSON.stringify(body)); } catch { /* not kept */ }
    } catch (cause) {
      setFetchError(navigator.onLine === false ? "You are offline. Showing the last saved figures." : cause instanceof Error ? cause.message : "Could not load the latest figures.");
    } finally { setLoading(false); }
  }, []);

  const reload = useCallback(async () => {
    try {
      const next = await store.load();
      setData({ plans: next.plans, snapshots: next.snapshots, imports: next.imports }); setMissing(Boolean(next.missing)); setLoaded(true);
    } catch (e) { setError((e as Error).message); }
  }, [store]);

  useEffect(() => {
    // The last saved figures straight away (also offline), then the latest from YouTube and the shared schedule.
    const start = setTimeout(() => { setLive(loadCache()); setNow(Date.now()); void refresh(false); void reload(); }, 0);
    return () => clearTimeout(start);
  }, [refresh, reload]);

  // Saves one item and updates the list on screen; errors show at the top of the tab.
  const put = useCallback(async (kind: "plan" | "snapshot" | "import", id: string, item: PodcastPlan | Snapshot | ImportedFile | null) => {
    if (missing) throw new Error("One database step is left: run the updated supabase/schema.sql in Supabase → SQL Editor, then try again.");
    if (item) await store.save(kind, id, item); else await store.remove(kind, id);
    setData((d) => {
      if (kind === "plan") return { ...d, plans: [...d.plans.filter((p) => p.id !== id), ...(item ? [item as PodcastPlan] : [])] };
      if (kind === "snapshot") return { ...d, snapshots: [...d.snapshots.filter((s) => s.date !== id), ...(item ? [item as Snapshot] : [])] };
      return { ...d, imports: [...d.imports.filter((f) => f.name !== id), ...(item ? [item as ImportedFile] : [])] };
    });
  }, [store, missing]);

  // One channel snapshot per day (subscribers and total views), so growth can be charted over time.
  const channel = live?.status === "ok" ? live.channel : null;
  useEffect(() => {
    if (!loaded || missing || !canEdit || !channel || !live) return;
    const snapshot: Snapshot = { date: localDay(Date.parse(live.fetchedAt)), subscribers: channel.subscribers, views: channel.totalViews };
    const saved = data.snapshots.find((s) => s.date === snapshot.date);
    if (saved && saved.subscribers === snapshot.subscribers && saved.views === snapshot.views) return;
    const t = setTimeout(() => void put("snapshot", snapshot.date, snapshot).catch(() => undefined), 0);
    return () => clearTimeout(t);
  }, [loaded, missing, canEdit, channel, live, data.snapshots, put]);

  const videos = useMemo(() => mergeVideos(live?.status === "ok" ? live.videos : [], data.imports.flatMap((f) => f.videos)), [live, data.imports]);
  const history = useMemo(() => [...data.snapshots].sort((a, b) => a.date.localeCompare(b.date)), [data.snapshots]);
  const today = now ? localDay(now) : "";

  const tabs = [
    { key: "tracker" as const, label: "YouTube tracker", icon: Play },
    { key: "scheduler" as const, label: "Scheduler", icon: CalendarDays, n: data.plans.filter((p) => p.status !== "published").length },
  ];

  return (
    <>
      <header className="top">
        <div>
          <h1>Podcast Tracker &amp; Scheduler</h1>
          <p className="sub">The Heart Speaks on YouTube: views, episodes and clips, subscribers, and the recording and publishing schedule</p>
          <div className="crm-actions no-print">
            <PdfButton make={() => podcastReport({ channel, videos, history, plans: data.plans, today, fetchedAt: live?.fetchedAt ?? null })} />
            <button type="button" className="btn btn-outline" onClick={() => { void refresh(true); void reload(); }} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : undefined} />{loading ? "Refreshing…" : "Refresh"}</button>
          </div>
        </div>
        <div className="period">
          YouTube figures<br /><strong>{live ? `Updated ${new Date(live.fetchedAt).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : loading ? "Connecting…" : "Not loaded yet"}</strong>
          <div className="filters-note">{store.shared ? "Schedule shared with the team" : "Schedule saved on this device"}</div>
        </div>
      </header>

      <div className="chips pod-views no-print" role="tablist" aria-label="Podcast views">
        {tabs.map((t) => {
          const Icon = t.icon;
          return <button key={t.key} type="button" role="tab" aria-selected={view === t.key} className={`chip-btn${view === t.key ? " on" : ""}`} onClick={() => setView(t.key)}><Icon size={14} aria-hidden />{t.label}{t.n ? ` · ${t.n}` : ""}</button>;
        })}
      </div>

      {missing && <div className="alert" role="alert"><div><strong>One database step is left.</strong> The schedule needs the updated <code>supabase/schema.sql</code>: run it once in Supabase → SQL Editor. The YouTube figures work already.</div></div>}
      {error && <div className="alert" role="alert"><AlertCircle size={18} /><div>{error}</div></div>}
      {fetchError && <div className="alert" role="alert"><AlertCircle size={18} /><div><strong>Could not refresh.</strong> {fetchError}</div></div>}

      {view === "tracker"
        ? <Tracker live={live} loading={loading} videos={videos} history={history} imports={data.imports} now={now} canEdit={canEdit}
            onImport={async (files) => { for (const f of files) await put("import", f.name, f); }} onRemoveImport={(name) => put("import", name, null)} />
        : <Scheduler plans={data.plans} videos={videos} today={today} canEdit={canEdit} actor={actor}
            onSave={(plan) => put("plan", plan.id, plan)} onDelete={(plan) => put("plan", plan.id, null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// YouTube tracker

function Tracker({ live, loading, videos: allVideos, history, imports, now, canEdit, onImport, onRemoveImport }: {
  live: AnalyticsResponse | null; loading: boolean; videos: Video[]; history: Snapshot[]; imports: ImportedFile[]; now: number | null; canEdit: boolean;
  onImport: (files: ImportedFile[]) => Promise<void>; onRemoveImport: (name: string) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [format, setFormat] = useState<FormatFilter>("all");
  const [period, setPeriod] = useState<Period>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [query, setQuery] = useState("");
  const [metric, setMetric] = useState<"views" | "subscribers">("views");
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const channel = live?.status === "ok" ? live.channel : null;
  const hasData = allVideos.length > 0 || channel !== null;
  const importedCount = imports.reduce((n, f) => n + f.videos.length, 0);

  const importFiles = async (incoming: File[]) => {
    const files = incoming.filter((file) => /\.(csv|xlsx|xls)$/i.test(file.name));
    if (inputRef.current) inputRef.current.value = "";
    if (!files.length) { setImportError("Please choose a .csv, .xlsx or .xls export."); return; }
    setImporting(true);
    const read: ImportedFile[] = [], problems: string[] = [];
    for (const file of files) {
      try { read.push(await readExport(file)); } catch (cause) { problems.push(cause instanceof Error ? cause.message : `${file.name} could not be read.`); }
    }
    try { await onImport(read); } catch (e) { problems.push((e as Error).message); }
    setImportError(problems.join(" ")); setImporting(false);
  };

  const cutoff = useMemo(() => {
    const days = PERIODS.find((p) => p.id === period)?.days;
    return days && now ? now - days * 86_400_000 : null;
  }, [period, now]);
  // Period only; the format filter is applied on top so the episodes-vs-clips table can compare both.
  const scoped = useMemo(() => allVideos.filter((v) => cutoff === null || (v.publishedAt !== null && Date.parse(v.publishedAt) >= cutoff)), [allVideos, cutoff]);
  const videos = useMemo(() => (format === "all" ? scoped : scoped.filter((v) => formatOf(v) === format)), [scoped, format]);
  const totals = summarize(videos);
  const byFormat = FORMATS.map((f) => ({ ...f, ...summarize(scoped.filter((v) => formatOf(v) === f.id)) }));
  const all = summarize(scoped);
  const episodeStats = byFormat[0], clipStats = byFormat[1];

  // Growth since the first snapshot in the last 30 days.
  const growth = useMemo(() => {
    if (!now || history.length < 2) return null;
    const since = localDay(now - 30 * 86_400_000);
    const last = history.at(-1)!;
    const first = history.find((s) => s.date >= since && s.date !== last.date);
    if (!first) return null;
    const delta = (field: "subscribers" | "views") => (first[field] !== null && last[field] !== null ? last[field]! - first[field]! : null);
    return { since: first.date, subscribers: delta("subscribers"), views: delta("views") };
  }, [history, now]);
  const gainLabel = (value: number | null | undefined) => (growth && value != null ? `${value >= 0 ? "+" : "−"}${number.format(Math.abs(value))} since ${dayText(growth.since, { month: "short", day: "numeric" })}` : null);

  // Each episode (or clip, when that format is chosen) in publish order, newest 20.
  const seriesFormat: Format = format === "clip" ? "clip" : "episode";
  const seriesName = seriesFormat === "episode" ? "episode" : "clip";
  const series = useMemo(() => scoped.filter((v) => formatOf(v) === seriesFormat && v.publishedAt).sort((a, b) => Date.parse(a.publishedAt!) - Date.parse(b.publishedAt!)).slice(-20)
    .map((v) => ({ ...v, label: formatDate(v.publishedAt, { month: "short", day: "numeric" }) })), [scoped, seriesFormat]);
  const latest = series.at(-1) ?? null;
  const seriesAverage = series.length ? sumKnown(series.map((v) => v.views)) / series.length : null;

  const months = useMemo(() => {
    const dated = videos.filter((v) => v.publishedAt);
    if (!dated.length) return [];
    const newest = new Date(Math.max(...dated.map((v) => Date.parse(v.publishedAt!))));
    const buckets = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(newest.getFullYear(), newest.getMonth() - 11 + i, 1);
      return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString("en-PH", { month: "short", year: "2-digit" }), episode: 0, clip: 0 };
    });
    dated.forEach((v) => {
      const d = new Date(v.publishedAt!);
      const bucket = buckets.find((b) => b.key === `${d.getFullYear()}-${d.getMonth()}`);
      if (bucket) bucket[formatOf(v)] += v.views ?? 0;
    });
    const first = buckets.findIndex((b) => b.episode || b.clip);
    return first < 0 ? [] : buckets.slice(first);
  }, [videos]);
  const monthFormats = FORMATS.filter((f) => format === "all" || format === f.id);

  const top = useMemo(() => [...videos].filter((v) => v.views).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 8), [videos]);
  const growthSeries = useMemo(() => history.filter((s) => s[metric] !== null).map((s) => ({ label: dayText(s.date, { month: "short", day: "numeric" }), date: s.date, value: s[metric] })), [history, metric]);

  const table = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle ? videos.filter((v) => v.title.toLowerCase().includes(needle)) : [...videos];
    const by: Record<SortKey, (v: Video) => number> = {
      views: (v) => v.views ?? -1,
      newest: (v) => (v.publishedAt ? Date.parse(v.publishedAt) : 0),
      engagement: (v) => engagementRate(v) ?? -1,
      watch: (v) => v.watchHours ?? -1,
    };
    return list.sort((a, b) => by[sort](b) - by[sort](a));
  }, [videos, query, sort]);

  const periodLabel = PERIODS.find((p) => p.id === period)!.label;
  const formatLabel = format === "all" ? "Episodes and clips" : FORMATS.find((f) => f.id === format)!.label;
  const status = loading && !live ? { icon: <RefreshCw size={15} className="spin" />, text: "Connecting…", tone: "" }
    : channel ? { icon: <CheckCircle2 size={15} />, text: "Connected", tone: " ok" }
    : live?.status === "error" ? { icon: <AlertCircle size={15} />, text: "Connection problem", tone: " bad" }
    : { icon: <CircleDashed size={15} />, text: importedCount ? "Using imported export" : "Not connected", tone: " bad" };

  return (
    <>
      <div className="panel pod-channel">
        <div className="pod-channel-row">
          {channel ? (
            <div className="pod-channel-id">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {channel.avatar ? <img src={channel.avatar} alt="" width={48} height={48} referrerPolicy="no-referrer" /> : <span className="pod-avatar" />}
              <div><a href={channel.url} target="_blank" rel="noreferrer">{channel.name}</a><small>{show(channel.subscribers)} subscribers · {show(channel.totalViews)} views · {show(channel.videoCount)} videos</small></div>
            </div>
          ) : (
            <p className="empty-note">{loading && !live ? "Loading the latest figures…" : live?.message || "The YouTube figures need YOUTUBE_API_KEY in Vercel (see the README)."}{importedCount > 0 ? ` ${number.format(importedCount)} imported videos are shown.` : ""}</p>
          )}
          <span className={`pod-status${status.tone}`}>{status.icon}{status.text}</span>
        </div>
        <div className="pod-import">
          <div><strong>Optional: watch time from YouTube Studio</strong><small>YouTube Studio → Analytics → Advanced mode → Export current view → CSV, then import the Table data.csv file. The public YouTube figures have no watch time.</small></div>
          {canEdit && <button type="button" className="btn btn-outline" disabled={importing} onClick={() => inputRef.current?.click()}><FileSpreadsheet size={16} />{importing ? "Importing…" : "Import export"}</button>}
          <input ref={inputRef} type="file" multiple accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="sr-only" onChange={(e) => void importFiles(Array.from(e.target.files || []))} />
        </div>
        {imports.length > 0 && (
          <div className="loaded" aria-label="Imported files">
            {imports.map((f) => (
              <span key={f.name} className="chip"><CheckCircle2 size={14} /><span>{f.name}</span><small>{number.format(f.videos.length)} video{f.videos.length === 1 ? "" : "s"}</small>
                {canEdit && <button type="button" className="icon-btn" aria-label={`Remove ${f.name}`} onClick={() => void onRemoveImport(f.name).catch((e) => setImportError((e as Error).message))}><X size={14} /></button>}
              </span>
            ))}
          </div>
        )}
      </div>
      {importError && <div className="alert" role="alert"><AlertCircle size={18} /><div><strong>Check the export.</strong> {importError}</div></div>}
      {(live?.warnings.length ?? 0) > 0 && <div className="notice" role="status"><div>{live!.warnings.join(" ")}</div></div>}

      <div className="filterbar no-print pod-filters">
        <label>Format
          <select value={format} onChange={(e) => setFormat(e.target.value as FormatFilter)}>
            <option value="all">Episodes and clips</option>
            {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
        <label>Published
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>{PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        </label>
        <p className="filters-note">{periodLabel} · {formatLabel}. Uploads published in this period, with their lifetime views.</p>
      </div>

      <div className="kpis four">
        <div className="kpi"><div className="label">Views</div><div className="value">{hasData ? number.format(totals.views) : "—"}</div>
          <div className="note">{hasData ? (period === "all" && format === "all" && gainLabel(growth?.views)) || `${number.format(totals.videos)} uploads · ${totals.average === null ? "—" : compact.format(totals.average)} avg each` : "Connect YouTube to begin"}</div></div>
        <div className="kpi"><div className="label">Full episodes</div><div className="value">{hasData ? number.format(episodeStats.videos) : "—"}</div>
          <div className="note">{episodeStats.average === null ? "8 minutes or longer" : `${compact.format(episodeStats.average)} avg views per episode`}</div></div>
        <div className="kpi"><div className="label">Clips &amp; shorts</div><div className="value">{hasData ? number.format(clipStats.videos) : "—"}</div>
          <div className="note">{clipStats.average === null ? "Under 8 minutes" : `${compact.format(clipStats.average)} avg views per clip`}</div></div>
        <div className="kpi accent"><div className="label">Subscribers</div><div className="value">{show(channel?.subscribers)}</div>
          <div className="note">{gainLabel(growth?.subscribers) ?? (channel ? `${show(channel.totalViews)} total channel views` : "Connect YouTube to begin")}</div></div>
      </div>

      <section>
        <div className="section-head-row">
          <div><h2>Views per {seriesName}</h2><p className="section-note">Each {seriesName} in publish order (latest 20), with lifetime views. Newer ones have had less time to collect views.</p></div>
          {latest && (
            <a className="pod-latest" href={latest.url || undefined} target="_blank" rel="noreferrer">
              <small>Latest {seriesName} · {daysAgo(latest.publishedAt, now) || formatDate(latest.publishedAt)}</small>
              <strong>{episodeName(latest.title)}</strong>
              <small>{show(latest.views)} views{seriesAverage ? ` · ${compact.format(seriesAverage)} average for these ${series.length}` : ""}</small>
            </a>
          )}
        </div>
        <div className="panel">
          {series.length ? (
            <div className="chart-box pod-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--line)" }} interval="preserveStartEnd" minTickGap={8} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => compact.format(Number(v))} />
                  <Tooltip cursor={{ fill: "var(--line)", opacity: 0.4 }} contentStyle={tooltipStyle} labelStyle={{ fontWeight: 600 }}
                    labelFormatter={(_, payload) => { const v = payload?.[0]?.payload as Video | undefined; return v ? `${formatDate(v.publishedAt)} · ${episodeName(v.title)}` : ""; }}
                    formatter={(value) => [`${number.format(Number(value))} views`, "Views"]} />
                  <Bar dataKey="views" fill={COLOR[seriesFormat]} radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="empty-note">Your {seriesName}s will appear here.</p>}
        </div>
      </section>

      <section>
        <h2>Episodes vs clips</h2>
        <p className="section-note">Published {periodLabel.toLowerCase()}. Click a row to show only that format.</p>
        <div className="panel">
          <div className="table-scroll">
            <table className="acq-types">
              <tbody>
                <tr><th>Format</th><th>Includes</th><th className="num">Uploads</th><th className="num">Views</th><th className="num">Avg views</th><th className="num">Likes</th><th className="num">Comments</th><th className="num">Engagement</th><th className="num">Watch time (h)</th><th className="num">Share of views</th></tr>
                {[...byFormat.map((f) => ({ ...f, key: f.id as FormatFilter, name: f.label.toUpperCase() })), { ...all, key: "all" as FormatFilter, name: "ALL UPLOADS", description: "Every upload", id: null }].map((row) => (
                  <tr key={row.key} className={`is-clickable${format === row.key ? " selected" : ""}${row.key === "all" ? " total" : ""}`} tabIndex={0} role="button" aria-pressed={format === row.key}
                    onClick={() => setFormat(row.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFormat(row.key); } }}>
                    <td className="name">{row.id && <i className="pod-swatch" style={{ background: COLOR[row.id] }} />}{row.name}</td>
                    <td className="name muted">{row.description}</td>
                    <td className="num">{hasData ? number.format(row.videos) : "—"}</td>
                    <td className="num">{row.videos ? number.format(row.views) : "—"}</td>
                    <td className="num">{show(row.average)}</td>
                    <td className="num">{row.videos ? number.format(row.likes) : "—"}</td>
                    <td className="num">{row.videos ? number.format(row.comments) : "—"}</td>
                    <td className="num">{percent(row.rate)}</td>
                    <td className="num">{row.watchHours === null ? "—" : hours.format(row.watchHours)}</td>
                    <td className="num">{row.videos && all.views ? `${((row.views / all.views) * 100).toFixed(1)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <div className="grid-even">
          <div className="panel">
            <h3>Views by publish month</h3>
            <p className="drill-meta" style={{ marginTop: -8, marginBottom: 10 }}>Lifetime views of what was published each month, latest 12 months.</p>
            {months.length ? (
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={months} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--line)" />
                    <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--line)" }} interval="preserveStartEnd" minTickGap={10} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => compact.format(Number(v))} />
                    <Tooltip cursor={{ fill: "var(--line)", opacity: 0.4 }} contentStyle={tooltipStyle} labelStyle={{ fontWeight: 600 }} formatter={(value, name) => [`${number.format(Number(value))} views`, FORMATS.find((f) => f.id === name)?.label ?? String(name)]} />
                    {monthFormats.length > 1 && <Legend formatter={(value) => FORMATS.find((f) => f.id === value)?.label} iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12, color: "var(--ink-soft)" }} />}
                    {monthFormats.map((f, i, list) => <Bar key={f.id} dataKey={f.id} stackId="views" fill={COLOR[f.id]} radius={i === list.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={36} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="empty-note">Monthly views will appear here.</p>}
          </div>
          <div className="panel">
            <h3>Top videos</h3>
            <p className="drill-meta" style={{ marginTop: -8, marginBottom: 10 }}>Most viewed uploads published {periodLabel.toLowerCase()}. Click one to open it on YouTube.</p>
            {top.length ? <RankedBars label="Top videos by views" color="var(--s2)" format={(v) => `${number.format(v)} views`}
              items={top.map((v, i) => ({ name: `${i + 1}. ${shortTitle(episodeName(v.title))}`, value: v.views ?? 0, note: FORMATS.find((f) => f.id === formatOf(v))!.short }))}
              onSelect={(name) => { const v = top[Number(name.split(".")[0]) - 1]; if (v?.url) window.open(v.url, "_blank", "noopener"); }} />
              : <p className="empty-note">Your most viewed uploads will appear here.</p>}
          </div>
        </div>
      </section>

      <section>
        <div className="section-head-row">
          <div><h2>{metric === "views" ? "Total channel views" : "Subscribers"} over time</h2><p className="section-note">One reading a day, saved whenever this tab is opened.</p></div>
          <div className="chips no-print" role="group" aria-label="Growth metric">
            {(["views", "subscribers"] as const).map((m) => <button key={m} type="button" className={`chip-btn${metric === m ? " on" : ""}`} aria-pressed={metric === m} onClick={() => setMetric(m)}>{m === "views" ? "Views" : "Subscribers"}</button>)}
          </div>
        </div>
        <div className="panel">
          {growthSeries.length >= 2 ? (
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={growthSeries} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={24} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={52} domain={["auto", "auto"]} tickFormatter={(v) => compact.format(Number(v))} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ fontWeight: 600 }} formatter={(value) => [number.format(Number(value)), metric === "views" ? "Views" : "Subscribers"]} />
                  <Line type="monotone" dataKey="value" stroke="var(--s2)" strokeWidth={2} dot={growthSeries.length <= 31 ? { r: 3, fill: "var(--s2)", stroke: "var(--panel)", strokeWidth: 2 } : false} activeDot={{ r: 5 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="empty-note">Growth starts tracking today: the line appears once the tab has been opened on two different days.</p>}
        </div>
      </section>

      <section>
        <div className="section-head-row">
          <div><h2>All uploads</h2><p className="section-note">{hasData ? `${number.format(table.length)} of ${number.format(videos.length)} · ${formatLabel} · ${periodLabel}` : "Uploads will appear once YouTube is connected."}</p></div>
          <div className="filterbar no-print pod-search">
            <label className="trk-search">Search<span><Search size={15} aria-hidden /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Video title" aria-label="Search video titles" /></span></label>
            <label>Sort<select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>{SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          </div>
        </div>
        <div className="panel trk-panel">
          <div className="trk-scroll">
            <table className="pod-videos">
              <thead><tr><th>Video</th><th>Published</th><th className="num">Length</th><th className="num">Views</th><th className="num">Likes</th><th className="num">Comments</th><th className="num">Watch (h)</th><th className="num">Engagement</th></tr></thead>
              <tbody>
                {table.length ? table.slice(0, 300).map((v) => {
                  const kind = formatOf(v);
                  return (
                    <tr key={v.id}>
                      <td className="name">
                        <div className="pod-video">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {v.thumbnail ? <img src={v.thumbnail} alt="" width={72} height={40} loading="lazy" referrerPolicy="no-referrer" /> : <span className="pod-thumb"><Play size={15} /></span>}
                          <div>{v.url ? <a href={v.url} target="_blank" rel="noreferrer">{v.title}<ExternalLink size={11} className="inline-icon" /></a> : <span>{v.title}</span>}
                            <small><i className="pod-swatch" style={{ background: COLOR[kind] }} />{FORMATS.find((f) => f.id === kind)!.short}</small></div>
                        </div>
                      </td>
                      <td>{formatDate(v.publishedAt)}</td>
                      <td className="num">{duration(v.durationSec)}</td>
                      <td className="num strong">{show(v.views)}</td>
                      <td className="num">{show(v.likes)}</td>
                      <td className="num">{show(v.comments)}</td>
                      <td className="num">{v.watchHours === null ? "—" : hours.format(v.watchHours)}</td>
                      <td className="num">{percent(engagementRate(v))}</td>
                    </tr>
                  );
                }) : <tr><td colSpan={8} className="empty-note">{query ? "No uploads match your search." : "No uploads in this period."}</td></tr>}
              </tbody>
            </table>
          </div>
          {table.length > 300 && <p className="empty-note" style={{ padding: "10px 14px" }}>Showing the first 300. Search or change the sort to find others.</p>}
        </div>
      </section>

      <footer className="source">Full episodes are uploads 8 minutes or longer; shorter uploads count as clips &amp; shorts. Views are lifetime totals from YouTube. Engagement rate = likes and comments ÷ views. YouTube rounds subscriber counts. The YouTube key stays on the server; this tab can only read the channel&apos;s public figures.</footer>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Scheduler

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const statusInfo = (id: PlanStatus) => PLAN_STATUSES.find((s) => s.id === id)!;
const formatLabelOf = (id: PlanFormat) => PLAN_FORMATS.find((f) => f.id === id)?.label ?? id;

function Scheduler({ plans, videos, today, canEdit, actor, onSave, onDelete }: {
  plans: PodcastPlan[]; videos: Video[]; today: string; canEdit: boolean; actor: string;
  onSave: (plan: PodcastPlan) => Promise<void>; onDelete: (plan: PodcastPlan) => Promise<void>;
}) {
  const [month, setMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [editing, setEditing] = useState<{ plan: PodcastPlan; isNew: boolean } | null>(null);
  const [filter, setFilter] = useState<"open" | "late" | "all" | PlanStatus>("open");
  const byId = useMemo(() => new Map(videos.map((v) => [v.id, v])), [videos]);
  const videoOf = (plan: PodcastPlan) => byId.get(videoIdOf(plan.youtubeUrl)) ?? null;
  const events = useMemo(() => planEvents(plans), [plans]);

  const in30 = today ? localDay(new Date(`${today}T00:00:00`).getTime() + 30 * 86_400_000) : "";
  const upcoming = (kind: "record" | "publish") => events.filter((e) => e.kind === kind && e.date >= today && e.date <= in30 && (kind === "publish" ? e.plan.status !== "published" : e.plan.status === "idea" || e.plan.status === "scheduled")).length;
  const late = plans.filter((p) => today && planAlert(p, today));
  const inProduction = plans.filter((p) => p.status === "recorded" || p.status === "editing").length;

  // The month grid, Sunday first, with the days before and after the month to fill the weeks.
  const first = new Date(month.y, month.m, 1);
  const start = new Date(month.y, month.m, 1 - first.getDay());
  const weeks = Math.ceil((first.getDay() + new Date(month.y, month.m + 1, 0).getDate()) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => { const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i); return { key: localDay(d.getTime()), d: d.getDate(), inMonth: d.getMonth() === month.m }; });
  const eventsOn = useMemo(() => { const m = new Map<string, typeof events>(); events.forEach((e) => m.set(e.date, [...(m.get(e.date) || []), e])); return m; }, [events]);
  const move = (by: number) => setMonth(({ y, m }) => { const d = new Date(y, m + by, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  const sortKey = (p: PodcastPlan) => p.publishDate || p.recordDate || "9999";
  const list = plans.filter((p) => filter === "all" ? true : filter === "open" ? p.status !== "published" : filter === "late" ? Boolean(today && planAlert(p, today)) : p.status === filter)
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.title.localeCompare(b.title));
  const open = (plan: PodcastPlan) => setEditing({ plan, isNew: false });
  const add = (date = "") => setEditing({ plan: newPlan(date), isNew: true });

  return (
    <>
      <div className="kpis four">
        <div className="kpi"><div className="label">Recordings · next 30 days</div><div className="value">{number.format(upcoming("record"))}</div><div className="note">Ideas and scheduled episodes with a recording date</div></div>
        <div className="kpi"><div className="label">To publish · next 30 days</div><div className="value">{number.format(upcoming("publish"))}</div><div className="note">Planned YouTube publish dates</div></div>
        <div className="kpi"><div className="label">In production</div><div className="value">{number.format(inProduction)}</div><div className="note">Recorded or being edited</div></div>
        <div className="kpi accent"><div className="label">Needs attention</div><div className="value">{number.format(late.length)}</div><div className="note">{late.length ? "Recording or publish date has passed" : "Everything is on schedule"}</div></div>
      </div>

      <section>
        <div className="section-head-row">
          <div><h2>Calendar</h2><p className="section-note">Recording days (<Mic size={12} className="inline-icon" />) and YouTube publish dates (<Play size={12} className="inline-icon" />). {canEdit ? "Click a day to plan something on it, or an entry to update it." : "Click an entry to see its details."}</p></div>
          <div className="crm-actions no-print" style={{ marginTop: 0 }}>
            {canEdit && <button type="button" className="btn btn-primary" onClick={() => add()}><Plus size={16} />Add to schedule</button>}
          </div>
        </div>
        <div className="panel pod-cal">
          <div className="pod-cal-head">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => move(-1)} aria-label="Previous month"><ChevronLeft size={15} /></button>
            <strong>{first.toLocaleDateString("en-PH", { month: "long", year: "numeric" })}</strong>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => move(1)} aria-label="Next month"><ChevronRight size={15} /></button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { const d = new Date(); setMonth({ y: d.getFullYear(), m: d.getMonth() }); }}>Today</button>
          </div>
          <div className="pod-grid" role="grid" aria-label="Podcast calendar">
            {WEEKDAYS.map((w) => <div key={w} className="pod-wd" role="columnheader">{w}</div>)}
            {days.map((day) => (
              <div key={day.key} role="gridcell" className={`pod-day${day.inMonth ? "" : " out"}${day.key === today ? " today" : ""}`}>
                <div className="pod-day-head">
                  <span>{day.d}</span>
                  {canEdit && <button type="button" className="pod-add no-print" aria-label={`Plan something on ${dayText(day.key)}`} title="Plan on this day" onClick={() => add(day.key)}><Plus size={13} /></button>}
                </div>
                {(eventsOn.get(day.key) || []).map((e) => (
                  <button key={`${e.plan.id}-${e.kind}`} type="button" className={`pod-event ${e.kind}${e.plan.status === "published" ? " done" : ""}`} onClick={() => open(e.plan)}
                    title={`${e.kind === "record" ? "Recording" : "Publish on YouTube"}${e.time ? ` · ${timeText(e.time)}` : ""}: ${e.plan.title} (${statusInfo(e.plan.status).label})`}>
                    {e.kind === "record" ? <Mic size={11} aria-hidden /> : <Play size={11} aria-hidden />}
                    <span>{e.time ? `${timeText(e.time)} ` : ""}{e.plan.title || "Untitled"}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="section-head-row">
          <div><h2>Schedule</h2><p className="section-note">Every planned upload, by publish date. Published ones linked to a YouTube video show its live views.</p></div>
          <div className="chips no-print" role="group" aria-label="Show">
            {([["open", "Not yet published"], ["late", `Needs attention · ${late.length}`], ...PLAN_STATUSES.map((s) => [s.id, s.label]), ["all", "All"]] as [typeof filter, string][]).map(([id, label]) => (
              <button key={id} type="button" className={`chip-btn${filter === id ? " on" : ""}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="panel trk-panel">
          <div className="trk-scroll">
            <table className="pod-plans">
              <thead><tr><th>Title</th><th>Status</th><th>Recording</th><th>Publish on YouTube</th><th>Guest</th><th>Assigned to</th><th className="num">Views</th><th /></tr></thead>
              <tbody>
                {list.length ? list.map((p) => {
                  const v = videoOf(p), alert = today ? planAlert(p, today) : "";
                  return (
                    <tr key={p.id} className="is-clickable" tabIndex={0} onClick={() => open(p)} onKeyDown={(e) => { if (e.key === "Enter") open(p); }}>
                      <td className="name"><strong>{p.title || "Untitled"}</strong><small className="pod-sub">{formatLabelOf(p.format)}{p.host ? ` · Host: ${p.host}` : ""}</small></td>
                      <td><span className="pod-badge" style={{ borderLeftColor: statusInfo(p.status).color }}>{statusInfo(p.status).label}</span>{alert && <small className="pod-late">{alert}</small>}</td>
                      <td>{p.recordDate ? `${dayText(p.recordDate)}${p.recordTime ? ` · ${timeText(p.recordTime)}` : ""}` : "—"}{p.location && <small className="pod-sub">{p.location}</small>}</td>
                      <td>{p.publishDate ? `${dayText(p.publishDate)}${p.publishTime ? ` · ${timeText(p.publishTime)}` : ""}` : "—"}</td>
                      <td className="name">{p.guest || "—"}</td>
                      <td className="name">{p.assignedTo || "—"}</td>
                      <td className="num">{v ? <a href={v.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{show(v.views)}</a> : p.youtubeUrl ? <a href={p.youtubeUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open</a> : "—"}</td>
                      <td><span className="row-edit">{canEdit ? <><Pencil size={13} />Edit</> : "View"}</span></td>
                    </tr>
                  );
                }) : <tr><td colSpan={8} className="empty-note">{plans.length ? "Nothing in this view." : canEdit ? "Nothing scheduled yet. Use Add to schedule, or click a day in the calendar." : "Nothing scheduled yet."}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {editing && <PlanEditor key={editing.plan.id} plan={editing.plan} isNew={editing.isNew} videos={videos} plans={plans} canEdit={canEdit} actor={actor}
        onClose={() => setEditing(null)} onSave={async (plan) => { await onSave(plan); setEditing(null); }} onDelete={async (plan) => { await onDelete(plan); setEditing(null); }} />}
    </>
  );
}

function PlanEditor({ plan, isNew, videos, plans, canEdit, actor, onClose, onSave, onDelete }: {
  plan: PodcastPlan; isNew: boolean; videos: Video[]; plans: PodcastPlan[]; canEdit: boolean; actor: string;
  onClose: () => void; onSave: (plan: PodcastPlan) => Promise<void>; onDelete: (plan: PodcastPlan) => Promise<void>;
}) {
  const [form, setForm] = useState(plan);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof PodcastPlan>(key: K, value: PodcastPlan[K]) => setForm((f) => ({ ...f, [key]: value }));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const linkedId = videoIdOf(form.youtubeUrl);
  const linked = videos.find((v) => v.id === linkedId) ?? null;
  // Recent uploads not yet linked to another plan, to link this one in a click.
  const taken = new Set(plans.filter((p) => p.id !== plan.id).map((p) => videoIdOf(p.youtubeUrl)).filter(Boolean));
  const recent = [...videos].filter((v) => v.url && !taken.has(v.id)).sort((a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? "")).slice(0, 40);
  const pick = (id: string) => {
    const v = videos.find((x) => x.id === id);
    if (!v) return;
    const at = v.publishedAt ? new Date(v.publishedAt) : null;
    setForm((f) => ({ ...f, youtubeUrl: v.url, title: f.title || episodeName(v.title), status: "published", format: f.format === "episode" && formatOf(v) === "clip" ? "clip" : f.format,
      publishDate: at ? localDay(at.getTime()) : f.publishDate, publishTime: at ? `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}` : f.publishTime }));
  };

  const checks = {
    title: form.title.trim() !== "",
    recordDate: form.status !== "scheduled" || form.recordDate !== "" || form.publishDate !== "",
    youtubeUrl: !form.youtubeUrl.trim() || linkedId !== "",
  };
  const ok = Object.values(checks).every(Boolean);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setTried(true);
    if (!ok) { setError(!checks.title ? "Give it a title." : !checks.recordDate ? "A scheduled entry needs a recording or publish date." : "That doesn't look like a YouTube link."); return; }
    setBusy(true); setError("");
    try { await onSave({ ...form, title: form.title.trim(), youtubeUrl: form.youtubeUrl.trim(), createdBy: form.createdBy || actor || undefined, updatedBy: actor || undefined, updatedAt: new Date().toISOString() }); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError("");
    try { await onDelete(plan); } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  const bad = (field: keyof typeof checks) => (tried && !checks[field] ? " invalid" : "");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal pod-modal" role="dialog" aria-modal="true" aria-labelledby="plan-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><span className="drill-meta">Podcast schedule · YouTube</span><h2 id="plan-title">{isNew ? "Plan an upload" : canEdit ? "Update the schedule" : form.title || "Scheduled upload"}</h2>
            {!isNew && form.updatedAt && <p className="drill-meta">Last updated {new Date(form.updatedAt).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{form.updatedBy ? ` by ${form.updatedBy}` : ""}</p>}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <form className="modal-form" onSubmit={(e) => void save(e)}>
          <fieldset className="modal-body" disabled={!canEdit || busy}>
            <div className="editor-grid">
              <div className="editor-col">
                <fieldset>
                  <legend>Episode</legend>
                  <div className="field-grid two">
                    <label className={`full${bad("title")}`}><span>Title / topic{!checks.title && <span className="req">*</span>}</span>
                      <input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Kape: Kaba o Kalma?" autoFocus={isNew} /></label>
                    <label><span>Format</span><select value={form.format} onChange={(e) => set("format", e.target.value as PlanFormat)}>{PLAN_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
                    <label><span>Status</span><select value={form.status} onChange={(e) => set("status", e.target.value as PlanStatus)}>{PLAN_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
                    <label><span>Guest (doctor)</span><input value={form.guest} onChange={(e) => set("guest", e.target.value)} placeholder="e.g. Dr. Santos" /></label>
                    <label><span>Host</span><input value={form.host} onChange={(e) => set("host", e.target.value)} /></label>
                    <label className="full"><span>Assigned to</span><input value={form.assignedTo} onChange={(e) => set("assignedTo", e.target.value)} placeholder="Who prepares, edits or uploads it" /></label>
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Notes</legend>
                  <div className="field-grid two">
                    <label className="full"><span>Talking points, script, links</span><textarea rows={5} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></label>
                  </div>
                </fieldset>
              </div>
              <div className="editor-col">
                <fieldset>
                  <legend><Mic size={14} />Recording</legend>
                  <div className="field-grid two">
                    <label className={bad("recordDate")}><span>Date{!checks.recordDate && <span className="req">*</span>}</span><input type="date" value={form.recordDate} onChange={(e) => set("recordDate", e.target.value)} /></label>
                    <label><span>Time</span><input type="time" value={form.recordTime} onChange={(e) => set("recordTime", e.target.value)} /></label>
                    <label className="full"><span>Location / studio</span><input value={form.location} onChange={(e) => set("location", e.target.value)} /></label>
                  </div>
                </fieldset>
                <fieldset>
                  <legend><Play size={14} />Publish on YouTube</legend>
                  <div className="field-grid two">
                    <label><span>Date</span><input type="date" value={form.publishDate} onChange={(e) => set("publishDate", e.target.value)} /></label>
                    <label><span>Time</span><input type="time" value={form.publishTime} onChange={(e) => set("publishTime", e.target.value)} /></label>
                    <label className={`full${bad("youtubeUrl")}`}><span>YouTube link (once it&apos;s up)</span><input value={form.youtubeUrl} onChange={(e) => set("youtubeUrl", e.target.value)} placeholder="https://youtu.be/…" inputMode="url" /></label>
                    {canEdit && recent.length > 0 && (
                      <label className="full"><span>Or pick a recent upload</span>
                        <select value="" onChange={(e) => pick(e.target.value)}>
                          <option value="">Choose a video to link…</option>
                          {recent.map((v) => <option key={v.id} value={v.id}>{formatDate(v.publishedAt)} · {shortTitle(episodeName(v.title), 70)}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                  {linked && (
                    <a className="pod-latest" href={linked.url} target="_blank" rel="noreferrer" style={{ marginTop: 12 }}>
                      <small>Linked video · published {formatDate(linked.publishedAt)}</small>
                      <strong>{linked.title}</strong>
                      <small>{show(linked.views)} views · {show(linked.likes)} likes · {show(linked.comments)} comments</small>
                    </a>
                  )}
                </fieldset>
              </div>
            </div>
          </fieldset>
          <div className="modal-foot">
            {error && <div className="alert" role="alert"><AlertCircle size={18} /><div>{error}</div></div>}
            <div className="crm-actions" style={{ marginTop: 0, justifyContent: "space-between" }}>
              <div className="crm-actions" style={{ marginTop: 0 }}>
                {canEdit && !isNew && (confirmDelete
                  ? <><button type="button" className="btn btn-outline danger" disabled={busy} onClick={() => void remove()}><Trash2 size={15} />Yes, delete it</button><button type="button" className="btn btn-outline" onClick={() => setConfirmDelete(false)}>Keep it</button></>
                  : <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={15} />Delete</button>)}
              </div>
              <div className="crm-actions" style={{ marginTop: 0 }}>
                <button type="button" className="btn btn-outline" onClick={onClose}>{canEdit ? "Cancel" : "Close"}</button>
                {canEdit && <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : isNew ? "Add to schedule" : "Save changes"}</button>}
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
