import * as XLSX from "xlsx";

/**
 * Podcast Tracker & Scheduler (YouTube only): the figures come from the YouTube Data API through
 * /api/youtube (it used to be the separate THSC Podcast Tracker), plus optional YouTube Studio exports
 * for watch time. The schedule, the daily growth snapshots and the imported exports are shared by the
 * team in the cloud (podcast_items), or kept in this browser without accounts.
 */

/** One upload, from the live YouTube API or an imported YouTube Studio export. Counts are null when the source does not report them. */
export type Video = {
  id: string;
  title: string;
  url: string;
  thumbnail: string | null;
  publishedAt: string | null;
  durationSec: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  watchHours: number | null;
  impressions: number | null;
};

export type Channel = {
  name: string;
  url: string;
  avatar: string | null;
  subscribers: number | null;
  totalViews: number | null;
  videoCount: number | null;
};

export type AnalyticsResponse = {
  status: "ok" | "not-configured" | "error";
  channel: Channel | null;
  videos: Video[];
  message: string;
  warnings: string[];
  fetchedAt: string;
};

export const sumKnown = (values: (number | null)[]) => values.reduce<number>((total, value) => total + (value ?? 0), 0);

// Full episodes run 13–21 minutes and clips under 5, so 8 minutes separates them cleanly.
export type Format = "episode" | "clip";
export const EPISODE_MIN_SECONDS = 8 * 60;
export const FORMATS: { id: Format; label: string; short: string; description: string }[] = [
  { id: "episode", label: "Full episodes", short: "Episode", description: "8 minutes or longer" },
  { id: "clip", label: "Clips & shorts", short: "Clip", description: "Under 8 minutes" },
];
export const formatOf = (video: Video): Format => ((video.durationSec ?? 0) >= EPISODE_MIN_SECONDS ? "episode" : "clip");
// "The Heart Speaks: Kape - Kaba o Kalma (Caffeine and the heart)" → "Kape - Kaba o Kalma (Caffeine and the heart)"
export const episodeName = (title: string) => title.replace(/^the heart speaks(?: special episode)?\s*[:\-–—]\s*/i, "") || title;
export const engagementRate = (video: Video) => (video.views ? ((video.likes ?? 0) + (video.comments ?? 0)) / video.views : null);

