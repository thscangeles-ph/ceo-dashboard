"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, Info, MessageSquareText, RefreshCw, Search, Sheet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RankedBars } from "@/components/charts";
import { PdfButton } from "@/components/pdf-button";
import { feedbackReport } from "@/lib/reports";
import type { FeedbackSheet, Filters } from "@/lib/feedback";
import { analyzeFeedback, buildSurvey, dayText, feedbackFindings, monthText, pctText } from "@/lib/feedback";

const axisTick = { fill: "var(--ink-soft)", fontSize: 11, fontFamily: "var(--font-mono-stack)" };
const tooltipStyle = { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12 };
// Rating points, best first: brand black and gold for satisfied, beige for neutral, muted reds for dissatisfied.
const POINT_COLOR: Record<number, string> = { 5: "var(--s1)", 4: "var(--s2)", 3: "var(--neutral)", 2: "#b4533c", 1: "#7f1d1d" };
const TONE_ICON = { ok: CheckCircle2, watch: Eye, info: Info };
const num = (v: number) => v.toLocaleString("en-PH");
const day = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const POLL_MS = 120_000;

/**
 * The Patient Feedback tab: survey results from the feedback form's Google Sheet (RAW DATA), live. The
 * period follows each patient's date of visit. Admin, ManCom, Doctors and Marketing can open it.
 */
