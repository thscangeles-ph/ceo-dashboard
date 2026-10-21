/**
 * Patient Feedback: the THSC feedback form's responses, read live from the RAW DATA tab of its Google
 * Sheet (through /api/feedback). The form asks a few questions about the patient (gender, age, how they
 * learned about and reached THSC), which service they availed, then that service's own block of rating
 * questions (Very Satisfied … Very Dissatisfied, or N/A), a comment, a previous experience and "Would you
 * recommend THSC". Nothing about the columns is fixed: each one is recognised from its header and its
 * answers, and each service's block is named after the service its patients chose, so new questions or
 * services added to the form show up on their own. Columns with names, contact numbers or email addresses
 * are recognised too and never shown. The date of visit is the period.
 */

export type FeedbackSheet = {
  status: "ok" | "not-configured" | "error";
  title: string;
  tab: string;
  headers: string[];
  /** Cell text as shown in the sheet; dates as "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM". */
  rows: string[][];
  /** The sheet row number of rows[0] (the row under the headers). */
  firstRow: number;
  message: string;
  /** The service account's email, to share the sheet with. */
  robot: string;
  fetchedAt: string;
};

export type ColumnKind = "timestamp" | "visit" | "date" | "identity" | "rating" | "recommend" | "yesno" | "choice" | "multi" | "text" | "empty";
export type Column = {
  index: number;
  header: string;
  /** The question as people read it: "[1. How satisfied …?]" → "1. How satisfied …?" */
  text: string;
  kind: ColumnKind;
  /** Rating questions: the scale (best = max) and the words for each point. */
  min?: number;
  max?: number;
  labels?: Record<number, string>;
};
export type Response = { row: number; visit: string | null; cells: string[] };
export type Section = { name: string; columns: Column[]; ratings: Column[]; texts: Column[]; recommend: Column[] };
export type Survey = { columns: Column[]; responses: Response[]; visit: Column | null; router: Column | null; profile: Column[]; sections: Section[]; hidden: Column[] };

const norm = (v: string) => v.toLowerCase().replace(/[’']/g, "'").replace(/[!.]+$/g, "").replace(/\s+/g, " ").trim();
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2})?$/;
/** "Not applicable" answers: left out of every count except the N/A column. */
export const isNA = (v: string) => /^(n\/?a|n\.a|na|not applicable|none|wala|wala po|-+|\.|no comments?|nothing)$/i.test(v.trim());
const clean = (v: string | undefined) => { const t = (v ?? "").trim(); return t && !isNA(t) ? t : ""; };

// Worded scales feedback forms commonly use, best = 5.
const WORD_SCALES: Record<string, number>[] = [
  { "very satisfied": 5, satisfied: 4, neutral: 3, "neither satisfied nor dissatisfied": 3, dissatisfied: 2, "very dissatisfied": 1, unsatisfied: 2, "very unsatisfied": 1 },
  { excellent: 5, "very good": 4, good: 3, fair: 2, poor: 1, "very poor": 1, average: 3, "needs improvement": 2 },
  { outstanding: 5, "very satisfactory": 4, satisfactory: 3, unsatisfactory: 2, poor: 1, "needs improvement": 2 },
  { "strongly agree": 5, agree: 4, neutral: 3, "neither agree nor disagree": 3, undecided: 3, disagree: 2, "strongly disagree": 1 },
  { "very likely": 5, likely: 4, neutral: 3, "not sure": 3, unlikely: 2, "very unlikely": 1 },
  { "very easy": 5, easy: 4, neutral: 3, difficult: 2, "very difficult": 1 },
];
const title = (v: string) => v.replace(/\b\w/g, (c) => c.toUpperCase());
/** A leading or trailing scale number in an answer such as "5 - Excellent" or "Very good (4)". */
const numberIn = (v: string) => { const m = /^(\d{1,2})(?:\s*[-–:.)]\s*\D.*)?$/.exec(v.trim()) || /\((\d{1,2})\)\s*$/.exec(v.trim()); return m ? Number(m[1]) : null; };
const YES = new Set(["yes", "y", "oo", "opo", "true"]);
const NO = new Set(["no", "n", "hindi", "hindi po", "false"]);

