"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, Info, RefreshCw, Search, Sheet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PdfButton } from "@/components/pdf-button";
import { feedbackReport } from "@/lib/reports";
import type { FeedbackSheet, Filters } from "@/lib/feedback";
import type { CommentType } from "@/lib/feedback";
import { analyzeFeedback, buildSurvey, COMMENT_TYPES, commentKey, dayText, feedbackFindings, guessCommentType, monthNote, monthText, pctText } from "@/lib/feedback";

const axisTick = { fill: "var(--ink-soft)", fontSize: 11, fontFamily: "var(--font-mono-stack)" };
const tooltipStyle = { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12 };
// Rating points, best first: Very Satisfied green, Satisfied light green, Neutral yellow, Dissatisfied red, Very Dissatisfied dark red.
const POINT_COLOR: Record<number, string> = { 5: "#2e7d32", 4: "#9ccc65", 3: "#f4c430", 2: "#d32f2f", 1: "#7f1d1d" };
const TONE_ICON = { ok: CheckCircle2, watch: Eye, info: Info };
const num = (v: number) => v.toLocaleString("en-PH");
const day = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const POLL_MS = 120_000;

/**
 * The Patient Feedback tab: survey results from the feedback form's Google Sheet (RAW DATA), live. The
 * period follows each patient's date of visit (or, in a sheet without one, the day they answered). Used for both
 * the in-person survey and the QR survey. Admin, ManCom, Doctors and Marketing can open it.
 */