export function FeedbackDashboard({ load }: { load: (fresh: boolean) => Promise<FeedbackSheet> }) {
  const [sheet, setSheet] = useState<FeedbackSheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preset, setPreset] = useState("all");
  const [filters, setFilters] = useState<Filters>({ from: "", to: "", service: "" });
  const [kind, setKind] = useState("all");
  const [onlyLow, setOnlyLow] = useState(false);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(40);

  const refresh = useCallback(async (fresh: boolean) => {
    setLoading(true);
    try { setSheet(await load(fresh)); setError(""); } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }, [load]);
  useEffect(() => {
    const first = setTimeout(() => void refresh(false), 0);
    // New responses show up while the tab is open.
    const poll = setInterval(() => { if (document.visibilityState === "visible") void refresh(false); }, POLL_MS);
    return () => { clearTimeout(first); clearInterval(poll); };
  }, [refresh]);

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
  const rangeText = filters.from || filters.to ? `${filters.from ? dayText(filters.from) : "first visit"} – ${filters.to ? dayText(filters.to) : "latest visit"}` : "all dates of visit";
  const t = a?.totals;
  const delta = a?.previous && a.previous.responses >= 5 && t?.csat != null && a.previous.csat !== null ? (t.csat - a.previous.csat) * 100 : null;

  const comments = (a?.comments || []).filter((c) => (kind === "all" || c.kind === kind) && (!onlyLow || c.low) && (!query.trim() || c.text.toLowerCase().includes(query.trim().toLowerCase())));
  const kinds = Array.from(new Set((a?.comments || []).map((c) => c.kind)));
  const pointsOf = (labels?: Record<number, string>) => [5, 4, 3, 2, 1].map((p) => ({ p, label: labels?.[p] ?? String(p) }));

  return (
    <>
      <header className="top">
        <div>
          <h1>Patient Feedback</h1>
          <p className="sub">Survey results from the THSC feedback form, live from its Google Sheet: satisfaction by service and question, who answered, and what patients said</p>
          <div className="crm-actions no-print">
            {a && survey && <PdfButton make={() => feedbackReport(a, survey, { findings, filters: [`Date of visit: ${rangeText}`, `Service: ${filters.service || "all services"}`].join(" · ") })} />}
            <button type="button" className="btn btn-outline" onClick={() => void refresh(true)} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : undefined} />{loading ? "Refreshing…" : "Refresh"}</button>
          </div>
        </div>
        <div className="period">
          Date of visit<br /><strong>{periodText}</strong>
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
                <option value="all">All dates of visit</option>
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
          <p className="click-hint no-print"><Sheet size={15} aria-hidden />Every response in the sheet&apos;s {sheet!.tab} tab, by date of visit; new responses appear within a few minutes. N/A answers are left out of the percentages.</p>

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
              <p className="section-note">By {a.byMonth ? "month" : "week"} of visit.</p>
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
            <p className="section-note">The share of all ratings each service received, from Very Satisfied to Very Dissatisfied (N/A left out). Click a service to see only its responses.</p>
            <div className="panel">
              <AnswerLegend points={pointsOf(a.services[0]?.questions[0]?.column.labels)} />
              {a.services.length > 1 && (
                <Likert total percent name="All services" counts={sumCounts(a.services.flatMap((x) => x.questions))} points={pointsOf(a.services[0]?.questions[0]?.column.labels)}
                  meta={`${pctText(t.csat)} satisfied · ${num(t.responses)} responses${t.recAnswers ? ` · ${pctText(t.recommend)} recommend` : ""}`} />
              )}
              {a.services.map((x) => (
                <Likert key={x.section.name} percent name={x.section.name} counts={sumCounts(x.questions)} points={pointsOf(x.questions[0]?.column.labels)} selected={filters.service === x.section.name}
                  meta={`${pctText(x.csat)} satisfied · ${num(x.responses)} response${x.responses === 1 ? "" : "s"}${x.recAnswers ? ` · ${pctText(x.recommend)} recommend` : ""}`}
                  onClick={() => setFilters((f) => ({ ...f, service: f.service === x.section.name ? "" : x.section.name }))} />
              ))}
              {!a.services.length && <p className="empty-note">No ratings in this period.</p>}
            </div>
          </section>

          <section>
            <h2>Ratings by question</h2>
            <p className="section-note">Every question of each service, like the CHARTS &amp; TABLE tab. Hover a bar for the number of patients; the lowest-rated question of each service is marked.</p>
            <AnswerLegend points={pointsOf(a.services[0]?.questions[0]?.column.labels)} />
            <div className="fb-service-grid">
              {a.services.map((x) => {
                const points = pointsOf(x.questions[0]?.column.labels);
                const lowest = Math.min(...x.questions.map((q) => q.csat ?? 1));
                return (
                  <div key={x.section.name} className="panel fb-service">
                    <div className="queue-head"><h3>{x.section.name}</h3><span className="fb-service-meta">{pctText(x.csat)} satisfied · {num(x.responses)} response{x.responses === 1 ? "" : "s"}</span></div>
                    {x.questions.map((q) => (
                      <Likert key={q.column.index} small name={q.column.text} counts={q.counts} points={points} low={q.csat !== null && q.csat < 1 && q.csat === lowest}
                        meta={q.answers ? `${pctText(q.csat)}${q.na ? ` · ${q.na} N/A` : ""}` : q.na ? `All ${q.na} N/A` : "No answers"} />
                    ))}
                  </div>
                );
              })}
            </div>
          </section>

          {a.profile.length > 0 && (
            <section>
              <h2>Who answered</h2>
              <p className="section-note">Demographics and how patients found and reached THSC, for the responses in this period.</p>
              <div className="grid-even fb-profile">
                {a.profile.filter((p) => p.column !== survey.router).map((p) => (
                  <div key={p.column.index} className="panel">
                    <h3>{p.column.text}</h3>
                    <RankedBars label={p.column.text} color="var(--s2)" format={(v) => `${num(v)} · ${pctText(v / p.answered)}`} items={p.items.slice(0, 10).map((i) => ({ name: i.name, value: i.value }))} />
                    {p.multiple > 0 && <p className="drill-meta">{num(p.multiple)} of {num(p.answered)} chose more than one, so the bars add up to more than {num(p.answered)}.</p>}
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
              <div><h2>Comments &amp; experiences</h2><p className="section-note">Everything patients wrote, newest visit first ({num(comments.length)} of {num(a.comments.length)}). N/A answers are left out.</p></div>
              <div className="filterbar no-print fb-comment-filters">
                <label>Show<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">All</option>{kinds.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
                <label className="trk-search">Search<span><Search size={15} aria-hidden /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Word in the comment" /></span></label>
                <label className="remember"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Only from low ratings</label>
              </div>
            </div>
            {comments.length ? (
              <ul className="fb-comments">
                {comments.slice(0, shown).map((c, i) => (
                  <li key={`${c.response.row}-${i}`} className={c.low ? "low" : undefined}>
                    <div className="fb-comment-meta"><MessageSquareText size={13} aria-hidden />{dayText(c.response.visit)} · {c.service} · {c.kind}{c.low && <span className="fb-tag">Low rating</span>}</div>
                    <p>{c.text}</p>
                  </li>
                ))}
              </ul>
            ) : <div className="panel"><p className="empty-note">No comments match.</p></div>}
            {comments.length > shown && <button type="button" className="btn btn-outline no-print" style={{ marginTop: 12 }} onClick={() => setShown((n) => n + 40)}>Show more</button>}
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
// Label colors that stay readable on each fill.
const POINT_TEXT: Record<number, string> = { 5: "var(--s1-text)", 4: "#ffffff", 3: "var(--neutral-text)", 2: "#ffffff", 1: "#ffffff" };

function AnswerLegend({ points }: { points: Point[] }) {
  return <div className="mix-legend fb-legend">{points.map((p) => <span key={p.p}><i style={{ background: POINT_COLOR[p.p] }} />{p.label}</span>)}</div>;
}

/** One service's or question's answers as a 100% bar, best answer first, with the count written in each part that has room. */
function Likert({ name, counts, points, meta, onClick, selected, low, small, total, percent }: {
  name: string; counts: Record<number, number>; points: Point[]; meta: string; onClick?: () => void; selected?: boolean; low?: boolean; small?: boolean; total?: boolean;
  /** Write shares instead of counts in the bar (a service's bar counts every rating, not patients). */
  percent?: boolean;
}) {
  const sum = points.reduce((n, l) => n + (counts[l.p] || 0), 0);
  const content = (
    <>
      <div className="fb-likert-head"><span className="fb-likert-name">{name}{low && <span className="fb-tag">Lowest</span>}</span><span className="fb-likert-meta">{meta}</span></div>
      <div className="fb-likert-bar" role="img" aria-label={`${name}: ${points.filter((l) => counts[l.p]).map((l) => `${l.label} ${counts[l.p]}`).join(", ") || "no ratings"}`}>
        {sum ? points.filter((l) => counts[l.p]).map((l) => {
          const share = counts[l.p] / sum;
          return <span key={l.p} title={`${l.label}: ${counts[l.p]} ${percent ? "ratings" : "patients"} (${Math.round(share * 100)}%)`} style={{ width: `${share * 100}%`, background: POINT_COLOR[l.p], color: POINT_TEXT[l.p] }}>{share >= (small ? 0.09 : 0.06) ? (percent ? `${Math.round(share * 100)}%` : counts[l.p]) : ""}</span>;
        }) : <em>No ratings</em>}
      </div>
    </>
  );
  const cls = `fb-likert${small ? " small" : ""}${total ? " total" : ""}${selected ? " selected" : ""}${low ? " low" : ""}`;
  return onClick
    ? <button type="button" className={`${cls} is-clickable`} onClick={onClick} aria-pressed={selected} title="Click to see only this service">{content}</button>
    : <div className={cls}>{content}</div>;
}