/** Channel subscribers and total views on one day; one per day, so growth can be charted. */
export type Snapshot = { date: string; subscribers: number | null; views: number | null };
export const localDay = (time: number) => { const d = new Date(time); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// ---------------------------------------------------------------------------------------------
// Scheduler

export type PlanStatus = "idea" | "scheduled" | "recorded" | "editing" | "published";
export const PLAN_STATUSES: { id: PlanStatus; label: string; color: string }[] = [
  { id: "idea", label: "Idea", color: "var(--neutral)" },
  { id: "scheduled", label: "Scheduled", color: "var(--s3)" },
  { id: "recorded", label: "Recorded", color: "var(--s4)" },
  { id: "editing", label: "Editing", color: "var(--s2)" },
  { id: "published", label: "Published", color: "var(--s1)" },
];
export type PlanFormat = "episode" | "clip" | "short";
export const PLAN_FORMATS: { id: PlanFormat; label: string }[] = [
  { id: "episode", label: "Full episode" },
  { id: "clip", label: "Clip" },
  { id: "short", label: "YouTube Short" },
];

/** One planned YouTube upload: an episode, clip or short, from idea to published. */
export type PodcastPlan = {
  id: string;
  title: string;
  format: PlanFormat;
  status: PlanStatus;
  guest: string;
  host: string;
  /** YYYY-MM-DD and HH:MM, "" when not set. */
  recordDate: string;
  recordTime: string;
  publishDate: string;
  publishTime: string;
  location: string;
  assignedTo: string;
  youtubeUrl: string;
  notes: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
};

export const newPlan = (date = ""): PodcastPlan => ({
  id: `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  title: "", format: "episode", status: date ? "scheduled" : "idea", guest: "", host: "",
  recordDate: date, recordTime: "", publishDate: "", publishTime: "", location: "", assignedTo: "", youtubeUrl: "", notes: "",
});

/** The video ID in a YouTube link (watch?v=, youtu.be/, /shorts/, /live/, /embed/) or a bare 11-character ID. */
export function videoIdOf(link: string) {
  const text = link.trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (/(^|\.)youtu\.be$/i.test(url.hostname)) return /^\/([\w-]{11})/.exec(url.pathname)?.[1] || "";
    if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return "";
    const v = url.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    return /^\/(?:shorts|live|embed)\/([\w-]{11})/.exec(url.pathname)?.[1] || "";
  } catch { return ""; }
}

/** Where a plan stands today: late when its publish (or recording) date has passed without getting there. */
export function planAlert(plan: PodcastPlan, today: string) {
  if (plan.status !== "published" && plan.publishDate && plan.publishDate < today) return "Publish date passed";
  if ((plan.status === "idea" || plan.status === "scheduled") && plan.recordDate && plan.recordDate < today) return "Recording date passed";
  return "";
}

/** Recording and publishing dates as calendar events. */
export type PlanEvent = { plan: PodcastPlan; kind: "record" | "publish"; date: string; time: string };
export const planEvents = (plans: PodcastPlan[]): PlanEvent[] => plans.flatMap((plan) => [
  ...(plan.recordDate ? [{ plan, kind: "record" as const, date: plan.recordDate, time: plan.recordTime }] : []),
  ...(plan.publishDate ? [{ plan, kind: "publish" as const, date: plan.publishDate, time: plan.publishTime }] : []),
]).sort((a, b) => a.date.localeCompare(b.date) || (a.time || "99").localeCompare(b.time || "99") || a.plan.title.localeCompare(b.plan.title));

// ---------------------------------------------------------------------------------------------
// Saving: the team's shared database with accounts (lib/cloud.ts), this browser without them.

export type PodcastKind = "plan" | "snapshot" | "import";
export type PodcastData = { plans: PodcastPlan[]; snapshots: Snapshot[]; imports: ImportedFile[] };
export type PodcastItem = PodcastPlan | Snapshot | ImportedFile;
export type PodcastStore = {
  shared: boolean;
  load: () => Promise<PodcastData & { missing?: boolean }>;
  save: (kind: PodcastKind, id: string, item: PodcastItem) => Promise<void>;
  remove: (kind: PodcastKind, id: string) => Promise<void>;
};

const LOCAL = "thsc-podcast-items";
const readLocal = (): PodcastData => {
  try { const saved = JSON.parse(localStorage.getItem(LOCAL) || "{}") as Partial<PodcastData>; return { plans: saved.plans ?? [], snapshots: saved.snapshots ?? [], imports: saved.imports ?? [] }; }
  catch { return { plans: [], snapshots: [], imports: [] }; }
};
const LIST: Record<PodcastKind, { field: keyof PodcastData; id: (item: PodcastItem) => string }> = {
  plan: { field: "plans", id: (item) => (item as PodcastPlan).id },
  snapshot: { field: "snapshots", id: (item) => (item as Snapshot).date },
  import: { field: "imports", id: (item) => (item as ImportedFile).name },
};
function writeLocal(kind: PodcastKind, id: string, item: PodcastItem | null) {
  const data = readLocal();
  const { field, id: idOf } = LIST[kind];
  const list = (data[field] as PodcastItem[]).filter((x) => idOf(x) !== id);
  (data as Record<keyof PodcastData, PodcastItem[]>)[field] = item ? [...list, item] : list;
  try { localStorage.setItem(LOCAL, JSON.stringify(data)); } catch { throw new Error("This browser couldn't save it (storage is full or blocked)."); }
}
/** Without accounts: everything on the Podcast tab stays in this browser. */
export const localPodcastStore: PodcastStore = {
  shared: false,
  load: async () => readLocal(),
  save: async (kind, id, item) => writeLocal(kind, id, item),
  remove: async (kind, id) => writeLocal(kind, id, null),
};

// ---------------------------------------------------------------------------------------------
// YouTube Studio exports (Analytics → Advanced mode → Export → "Table data.csv"), read in the browser.

export type ImportedFile = { name: string; videos: Video[]; importedAt?: string };

const key = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const text = (value: unknown) => String(value ?? "").trim();

// Each field lists header names in order of preference (compared without spaces or punctuation).
const COLUMNS = {
  id: ["content", "videoid", "id"],
  title: ["videotitle", "title"],
  date: ["videopublishtime", "publishtime", "publishdate", "date"],
  duration: ["duration", "durationsec"],
  views: ["views"],
  watchHours: ["watchtimehours"],
  watchMinutes: ["watchtimeminutes"],
  likes: ["likes"],
  comments: ["comments", "commentsadded"],
  impressions: ["impressions"],
} as const;

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = text(value).replace(/[,%\s]/g, "");
  if (!cleaned || cleaned === "-") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function duration(value: unknown): number | null {
  const parts = text(value).split(":").map(Number);
  if (parts.length > 1 && parts.every(Number.isFinite)) return parts.reduce((total, part) => total * 60 + part, 0);
  return num(value);
}

function date(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M).toISOString() : null;
  }
  const parsed = Date.parse(text(value));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export async function readExport(file: File): Promise<ImportedFile> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "", raw: true });
  const headerIndex = grid.findIndex((row) => {
    const headers = (row || []).map(key);
    return COLUMNS.views.some((name) => headers.includes(name)) && [...COLUMNS.title, ...COLUMNS.id].some((name) => headers.includes(name));
  });
  if (headerIndex < 0) throw new Error(`${file.name}: no Views and Video title columns were found. Export the per-video table from YouTube Studio.`);

  const headers = grid[headerIndex].map(key);
  const column = (field: keyof typeof COLUMNS) => {
    for (const name of COLUMNS[field]) { const index = headers.indexOf(name); if (index >= 0) return index; }
    return -1;
  };
  const at = Object.fromEntries((Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).map((field) => [field, column(field)])) as Record<keyof typeof COLUMNS, number>;
  const cell = (row: unknown[], field: keyof typeof COLUMNS) => (at[field] >= 0 ? row[at[field]] : "");

  const videos: Video[] = [];
  grid.slice(headerIndex + 1).forEach((row, offset) => {
    const id = text(cell(row, "id"));
    const title = text(cell(row, "title"));
    const views = num(cell(row, "views"));
    // YouTube Studio puts a "Total" row first.
    if ((!id && !title) || views === null || /^total$/i.test(id) || /^total$/i.test(title)) return;
    const minutes = num(cell(row, "watchMinutes"));
    videos.push({
      id: id || `${file.name}-${offset}`,
      title: title || "Untitled video",
      url: /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : "",
      thumbnail: null,
      publishedAt: date(cell(row, "date")),
      durationSec: duration(cell(row, "duration")),
      views,
      likes: num(cell(row, "likes")),
      comments: num(cell(row, "comments")),
      watchHours: num(cell(row, "watchHours")) ?? (minutes !== null ? minutes / 60 : null),
      impressions: num(cell(row, "impressions")),
    });
  });
  if (!videos.length) throw new Error(`${file.name}: the table has no video rows.`);
  return { name: file.name, videos, importedAt: new Date().toISOString() };
}

/**
 * Combines live and imported videos. A video in both keeps the live counts (they are current)
 * and takes watch time and impressions from the import, which the public API does not report.
 */
export function mergeVideos(live: Video[], imported: Video[]) {
  const merged = new Map(live.map((video) => [video.id, video]));
  imported.forEach((video) => {
    const existing = merged.get(video.id);
    if (!existing) { merged.set(video.id, video); return; }
    merged.set(video.id, {
      ...existing,
      publishedAt: existing.publishedAt ?? video.publishedAt,
      durationSec: existing.durationSec ?? video.durationSec,
      views: existing.views ?? video.views,
      likes: existing.likes ?? video.likes,
      comments: existing.comments ?? video.comments,
      watchHours: existing.watchHours ?? video.watchHours,
      impressions: existing.impressions ?? video.impressions,
    });
  });
  return Array.from(merged.values());
}