export function FeedbackDashboard({ load, name, intro, source, loadTags, saveTag }: {
  load: (fresh: boolean) => Promise<FeedbackSheet>; name: string; intro: string;
  /** "inperson" or "qr": keeps each survey's comment types apart. */
  source: string;
  /** The comment types the team set (shared), and saving one; absent without accounts. */
  loadTags?: () => Promise<{ tags: Record<string, CommentType>; missing: boolean }>;
  saveTag?: (key: string, type: CommentType) => Promise<void>;
}) {
  const [sheet, setSheet] = useState<FeedbackSheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preset, setPreset] = useState("all");
  const [filters, setFilters] = useState<Filters>({ from: "", to: "", service: "" });
  const [query, setQuery] = useState("");
  const [month, setMonthState] = useState<string | null>(null);
  const setMonth = (m: string) => setMonthState(m);
  const [tags, setTags] = useState<Record<string, CommentType>>({});
  const [tagNote, setTagNote] = useState("");
  const [savingKey, setSavingKey] = useState("");
  const [hidden, setHidden] = useState<Set<CommentType>>(new Set());

  const refresh = useCallback(async (fresh: boolean) => {
    setLoading(true);
    try { setSheet(await load(fresh)); setError(""); } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }, [load]);
  const refreshTags = useCallback(async () => {
    if (!loadTags) return;
    try {
      const r = await loadTags(); setTags(r.tags);
      setTagNote(r.missing ? "Changing a comment's type needs the updated supabase/schema.sql: run it once in Supabase → SQL Editor." : "");
    } catch (e) { setTagNote((e as Error).message); }
  }, [loadTags]);
  useEffect(() => {
    const first = setTimeout(() => { void refresh(false); void refreshTags(); }, 0);
    // New responses, and comment types changed by others, show up while the tab is open.
    const poll = setInterval(() => { if (document.visibilityState === "visible") { void refresh(false); void refreshTags(); } }, POLL_MS);
    return () => { clearTimeout(first); clearInterval(poll); };
  }, [refresh, refreshTags]);

  const survey = useMemo(() => (sheet?.status === "ok" ? buildSurvey(sheet.headers, sheet.rows, sheet.firstRow) : null), [sheet]);
  const a = useMemo(() => (survey ? analyzeFeedback(survey, filters) : null), [survey, filters]);
  const findings = useMemo(() => (a ? feedbackFindings(a) : []), [a]);
  const months = useMemo(() => Array.from(new Set((survey?.responses || []).map((r) => r.visit?.slice(0, 7)).filter((m): m is string => Boolean(m)))).sort().reverse(), [survey]);
  const serviceCounts = useMemo(() => (survey ? analyzeFeedback(survey, { ...filters, service: "" }).services : []), [survey, filters]);

  const choosePreset = (value: string) => {
    setPreset(value);
    const today = Date.now();
    if (value === "all") setFilters((f) => ({ ...f, from: "", to: "" }));
    else if (value.startsWith("m:")) {
      const [y, m] = value.slice(2).split("-").map(Number);
      setFilters((f) => ({ ...f, from: `${value.slice(2)}-01`, to: day(new Date(y, m, 0).getTime()) }));
    } else if (value === "30d" || value === "90d") setFilters((f) => ({ ...f, from: day(today - (value === "30d" ? 29 : 89) * 86_400_000), to: day(today) }));
    else if (value === "year") setFilters((f) => ({ ...f, from: `${new Date().getFullYear()}-01-01`, to: day(today) }));
  };
  const setDate = (key: "from" | "to", value: string) => { setPreset("custom"); setFilters((f) => ({ ...f, [key]: value })); };

  const periodText = a?.period ? (a.period.from === a.period.to ? dayText(a.period.from) : `${dayText(a.period.from)} – ${dayText(a.period.to)}`) : sheet?.status === "ok" ? "No responses in this period" : "—";
  // The period is the date of visit; a sheet without one (a self-service form) uses the day the patient answered.
  const dateName = survey && !survey.visit ? "Date answered" : "Date of visit";
  const unit = survey && !survey.visit ? "answer" : "visit";
  const rangeText = filters.from || filters.to ? `${filters.from ? dayText(filters.from) : `first ${unit}`} – ${filters.to ? dayText(filters.to) : `latest ${unit}`}` : unit === "visit" ? "all dates of visit" : "all dates answered";
  const t = a?.totals;
  const delta = a?.previous && a.previous.responses >= 5 && t?.csat != null && a.previous.csat !== null ? (t.csat - a.previous.csat) * 100 : null;

  // Monthly results: the months in the chosen period, the latest first chosen; each compared with the month before.
  const monthKeys = useMemo(() => Array.from(new Set((a?.rows || []).map((r) => r.visit?.slice(0, 7)).filter((m): m is string => Boolean(m)))).sort(), [a]);
  const shownMonth = month && monthKeys.includes(month) ? month : monthKeys.at(-1) ?? null;
  const monthly = useMemo(() => {
    if (!survey || !shownMonth) return null;
    const range = (key: string) => { const [y, m] = key.split("-").map(Number); return { from: `${key}-01`, to: day(new Date(y, m, 0).getTime()) }; };
    const [y, m] = shownMonth.split("-").map(Number);
    const prevKey = day(new Date(y, m - 2, 1).getTime()).slice(0, 7);
    const cur = analyzeFeedback(survey, { ...range(shownMonth), service: filters.service });
    const prev = analyzeFeedback(survey, { ...range(prevKey), service: filters.service });
    const hasVeryLow = cur.services.some((x) => x.questions.some((q) => q.counts[1]));
    return { cur, prev: prev.totals.responses ? prev : null, prevKey: prev.totals.responses ? prevKey : null, hasVeryLow };
  }, [survey, shownMonth, filters.service]);

  // The comments board: one column per month, each comment with the team's type or the first guess.
  const board = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = (a?.comments || []).map((c) => {
      const key = commentKey(source, c.response.visit, c.text);
      return { ...c, key, type: tags[key] ?? guessCommentType(c.text, c.kind === "Previous experience") };
    }).filter((c) => !needle || c.text.toLowerCase().includes(needle) || c.service.toLowerCase().includes(needle));
    const counts = Object.fromEntries(COMMENT_TYPES.map((ct) => [ct.id, all.filter((c) => c.type === ct.id).length])) as Record<CommentType, number>;
    const shown = all.filter((c) => !hidden.has(c.type));
    const order = Object.fromEntries(COMMENT_TYPES.map((ct, i) => [ct.id, i]));
    const keys = Array.from(new Set(all.map((c) => c.response.visit?.slice(0, 7) || "undated"))).sort();
    const columns = keys.map((mk) => ({ month: mk, items: shown.filter((c) => (c.response.visit?.slice(0, 7) || "undated") === mk).sort((x, y) => order[x.type] - order[y.type] || (x.response.visit ?? "").localeCompare(y.response.visit ?? "")) }));
    return { columns, counts };
  }, [a, tags, query, hidden, source]);
  const changeType = async (key: string, type: CommentType) => {
    if (!saveTag) return;
    setSavingKey(key); setTagNote("");
    const before = tags[key];
    setTags((t) => ({ ...t, [key]: type }));
    try { await saveTag(key, type); } catch (e) { setTags((t) => { const n = { ...t }; if (before) n[key] = before; else delete n[key]; return n; }); setTagNote((e as Error).message); }
    setSavingKey("");
  };
  const pointsOf = (labels?: Record<number, string>) => [5, 4, 3, 2, 1].map((p) => ({ p, label: labels?.[p] ?? String(p) }));

  return (
    <>
      <header className="top">
        <div>
          <h1>Patient Feedback: {name}</h1>
          <p className="sub">{intro}</p>
          <div className="crm-actions no-print">
            {a && survey && <PdfButton make={() => feedbackReport(a, survey, { name, findings, service: filters.service, comments: board.columns.flatMap((col) => col.items).map((c) => ({ visit: c.response.visit, type: c.type, service: c.service, text: c.text })), filters: [`${dateName}: ${rangeText}`, `Service: ${filters.service || "all services"}`].join(" · ") })} />}
            <button type="button" className="btn btn-outline" onClick={() => { void refresh(true); void refreshTags(); }} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : undefined} />{loading ? "Refreshing…" : "Refresh"}</button>
          </div>
        </div>
        <div className="period">
          {dateName}<br /><strong>{periodText}</strong>
          <div className="filters-note">{sheet?.status === "ok" ? `Live from Google Sheets · updated ${new Date(sheet.fetchedAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}` : loading ? "Connecting to Google Sheets…" : "Not connected"}</div>
        </div>
      </header>

      {error && <div className="alert" role="alert"><AlertCircle size={18} /><div><strong>Could not load the responses.</strong> {error}</div></div>}
      {sheet && sheet.status !== "ok" && (
        <div className="panel empty-tab">
          <h3><Sheet size={16} />{sheet.status === "not-configured" ? "Connect the feedback sheet" : "The feedback sheet can't be read right now"}</h3>
          <p className="empty-note">{sheet.message}</p>
          {sheet.status === "not-configured" && (
            <ol className="fb-steps">
              <li>Google Cloud (same project as the YouTube key): enable the <strong>Google Sheets API</strong>.</li>
              <li>IAM &amp; Admin → Service Accounts → create one, then Keys → Add key → JSON.</li>
              <li>In the feedback Google Sheet: Share → add the service account&apos;s email as <strong>Viewer</strong>.</li>
              <li>Vercel → Settings → Environment Variables: <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> = the whole .json file, then redeploy.</li>
            </ol>
          )}
        </div>
      )}
      {!sheet && loading && <p className="empty-note" role="status" style={{ marginTop: 20 }}>Reading the feedback sheet…</p>}

      {a && survey && t && (
        <>
          <div className="filterbar no-print">
            <label>Period
              <select value={preset} onChange={(e) => choosePreset(e.target.value)}>
                <option value="all">{unit === "visit" ? "All dates of visit" : "All dates answered"}</option>
                {months.map((m) => <option key={m} value={`m:${m}`}>{monthText(m, true)}</option>)}
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="year">This year</option>
                {preset === "custom" && <option value="custom">Custom dates</option>}
              </select>
            </label>
            <label>From<input type="date" value={filters.from} onChange={(e) => setDate("from", e.target.value)} /></label>
            <label>To<input type="date" value={filters.to} onChange={(e) => setDate("to", e.target.value)} /></label>
            <label>Service
              <select value={filters.service} onChange={(e) => setFilters((f) => ({ ...f, service: e.target.value }))}>
                <option value="">All services</option>
                {serviceCounts.map((s) => <option key={s.section.name} value={s.section.name}>{s.section.name} · {s.responses}</option>)}
                {filters.service && !serviceCounts.some((s) => s.section.name === filters.service) && <option value={filters.service}>{filters.service} · 0</option>}
              </select>
            </label>
          </div>
          <p className="click-hint no-print"><Sheet size={15} aria-hidden />Every response in the sheet&apos;s {sheet!.tab} tab, by {dateName.toLowerCase()}; new responses appear within a few minutes. N/A answers are left out of the percentages.</p>

          <div className="kpis">
            <div className="kpi"><div className="label">Responses</div><div className="value">{num(t.responses)}</div><div className="note">{a.previous ? `${num(a.previous.responses)} in the previous period` : `${num(survey.responses.length)} in the sheet${a.undated ? ` · ${a.undated} without a visit date` : ""}`}</div></div>
            <div className="kpi accent"><div className="label">Satisfied</div><div className="value">{pctText(t.csat, 1)}</div><div className="note">{delta !== null ? `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} pts vs previous period` : "Very Satisfied or Satisfied ratings"}</div></div>
            <div className="kpi"><div className="label">Very satisfied</div><div className="value">{pctText(t.verySatisfied, 1)}</div><div className="note">Average {t.average === null ? "—" : t.average.toFixed(2)} of 5</div></div>
            <div className="kpi"><div className="label">Would recommend</div><div className="value">{pctText(t.recommend, 1)}</div><div className="note">{t.recAnswers ? `${t.rec.Yes} yes · ${t.rec.Maybe} maybe · ${t.rec.No} no` : "No answers yet"}</div></div>
            <div className="kpi"><div className="label">Needs follow-up</div><div className="value">{num(a.unhappy.length)}</div><div className="note">Responses with a Dissatisfied rating · {num(a.comments.length)} comments</div></div>
          </div>

          {findings.length > 0 && (
            <section>
              <h2>Interpretation &amp; analysis</h2>
              <p className="section-note">Worked out from the responses in this period and updated with every new response.</p>
              <div className="findings fb-findings">
                {findings.map((f) => { const Icon = TONE_ICON[f.tone]; return <div key={f.label} className={`finding ${f.tone}`}><div className="label"><Icon size={13} aria-hidden />{f.label}</div><p>{f.text}</p></div>; })}
              </div>
            </section>
          )}

          {a.trend.length > 0 && (
            <section>
              <h2>Over time</h2>
              <p className="section-note">{unit === "visit" ? `By ${a.byMonth ? "month" : "week"} of visit.` : `By ${a.byMonth ? "month" : "week"} the survey was answered.`}</p>
              <div className="grid-even">
                <div className="panel">
                  <h3>Responses</h3>
                  <div className="chart-box">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={a.trend} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                        <CartesianGrid vertical={false} stroke="var(--line)" />
                        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--line)" }} interval="preserveStartEnd" minTickGap={6} />
                        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                        <Tooltip cursor={{ fill: "var(--line)", opacity: 0.4 }} contentStyle={tooltipStyle} labelStyle={{ fontWeight: 600 }} formatter={(v) => [num(Number(v)), "Responses"]} labelFormatter={(l) => (a.byMonth ? l : `Week of ${l}`)} />
                        <Bar dataKey="responses" fill="var(--s2)" radius={[4, 4, 0, 0]} maxBarSize={48} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="panel">
                  <h3>Satisfied and would recommend (%)</h3>
                  <div className="chart-box">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={a.trend} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                        <CartesianGrid vertical={false} stroke="var(--line)" />
                        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--line)" }} interval="preserveStartEnd" minTickGap={6} />
                        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={36} domain={[(min: number) => Math.max(0, Math.floor((min - 5) / 5) * 5), 100]} tickFormatter={(v) => `${v}%`} />
                        <Tooltip contentStyle={tooltipStyle} labelStyle={{ fontWeight: 600 }} formatter={(v, name) => [v === null ? "—" : `${Number(v).toFixed(1)}%`, name]} labelFormatter={(l) => (a.byMonth ? l : `Week of ${l}`)} />
                        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "var(--ink-soft)" }} />
                        <Line type="monotone" dataKey="satisfied" name="Satisfied" stroke="var(--s1)" strokeWidth={2} dot={{ r: 3, fill: "var(--s1)", stroke: "var(--panel)", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
                        <Line type="monotone" dataKey="recommend" name="Would recommend" stroke="var(--s2)" strokeWidth={2} dot={{ r: 3, fill: "var(--s2)", stroke: "var(--panel)", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </section>
          )}

          <section>
            <h2>By service</h2>
            <p className="section-note">The share of each service&apos;s ratings, from Very Satisfied (bottom) to Very Dissatisfied (top); N/A is left out. Under each column: % satisfied and responses. Click a column to see only that service.</p>
            <div className="panel">
              <AnswerLegend points={pointsOf(a.services[0]?.questions[0]?.column.labels)} />
              {a.services.length ? (
                <ServiceColumns points={pointsOf(a.services[0]?.questions[0]?.column.labels)} selected={filters.service}
                  rows={[...(a.services.length > 1 ? [{ name: "All services", counts: sumCounts(a.services.flatMap((x) => x.questions)), sub: `${pctText(t.csat)} · ${num(t.responses)}` }] : []),
                    ...a.services.map((x) => ({ name: x.section.name, counts: sumCounts(x.questions), sub: `${pctText(x.csat)} · ${num(x.responses)}` }))]}
                  onSelect={(name) => setFilters((f) => ({ ...f, service: name === "All services" || f.service === name ? "" : name }))} />
              ) : <p className="empty-note">No ratings in this period.</p>}
            </div>
          </section>

          {monthKeys.length > 0 && (
            <section>
              <h2>Monthly results by service</h2>
              <p className="section-note">Like the CHARTS &amp; TABLE tab: for each month, every service&apos;s answer counts per question, the chart, and an interpretation compared with the month before. Choose a month:</p>
              <div className="chips no-print fb-month-chips" role="group" aria-label="Month">
                {monthKeys.map((m) => <button key={m} type="button" className={`chip-btn${m === shownMonth ? " on" : ""}`} aria-pressed={m === shownMonth} onClick={() => setMonth(m)}>{monthText(m, true)}</button>)}
              </div>
              {monthly && (
                <>
                  <div className="fb-month-banner">{monthText(shownMonth!, true).split(" ")[0].toUpperCase()} {monthText(shownMonth!, true).split(" ")[1]} = {num(monthly.cur.totals.responses)} TOTAL RESPONSE{monthly.cur.totals.responses === 1 ? "" : "S"}</div>
                  <AnswerLegend points={[...pointsOf(monthly.cur.services[0]?.questions[0]?.column.labels).filter((p) => p.p >= 2 || monthly.hasVeryLow)]} na />
                  {monthly.cur.services.map((x) => {
                    const points = pointsOf(x.questions[0]?.column.labels).filter((p) => p.p >= 2 || monthly.hasVeryLow);
                    return (
                      <div key={x.section.name} className="panel fb-svc">
                        <h3 className="fb-svc-title">{x.section.name.toUpperCase()} - {num(x.responses)}</h3>
                        <div className="fb-svc-grid">
                          <div className="table-scroll">
                            <table className="fb-counts">
                              <thead><tr><th>Question</th>{points.map((p) => <th key={p.p} className="num">{p.label}</th>)}<th className="num">N/A</th></tr></thead>
                              <tbody>
                                {x.questions.map((q) => (
                                  <tr key={q.column.index}>
                                    <td className="name">{q.column.text}</td>
                                    {points.map((p) => <td key={p.p} className={`num${p.p <= 2 && q.counts[p.p] ? " fb-bad" : ""}`}>{q.counts[p.p] || 0}</td>)}
                                    <td className="num muted">{q.na}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="fb-svc-chart">
                            <div className="fb-chart-title">{x.section.name.toUpperCase()} · {num(x.responses)} RESPONSE{x.responses === 1 ? "" : "S"} ({monthText(shownMonth!, true).split(" ")[0].toUpperCase()})</div>
                            <GroupedQuestions questions={x.questions} points={points} />
                          </div>
                          <div className="fb-interp"><strong>INTERPRETATION &amp; ANALYSIS:</strong><p>{monthNote(shownMonth!, x, monthly.prev?.services.find((p) => p.section.name === x.section.name), monthly.prevKey)}</p></div>
                        </div>
                      </div>
                    );
                  })}
                  {!monthly.cur.services.length && <div className="panel"><p className="empty-note">No ratings in this month.</p></div>}
                </>
              )}
            </section>
          )}

          {a.profile.length > 0 && (
            <section>
              <h2>Who answered</h2>
              <p className="section-note">Demographics and how patients found and reached THSC, for the responses in this period.</p>
              <div className="grid-even fb-profile">
                {a.profile.filter((p) => p.column !== survey.router).map((p) => (
                  <div key={p.column.index} className="panel">
                    <h3>{p.column.text}</h3>
                    <CountColumns items={p.items} total={p.answered} />
                    {p.multiple > 0 && <p className="drill-meta">{num(p.multiple)} of {num(p.answered)} chose more than one, so the columns add up to more than {num(p.answered)}.</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2>Needs follow-up</h2>
            <p className="section-note">Responses with a Dissatisfied (or worse) rating, newest visit first. The row number is the response&apos;s row in the sheet.</p>
            <div className="panel trk-panel">
              <div className="trk-scroll">
                <table className="fb-follow">
                  <thead><tr><th>Date of visit</th><th>Service</th><th>Low ratings</th><th>What they said</th><th className="num">Sheet row</th></tr></thead>
                  <tbody>
                    {a.unhappy.length ? a.unhappy.map((u) => (
                      <tr key={u.response.row}>
                        <td>{dayText(u.response.visit)}</td>
                        <td className="name">{u.service || "—"}</td>
                        <td className="name">{u.low.map((l) => <div key={l.question}><span className="fb-tag">{l.answer}</span> {l.question}</div>)}</td>
                        <td className="name fb-said">{u.comments.length ? u.comments.join(" · ") : <span className="muted">No comment</span>}</td>
                        <td className="num">{u.response.row}</td>
                      </tr>
                    )) : <tr><td colSpan={5} className="empty-note">No Dissatisfied ratings in this period.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section>
            <div className="section-head-row">
              <div><h2>Patients&apos; comments &amp; experiences</h2><p className="section-note">Everything patients wrote, by month, like the COMMENTS tab. Each card&apos;s type is a first guess from its words: change it with the menu on the card and it is saved for the whole team.</p></div>
              <div className="filterbar no-print fb-comment-filters">
                <label className="trk-search">Search<span><Search size={15} aria-hidden /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Word in the comment" /></span></label>
              </div>
            </div>
            <div className="fb-legend-board no-print" role="group" aria-label="Show comment types">
              <span>LEGEND</span>
              {COMMENT_TYPES.map((ct) => (
                <button key={ct.id} type="button" aria-pressed={!hidden.has(ct.id)} className={hidden.has(ct.id) ? "off" : undefined} style={{ background: ct.color }}
                  onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(ct.id)) n.delete(ct.id); else n.add(ct.id); return n; })}>
                  {ct.label.toUpperCase()} · {board.counts[ct.id]}
                </button>
              ))}
            </div>
            {tagNote && <p className="drill-meta" role="status">{tagNote}</p>}
            {board.columns.length ? (
              <div className="fb-board">
                {board.columns.map((col) => (
                  <div key={col.month} className="fb-board-col">
                    <h3>{monthText(col.month, true).split(" ")[0].toUpperCase()}<small>{monthText(col.month, true).split(" ")[1]} · {col.items.length}</small></h3>
                    {col.items.map((c) => (
                      <div key={c.key} className="fb-card" style={{ background: COMMENT_TYPES.find((ct) => ct.id === c.type)!.color }}>
                        <p>{c.text}</p>
                        <div className="fb-card-meta">
                          <span>{c.service} · {dayText(c.response.visit, { month: "short", day: "numeric" })}{c.low ? " · low rating" : ""}</span>
                          <select aria-label="Comment type" value={c.type} disabled={!saveTag || savingKey === c.key} onChange={(e) => void changeType(c.key, e.target.value as CommentType)}>
                            {COMMENT_TYPES.map((ct) => <option key={ct.id} value={ct.id}>{ct.label}</option>)}
                          </select>
                        </div>
                      </div>
                    ))}
                    {!col.items.length && <p className="empty-note">No comments.</p>}
                  </div>
                ))}
              </div>
            ) : <div className="panel"><p className="empty-note">No comments match.</p></div>}
          </section>

          <footer className="source">
            Live from the Google Sheet &ldquo;{sheet!.title}&rdquo;, tab {sheet!.tab}, read every 2 minutes while this tab is open. Period = {survey.visit ? <>&ldquo;{survey.visit.header}&rdquo;</> : "the form's timestamp"}; service = {survey.router ? <>&ldquo;{survey.router.text}&rdquo;</> : "each block of questions"}; {survey.sections.reduce((n, s) => n + s.ratings.length, 0)} rating questions in {survey.sections.length} service blocks. Satisfied = Very Satisfied or Satisfied; N/A answers are not counted.
            {survey.hidden.length > 0 && <> Personal details ({survey.hidden.map((c) => c.text).join(", ")}) are never shown.</>}
          </footer>
        </>
      )}
    </>
  );
}

type Point = { p: number; label: string };
const sumCounts = (questions: { counts: Record<number, number> }[]) => {
  const out: Record<number, number> = {};
  questions.forEach((q) => Object.entries(q.counts).forEach(([p, n]) => { out[Number(p)] = (out[Number(p)] || 0) + n; }));
  return out;
};

function AnswerLegend({ points, na }: { points: Point[]; na?: boolean }) {
  return <div className="mix-legend fb-legend">{points.map((p) => <span key={p.p}><i style={{ background: POINT_COLOR[p.p] }} />{p.label}</span>)}{na && <span><i style={{ background: NA_COLOR }} />N/A</span>}</div>;
}

/** Splits a category name into short lines for the axis under a column. */
function wrap(text: string, max: number, lines = 3) {
  const out: string[] = [];
  let line = "";
  text.split(/\s+/).forEach((word) => {
    if ((line ? `${line} ${word}` : word).length > max && line) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  });
  if (line) out.push(line);
  return out.length > lines ? [...out.slice(0, lines - 1), `${out.slice(lines - 1).join(" ").slice(0, max - 1)}…`] : out;
}
/** An axis label under each column: the name on up to three lines, and an optional bold line below it. */
function columnTick(max: number, subOf?: (name: string) => string | undefined, selected?: string) {
  return function Tick({ x, y, payload }: { x?: number | string; y?: number | string; payload?: { value?: string } }) {
    const name = String(payload?.value ?? ""), sub = subOf?.(name), lines = wrap(name, max);
    return (
      <g transform={`translate(${Number(x)},${Number(y)})`}>
        <text textAnchor="middle" fill={name === selected ? "var(--ink)" : "var(--ink-soft)"} fontSize={11} fontWeight={name === selected ? 700 : 400}>
          {lines.map((l, i) => <tspan key={i} x={0} dy={i ? 13 : 12}>{l}</tspan>)}
          {sub && <tspan x={0} dy={15} fill="var(--ink)" fontWeight={700} fontFamily="var(--font-mono-stack)">{sub}</tspan>}
        </text>
      </g>
    );
  };
}
type TipItem = { dataKey?: unknown; value?: unknown; payload?: Record<string, unknown> };
/** Tooltip listing every answer, best first, with patients (or ratings) and the share. */
function AnswerTip({ active, payload, points, title, unit }: { active?: boolean; payload?: TipItem[]; points: Point[]; title: (row: Record<string, unknown>) => string; unit: string }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const counts = points.map((p) => ({ ...p, n: Number(row[`c${p.p}`] || 0) }));
  const sum = counts.reduce((s, c) => s + c.n, 0);
  return (
    <div className="fb-tip">
      <strong>{title(row)}</strong>
      {counts.map((c) => <div key={c.p}><i style={{ background: POINT_COLOR[c.p] }} />{c.label}<b>{c.n} {unit} · {sum ? Math.round((c.n / sum) * 100) : 0}%</b></div>)}
      {Number(row.na) > 0 && <div className="muted">N/A<b>{String(row.na)}</b></div>}
    </div>
  );
}
type ChartState = { activeTooltipIndex?: number | string | null; activeLabel?: string | number } | null | undefined;

/** Services as 100% stacked columns, Very Satisfied at the bottom. */
function ServiceColumns({ rows, points, selected, onSelect }: { rows: { name: string; counts: Record<number, number>; sub: string }[]; points: Point[]; selected: string; onSelect: (name: string) => void }) {
  const data = rows.map((r) => {
    const sum = points.reduce((s, p) => s + (r.counts[p.p] || 0), 0) || 1;
    return { name: r.name, sub: r.sub, ...Object.fromEntries(points.flatMap((p) => [[`p${p.p}`, ((r.counts[p.p] || 0) / sum) * 100], [`c${p.p}`, r.counts[p.p] || 0]])) };
  });
  const subs = new Map(rows.map((r) => [r.name, r.sub]));
  return (
    <div className="fb-scroll">
      <div className="chart-box fb-columns" style={{ minWidth: rows.length * 92, height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%"
            onClick={(state: ChartState) => { const i = Number(state?.activeTooltipIndex); if (Number.isInteger(i) && data[i]) onSelect(data[i].name); }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="name" interval={0} height={74} tickLine={false} axisLine={{ stroke: "var(--line)" }} tick={columnTick(13, (n) => subs.get(n), selected)} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} />
            <Tooltip cursor={{ fill: "var(--line)", opacity: 0.35 }} content={<AnswerTip points={points} unit="ratings" title={(r) => `${r.name} · ${r.sub} responses`} />} />
            {[...points].map((p, i, list) => <Bar key={p.p} dataKey={`p${p.p}`} stackId="a" fill={POINT_COLOR[p.p]} isAnimationActive={false} cursor="pointer" radius={i === list.length - 1 ? [3, 3, 0, 0] : 0} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const NA_COLOR = "#7f7f7f";
/** One service's questions in one month as grouped columns (one per answer), like the charts in the CHARTS & TABLE tab. */
function GroupedQuestions({ questions, points }: { questions: { column: { text: string }; counts: Record<number, number>; na: number }[]; points: Point[] }) {
  const data = questions.map((q) => ({ label: q.column.text.length > 16 ? `${q.column.text.slice(0, 15)}…` : q.column.text, text: q.column.text, na: q.na, NA: q.na, ...Object.fromEntries(points.map((p) => [`c${p.p}`, q.counts[p.p] || 0])) }));
  return (
    <div className="chart-box" style={{ height: 300 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 24 }} barCategoryGap="16%" barGap={1}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" interval={0} angle={-35} textAnchor="end" height={78} tick={{ ...axisTick, fontFamily: "var(--font-sans-stack)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
          <Tooltip cursor={{ fill: "var(--line)", opacity: 0.35 }} wrapperStyle={{ maxWidth: 320, zIndex: 5 }} content={<AnswerTip points={points} unit="patients" title={(r) => String(r.text)} />} />
          {points.map((p) => <Bar key={p.p} dataKey={`c${p.p}`} fill={POINT_COLOR[p.p]} isAnimationActive={false} maxBarSize={14} radius={[2, 2, 0, 0]} />)}
          <Bar dataKey="NA" fill={NA_COLOR} isAnimationActive={false} maxBarSize={14} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Plain columns for a choice question (gender, age …), each labelled with its count. Ranges such as ages keep their
 * natural order; beyond the eight biggest answers the rest are combined as "Other". */
function CountColumns({ items: all, total }: { items: { name: string; value: number }[]; total: number }) {
  const ranges = all.every((i) => /^\d/.test(i.name));
  const sorted = ranges ? [...all].sort((x, y) => parseFloat(x.name) - parseFloat(y.name)) : all;
  const items = sorted.length > 8 ? [...sorted.slice(0, 7), { name: `Other (${sorted.length - 7} kinds)`, value: sorted.slice(7).reduce((n, i) => n + i.value, 0) }] : sorted;
  return (
    <div className="fb-scroll">
      <div className="chart-box" style={{ minWidth: items.length * 64, height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={items} margin={{ top: 20, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="name" interval={0} height={60} tickLine={false} axisLine={{ stroke: "var(--line)" }} tick={columnTick(items.length > 4 ? 10 : 16)} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
            <Tooltip cursor={{ fill: "var(--line)", opacity: 0.35 }} contentStyle={tooltipStyle} labelStyle={{ fontWeight: 600 }} formatter={(v) => [`${num(Number(v))} (${pctText(Number(v) / total)})`, "Patients"]} />
            <Bar dataKey="value" fill="var(--s2)" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false} label={{ position: "top", fill: "var(--ink)", fontSize: 11, fontFamily: "var(--font-mono-stack)" }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