const IDENTITY = /e-?mail|contact|phone|mobile|cellphone|\bcell\b|telephone|\btel\b|address|facebook name|messenger name/i;
const NAME = /\bname\b|pangalan/i;
const NOT_PATIENT = /doctor|physician|\bdr\b|staff|nurse|employee|branch|clinic|service|department|technician|medtech|concierge|cashier|receptionist/i;
const COMMENT = /comment|suggest|experience|describe|remarks|feedback|reason|why|specify|concern/i;

/** "[1. How satisfied …?] 2" → "1. How satisfied …?" (grid rows are "Title [Row]"; exports number repeated headers). */
export function questionText(header: string) {
  let t = header.trim().replace(/(?<=[\]:?.])\s+\d+$/, "").trim();
  const grid = /^(.*?)\s*\[(.+)\]$/.exec(t);
  if (grid) t = grid[1] ? `${grid[1].trim()}: ${grid[2].trim()}` : grid[2].trim();
  return t;
}

function classify(headers: string[], rows: string[][]): Column[] {
  return headers.map((header, index): Column => {
    const all = rows.map((r) => (r[index] ?? "").trim()).filter(Boolean);
    const vals = all.filter((v) => !isNA(v));
    const base = { index, header, text: questionText(header) };
    if (IDENTITY.test(header) || (NAME.test(header) && !NOT_PATIENT.test(header))) return { ...base, kind: "identity" };
    if (!vals.length) {
      // An unanswered question still belongs to its service's block: a bracketed grid row is a rating.
      return { ...base, kind: /\[.+\]/.test(header) ? "rating" : /recommend/i.test(header) ? "recommend" : COMMENT.test(header) ? "text" : "empty", ...(/\[.+\]/.test(header) ? { min: 1, max: 5, labels: scaleLabels(WORD_SCALES[0], []) } : {}) };
    }
    const share = (test: (v: string) => boolean) => vals.filter(test).length / vals.length;
    if (share((v) => ISO_DAY.test(v)) >= 0.8) {
      if (/timestamp/i.test(header)) return { ...base, kind: "timestamp" };
      return { ...base, kind: /visit|consult|appointment|check.?up|petsa|bumisita|date of service|service date/i.test(header) ? "visit" : "date" };
    }
    if (/recommend|irerekomenda/i.test(header) && share((v) => /^(yes|no|maybe|oo|hindi|siguro|not sure)$/i.test(norm(v))) >= 0.8) return { ...base, kind: "recommend" };
    const nums = vals.map(numberIn);
    if (nums.filter((x) => x !== null).length / vals.length >= 0.8) {
      const known = nums.filter((x): x is number => x !== null);
      const lo = Math.min(...known), hi = Math.max(...known);
      if (lo >= 0 && hi <= 10) return { ...base, kind: "rating", min: lo === 0 ? 0 : 1, max: hi <= 5 ? 5 : hi <= 7 ? 7 : 10 };
    }
    for (const scale of WORD_SCALES) {
      if (share((v) => norm(v) in scale) >= 0.8) return { ...base, kind: "rating", min: 1, max: 5, labels: scaleLabels(scale, vals) };
    }
    if (vals.every((v) => YES.has(norm(v)) || NO.has(norm(v)))) return { ...base, kind: "yesno" };
    if (COMMENT.test(header)) return { ...base, kind: "text" };
    const distinct = new Set(vals.map(norm));
    const avgLength = vals.reduce((s, v) => s + v.length, 0) / vals.length;
    // Google Forms joins checkbox answers with ", ".
    const tokens = new Set(vals.flatMap((v) => v.split(", ").map(norm)));
    if (vals.filter((v) => v.includes(", ")).length / vals.length >= 0.15 && tokens.size <= 25 && tokens.size < distinct.size && avgLength < 120) return { ...base, kind: "multi" };
    if (distinct.size <= 30 && avgLength <= 70) return { ...base, kind: "choice" };
    return { ...base, kind: "text" };
  });
}
/** The words for every point of a scale: as written in the sheet where seen, otherwise the scale's own word. */
function scaleLabels(scale: Record<string, number>, seen: string[]) {
  const labels: Record<number, string> = {};
  seen.forEach((v) => { const p = scale[norm(v)]; if (p && !labels[p]) labels[p] = v; });
  Object.entries(scale).forEach(([word, p]) => { if (!labels[p]) labels[p] = title(word); });
  return labels;
}

/** Reads the sheet into questions, services and responses. */
export function buildSurvey(headers: string[], allRows: string[][], firstRow = 2): Survey {
  const numbered = allRows.map((cells, i) => ({ cells, row: firstRow + i })).filter((r) => r.cells.some((c) => c.trim()));
  const rows = numbered.map((r) => r.cells);
  const columns = classify(headers, rows);
  // Without a column named like a visit date, use another date column, then the form's timestamp.
  let visit = columns.find((c) => c.kind === "visit") ?? null;
  if (!visit) { visit = columns.find((c) => c.kind === "date" && /date|petsa/i.test(c.header)) ?? columns.find((c) => c.kind === "date") ?? null; if (visit) visit.kind = "visit"; }
  const when = visit ?? columns.find((c) => c.kind === "timestamp") ?? null;
  const responses = numbered.map(({ cells, row }) => ({ row, visit: when ? (ISO_DAY.exec(cells[when.index] ?? "")?.slice(1, 4).join("-") ?? null) : null, cells }));

  // Each service's block starts at a rating question that follows a non-rating column and runs until the next block.
  const firstRating = columns.findIndex((c) => c.kind === "rating");
  const blocks: Column[][] = [];
  if (firstRating >= 0) columns.slice(firstRating).forEach((c, i, list) => {
    if (c.kind === "identity" || c.kind === "empty" && !COMMENT.test(c.header)) return;
    if (c.kind === "rating" && (i === 0 || list[i - 1].kind !== "rating")) blocks.push([]);
    blocks.at(-1)?.push(c);
  });
  const before = columns.slice(0, firstRating < 0 ? columns.length : firstRating);
  const router = before.filter((c) => c.kind === "choice" || c.kind === "multi").sort((a, b) => Number(/servic|procedure|avail|department/i.test(b.header)) - Number(/servic|procedure|avail|department/i.test(a.header)) || b.index - a.index)[0] ?? null;
  const profile = [...before.filter((c) => c !== router && (c.kind === "choice" || c.kind === "multi" || c.kind === "yesno")), ...(firstRating < 0 ? [] : columns.slice(firstRating).filter((c) => c.kind === "choice" || c.kind === "multi" || c.kind === "yesno"))];

  // A block is named after the service most of its patients chose; blocks for the same service are combined.
  const byName = new Map<string, Section>();
  blocks.forEach((block, i) => {
    const counts = new Map<string, number>();
    responses.forEach((r) => {
      if (!block.some((c) => clean(r.cells[c.index]))) return;
      const v = router ? (r.cells[router.index] ?? "").trim() : "";
      if (v) counts.set(v, (counts.get(v) || 0) + 1);
    });
    const name = Array.from(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? (router ? `Not yet answered (${i + 1})` : `Section ${i + 1}`);
    const section = byName.get(name) ?? { name, columns: [], ratings: [], texts: [], recommend: [] };
    block.forEach((c) => {
      section.columns.push(c);
      if (c.kind === "rating") section.ratings.push(c);
      else if (c.kind === "recommend") section.recommend.push(c);
      else if (c.kind === "text") section.texts.push(c);
    });
    byName.set(name, section);
  });
  const recommendOutside = columns.filter((c) => c.kind === "recommend" && !blocks.flat().includes(c));
  const sections = Array.from(byName.values());
  if (recommendOutside.length && sections[0]) sections[0].recommend.push(...recommendOutside);
  return { columns, responses, visit, router, profile, sections, hidden: columns.filter((c) => c.kind === "identity") };
}

/** A rating answer as its scale point, or null when unanswered or N/A. */
export function pointOf(column: Column, raw: string | undefined): number | null {
  const v = clean(raw);
  if (!v) return null;
  const n = numberIn(v);
  if (n !== null) return n;
  for (const scale of WORD_SCALES) if (norm(v) in scale) return scale[norm(v)];
  return null;
}
/** 0 (worst) to 1 (best). Satisfied = the top two points of a 5-point scale; dissatisfied = the bottom two. */
export const scoreOf = (column: Column, point: number) => (point - (column.min ?? 1)) / ((column.max ?? 5) - (column.min ?? 1));
export const SATISFIED = 0.75, DISSATISFIED = 0.25;
export const splitMulti = (v: string) => v.split(", ").map((x) => x.trim().replace(/[,;]+$/, "").trim()).filter(Boolean);
const recommendOf = (v: string) => { const n = norm(v); return n === "yes" || n === "oo" ? "Yes" : n === "no" || n === "hindi" ? "No" : n ? "Maybe" : ""; };

export type Filters = { from: string; to: string; service: string };

export function analyzeFeedback(survey: Survey, f: Filters) {
  const { sections, router } = survey;
  const serviceOf = (r: Response) => (router ? (r.cells[router.index] ?? "").trim() : "") || sections.find((s) => s.columns.some((c) => clean(r.cells[c.index])))?.name || "";
  const inRange = (r: Response, from: string, to: string) => (!from || (r.visit !== null && r.visit >= from)) && (!to || (r.visit !== null && r.visit <= to));
  const pick = (from: string, to: string) => survey.responses.filter((r) => inRange(r, from, to) && (!f.service || serviceOf(r) === f.service));
  const rows = pick(f.from, f.to);

  const summarize = (list: Response[], only?: Section) => {
    const secs = only ? [only] : sections;
    const ratingCols = secs.flatMap((s) => s.ratings), recommendCols = secs.flatMap((s) => s.recommend), textCols = secs.flatMap((s) => s.texts);
    let answers = 0, satisfied = 0, very = 0, dissatisfied = 0, total = 0, na = 0, comments = 0;
    const rec = { Yes: 0, Maybe: 0, No: 0 };
    let unhappy = 0, responses = 0;
    list.forEach((r) => {
      let low = false, any = false;
      ratingCols.forEach((c) => {
        const raw = (r.cells[c.index] ?? "").trim();
        if (raw && isNA(raw)) { na += 1; any = true; return; }
        const p = pointOf(c, raw);
        if (p === null) return;
        any = true;
        const s = scoreOf(c, p);
        answers += 1; total += s;
        if (s >= SATISFIED) satisfied += 1;
        if (s === 1) very += 1;
        if (s <= DISSATISFIED) { dissatisfied += 1; low = true; }
      });
      recommendCols.forEach((c) => { const v = recommendOf(r.cells[c.index] ?? ""); if (v) { rec[v as keyof typeof rec] += 1; any = true; } });
      textCols.forEach((c) => { if (clean(r.cells[c.index])) { comments += 1; any = true; } });
      if (only ? any : true) responses += 1;
      if (low) unhappy += 1;
    });
    const recAnswers = rec.Yes + rec.Maybe + rec.No;
    return {
      responses, answers, na, comments, unhappy, dissatisfied,
      csat: answers ? satisfied / answers : null,
      verySatisfied: answers ? very / answers : null,
      /** The average answer on a 1–5 scale (Very Satisfied = 5). */
      average: answers ? 1 + (total / answers) * 4 : null,
      recommend: recAnswers ? rec.Yes / recAnswers : null, rec, recAnswers,
    };
  };

  const totals = summarize(rows);
  // The same length of time just before, to show the change.
  let previous: (ReturnType<typeof summarize> & { from: string; to: string }) | null = null;
  if (f.from && f.to) {
    const days = Math.round((Date.parse(f.to) - Date.parse(f.from)) / 86_400_000) + 1;
    const day = (t: number) => new Date(t).toISOString().slice(0, 10);
    let pFrom = day(Date.parse(f.from) - days * 86_400_000), pTo = day(Date.parse(f.from) - 86_400_000);
    // A whole calendar month is compared with the whole month before it.
    const [y, m, d] = f.from.split("-").map(Number);
    if (d === 1 && f.to === day(Date.UTC(y, m, 0))) { pFrom = day(Date.UTC(y, m - 2, 1)); pTo = day(Date.UTC(y, m - 1, 0)); }
    previous = { ...summarize(pick(pFrom, pTo)), from: pFrom, to: pTo };
  }

  const services = sections.map((section) => {
    const answered = rows.filter((r) => section.columns.some((c) => clean(r.cells[c.index]) || isNA(r.cells[c.index] ?? "") && (r.cells[c.index] ?? "").trim()));
    const s = summarize(answered, section);
    const questions = section.ratings.map((c) => {
      const counts: Record<number, number> = {};
      let na = 0, n = 0, sat = 0, sum = 0;
      answered.forEach((r) => {
        const raw = (r.cells[c.index] ?? "").trim();
        if (raw && isNA(raw)) { na += 1; return; }
        const p = pointOf(c, raw);
        if (p === null) return;
        counts[p] = (counts[p] || 0) + 1; n += 1; sum += p;
        if (scoreOf(c, p) >= SATISFIED) sat += 1;
      });
      return { column: c, counts, na, answers: n, csat: n ? sat / n : null, average: n ? 1 + ((sum / n - (c.min ?? 1)) / ((c.max ?? 5) - (c.min ?? 1))) * 4 : null };
    });
    return { section, ...s, questions };
  }).filter((x) => x.responses > 0).sort((a, b) => b.responses - a.responses);

  const tally = (c: Column) => {
    const m = new Map<string, number>();
    let answered = 0, multiple = 0;
    rows.forEach((r) => {
      const v = clean(r.cells[c.index]);
      if (!v) return;
      answered += 1;
      const parts = c.kind === "multi" ? splitMulti(v) : [c.kind === "yesno" ? (YES.has(norm(v)) ? "Yes" : "No") : v];
      if (parts.length > 1) multiple += 1;
      parts.forEach((x) => m.set(x, (m.get(x) || 0) + 1));
    });
    return { column: c, answered, multiple, items: Array.from(m, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value) };
  };
  const profile = [...(router ? [router] : []), ...survey.profile].map(tally).filter((t) => t.answered);

  // Low ratings (Dissatisfied or worse) and every comment, newest visit first.
  const lowOf = (r: Response) => sections.flatMap((s) => s.ratings.map((c) => ({ c, p: pointOf(c, r.cells[c.index]) })).filter((x) => x.p !== null && scoreOf(x.c, x.p) <= DISSATISFIED).map((x) => ({ question: x.c.text, answer: (r.cells[x.c.index] ?? "").trim() })));
  const newest = (a: Response, b: Response) => (b.visit ?? "").localeCompare(a.visit ?? "") || b.row - a.row;
  const comments = [...rows].sort(newest).flatMap((r) => sections.flatMap((s) => s.texts.map((c) => ({ text: clean(r.cells[c.index]), kind: /experience/i.test(c.header) ? "Previous experience" : /comment|suggest/i.test(c.header) ? "Comment / suggestion" : c.text, service: s.name, response: r, low: lowOf(r).length > 0 })))).filter((x) => x.text);
  const unhappy = [...rows].sort(newest).map((r) => ({ response: r, service: serviceOf(r), low: lowOf(r), comments: sections.flatMap((s) => s.texts.map((c) => clean(r.cells[c.index]))).filter(Boolean) })).filter((x) => x.low.length);

  // Trend by month, or by week within a short period.
  const dated = rows.filter((r) => r.visit).map((r) => r.visit!).sort();
  const spanDays = dated.length ? (Date.parse(dated.at(-1)!) - Date.parse(dated[0])) / 86_400_000 : 0;
  const byMonth = spanDays > 45;
  const bucketOf = (day: string) => {
    if (byMonth) return day.slice(0, 7);
    const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const buckets = new Map<string, Response[]>();
  rows.forEach((r) => { if (r.visit) { const k = bucketOf(r.visit); buckets.set(k, [...(buckets.get(k) || []), r]); } });
  const trend = Array.from(buckets, ([key, list]) => {
    const s = summarize(list);
    return { key, label: byMonth ? monthText(key) : dayText(key, { month: "short", day: "numeric" }), responses: list.length, satisfied: s.csat === null ? null : Math.round(s.csat * 1000) / 10, recommend: s.recommend === null ? null : Math.round(s.recommend * 1000) / 10, s };
  }).sort((a, b) => a.key.localeCompare(b.key));

  const allQuestions = services.flatMap((s) => s.questions.filter((q) => q.answers >= 3).map((q) => ({ ...q, service: s.section.name })));
  return { rows, totals, previous, services, profile, comments, unhappy, trend, byMonth, allQuestions, period: dated.length ? { from: dated[0], to: dated.at(-1)! } : null, undated: rows.filter((r) => !r.visit).length };
}
export type FeedbackSummary = ReturnType<typeof analyzeFeedback>;

/** "Interpretation & analysis": plain-language findings for the period. */
export function feedbackFindings(a: FeedbackSummary) {
  const out: { label: string; text: string; tone: "ok" | "watch" | "info" }[] = [];
  const t = a.totals;
  if (!t.responses) return out;
  out.push({ label: "Overall", tone: (t.csat ?? 0) >= 0.9 ? "ok" : "watch", text: `${pctText(t.csat, 1)} of ratings were Satisfied or Very Satisfied (${pctText(t.verySatisfied, 1)} Very Satisfied) across ${t.responses} response${t.responses === 1 ? "" : "s"}${t.recommend !== null ? `; ${pctText(t.recommend, 1)} would recommend THSC` : ""}.` });
  if (a.previous && a.previous.responses >= 5 && t.csat !== null && a.previous.csat !== null) {
    const d = (t.csat - a.previous.csat) * 100;
    out.push({ label: "Change", tone: d >= 0 ? "ok" : "watch", text: `Satisfaction is ${Math.abs(d) < 0.05 ? "unchanged" : `${d > 0 ? "up" : "down"} ${Math.abs(d).toFixed(1)} points`} from the previous period, ${dayText(a.previous.from)} – ${dayText(a.previous.to)} (${pctText(a.previous.csat, 1)}, ${a.previous.responses} responses).` });
  }
  const ranked = [...a.allQuestions].filter((q) => q.csat !== null).sort((x, y) => (x.csat! - y.csat!) || ((x.average ?? 0) - (y.average ?? 0)));
  const weakest = ranked.filter((q) => q.csat! < 1).slice(0, 3);
  if (weakest.length) out.push({ label: "Lowest rated", tone: "watch", text: weakest.map((q) => `${q.service}: "${q.column.text.replace(/^\d+\.\s*/, "")}" (${pctText(q.csat)} satisfied)`).join("; ") + "." });
  const services = a.services.filter((s) => s.answers >= 5 && s.csat !== null);
  if (services.length >= 2) {
    const best = services.reduce((x, y) => ((y.csat ?? 0) > (x.csat ?? 0) ? y : x)), worst = services.reduce((x, y) => ((y.csat ?? 1) < (x.csat ?? 1) ? y : x));
    if (best !== worst) out.push({ label: "Services", tone: "info", text: `Best rated: ${best.section.name} (${pctText(best.csat)} satisfied). Lowest: ${worst.section.name} (${pctText(worst.csat)}).` });
  }
  if (a.unhappy.length) out.push({ label: "Follow up", tone: "watch", text: `${a.unhappy.length} response${a.unhappy.length === 1 ? " has" : "s have"} a Dissatisfied rating or worse; see "Needs follow-up" below.` });
  if (a.comments.length) out.push({ label: "Comments", tone: "info", text: `${a.comments.length} comment${a.comments.length === 1 ? "" : "s"} or experience${a.comments.length === 1 ? "" : "s"} shared${a.comments.some((c) => c.low) ? `, ${a.comments.filter((c) => c.low).length} from patients who gave a low rating` : ""}.` });
  return out;
}

export const pctText = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`);
export const dayText = (day: string | null, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) => (day ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-PH", { ...options, timeZone: "UTC" }) : "—");
export const monthText = (key: string, long = false) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-PH", { month: long ? "long" : "short", year: long ? "numeric" : "2-digit", timeZone: "UTC" });

// ---------------------------------------------------------------------------------------------
// Patients' comments & experiences board (like the COMMENTS tab): every comment gets a type.

export type CommentType = "positive" | "negative" | "suggestion" | "experience";
export const COMMENT_TYPES: { id: CommentType; label: string; color: string }[] = [
  { id: "positive", label: "Positive", color: "#b6d7a8" },
  { id: "negative", label: "Negative", color: "#ea9999" },
  { id: "suggestion", label: "Suggestion", color: "#ffe599" },
  { id: "experience", label: "Experience", color: "#f9cb9c" },
];
// English and Tagalog words; the team can change any card's type, so these only make the first guess.
const SUGGESTION = /\b(suggest\w*|should|please|pls|sana|dapat|improve\w*|recommend (that|to)|add(ing)? more|more (parking|seats|staff|chairs|space)|give (more|detailed)|will be good|would be (good|better|nice)|lagyan|maglagay|paki\w*|remind (patients|them|us)|i-text|tawagan)\b/i;
const NEGATIVE = /(matagal|slow|\blate\b|wrong|\bmali\b|magulo|not in order|no response|unanswered|walang sumasagot|masungit|nakasimangot|kulang|\black\b|\bpoor\b|\brude\b|\bbad\b|difficult|mahirap|cancel|waiting time|\bdelay|bastos|disappoint|dissatisf|complain|reklamo|laging full|not attentive|hindi (maayos|sumasagot|nasagot))/i;
const POSITIVE = /(good|great|excellent|satisf|thank|salamat|prompt|clean|organized|accommodat|friendly|\bok\b|okay|\bmura\b|cheaper|accessible|accesible|expectation|grateful|keep it up|complete|helpful|approachable|fast|maayos|mabait|magaling|recommend(ed)? (thsc|it)|at ease|comfortable)/i;

/** The first guess for a comment's type, from its words and the question it answered. */
export function guessCommentType(text: string, isExperience: boolean): CommentType {
  if (/^the patient\b/i.test(text) || text.length > 220) return "experience";
  if (SUGGESTION.test(text)) return "suggestion";
  const bad = NEGATIVE.test(text), good = POSITIVE.test(text);
  if (isExperience) return text.length <= 60 && bad !== good ? (bad ? "negative" : "positive") : "experience";
  if (bad) return good && text.length > 80 ? "experience" : "negative";
  return good ? "positive" : "experience";
}
/** Identifies a comment across reloads (rows can move in the sheet): the survey, the visit date and the text. */
export function commentKey(source: string, visit: string | null, text: string) {
  let h = 5381;
  const s = text.trim().toLowerCase().replace(/\s+/g, " ");
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${source}|${visit ?? "nodate"}|${h.toString(36)}`;
}

// ---------------------------------------------------------------------------------------------
// "Interpretation & analysis" for one service in one month, compared with the month before.

type ServiceResult = FeedbackSummary["services"][number];
const short = (q: { column: Column }) => `"${q.column.text.replace(/^\d+\.\s*/, "").replace(/\?$/, "")}"`;
export function monthNote(month: string, cur: ServiceResult | undefined, prev: ServiceResult | undefined, prevMonth: string | null) {
  const name = monthText(month, true).split(" ")[0];
  if (!cur || !cur.answers) return cur?.responses ? `${name} had ${cur.responses} response${cur.responses === 1 ? "" : "s"}, all answered N/A.` : `No responses in ${name}.`;
  const count = (p: number) => cur.questions.reduce((n, q) => n + (q.counts[p] || 0), 0);
  const neutral = count(3), low = count(2) + count(1);
  const parts: string[] = [];
  if (!neutral && !low) parts.push(`${name} was highly positive: every rating was Very Satisfied or Satisfied (${pctText(cur.verySatisfied)} Very Satisfied).`);
  else if (low) {
    const where = cur.questions.filter((q) => (q.counts[2] || 0) + (q.counts[1] || 0)).map(short).slice(0, 2).join(" and ");
    parts.push(`${name} had ${low} Dissatisfied rating${low === 1 ? "" : "s"}, on ${where}; ${pctText(cur.csat)} of ratings were still Satisfied or better.`);
  } else {
    const where = [...cur.questions].sort((x, y) => (y.counts[3] || 0) - (x.counts[3] || 0)).filter((q) => q.counts[3]).slice(0, 2).map(short).join(" and ");
    parts.push(`${name} was mostly positive (${pctText(cur.csat)} satisfied), with ${neutral} Neutral rating${neutral === 1 ? "" : "s"}, mainly on ${where}.`);
  }
  if (prev && prev.answers && prevMonth) {
    const pName = monthText(prevMonth, true).split(" ")[0];
    const d = ((cur.verySatisfied ?? 0) - (prev.verySatisfied ?? 0)) * 100;
    const pLow = prev.questions.reduce((n, q) => n + (q.counts[2] || 0) + (q.counts[1] || 0) + (q.counts[3] || 0), 0);
    const shift = Math.abs(d) < 3 ? `Very Satisfied ratings held steady compared with ${pName} (${pctText(prev.verySatisfied)})` : d > 0 ? `Compared with ${pName}, Very Satisfied ratings rose from ${pctText(prev.verySatisfied)} to ${pctText(cur.verySatisfied)}` : `Compared with ${pName}, more ratings shifted from Very Satisfied to Satisfied (${pctText(prev.verySatisfied)} to ${pctText(cur.verySatisfied)} Very Satisfied)`;
    parts.push(`${shift}${pLow !== neutral + low ? `, and Neutral or lower ratings went from ${pLow} to ${neutral + low}` : ""}.`);
  } else if (prevMonth) parts.push(`There were no ratings for this service in ${monthText(prevMonth, true).split(" ")[0]} to compare with.`);
  const answered = cur.questions.filter((q) => q.answers);
  const best = answered.filter((q) => q.csat === 1 && (q.counts[5] || 0) === q.answers);
  const weakest = [...answered].sort((x, y) => (x.average ?? 5) - (y.average ?? 5))[0];
  if (best.length && best.length < answered.length) parts.push(`${best.length === 1 ? `${short(best[0])} was` : `${best.length} questions were`} rated Very Satisfied by everyone.`);
  if (weakest && (weakest.average ?? 5) < 4.8 && (neutral || low)) parts.push(`To watch: ${short(weakest)} (average ${weakest.average!.toFixed(1)} of 5).`);
  const naHeavy = cur.questions.filter((q) => q.na >= Math.max(2, (q.answers + q.na) / 2));
  if (naHeavy.length) parts.push(`${naHeavy.map(short).slice(0, 2).join(" and ")} ${naHeavy.length === 1 ? "was" : "were"} mostly N/A.`);
  if (cur.responses < 3) parts.push(`Only ${cur.responses} response${cur.responses === 1 ? "" : "s"}, so read this with caution.`);
  return parts.join(" ");
}
