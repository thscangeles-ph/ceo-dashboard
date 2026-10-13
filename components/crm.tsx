"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Eye, ListChecks, Upload } from "lucide-react";
import { CountChart, MixBar, RankedBars, TrendChart } from "@/components/charts";
import { clickable, useDrill } from "@/components/drill";
import { count, longDate, pct, peso, sourceGroup } from "@/lib/analyze";
import type { CrmFilters, DueStatus, GroupStat } from "@/lib/crm";
import { analyzeCrm, applyCrmFilters, crmFindings, DEFAULT_CRM_FILTERS, DUE_LABEL, inquiryTopic, stateOf } from "@/lib/crm";
import { leadState } from "@/lib/lead";
import type { InquiryRow } from "@/lib/parse";

const TONE_ICON = { risk: AlertTriangle, watch: Eye, ok: CheckCircle2 };
const fmt = (d: Date | null | undefined) => (d ? longDate(d) : "—");

/** Inquiries / booked / served / revenue per group, each row clickable. */
function StatTable({ rows, name, onSelect, revenue = true, show = true }: { rows: GroupStat[]; name: string; onSelect: (row: GroupStat) => void; revenue?: boolean; show?: boolean }) {
  const max = Math.max(...rows.map((r) => r.bookingRate), 0.01);
  return (
    <div className="table-scroll">
      <table>
        <tbody>
          <tr><th>{name}</th><th className="num">Inquiries</th><th className="num">Booked</th><th>Booking %</th>{show && <th className="num">Show %</th>}<th className="num">Served</th>{revenue && <th className="num">Revenue</th>}{revenue && <th className="num">Per inquiry</th>}</tr>
          {rows.map((r) => (
            <tr key={r.name} className="is-clickable" {...clickable(() => onSelect(r), `${r.name}: details`)}>
              <td className="name">{r.name}</td><td className="num">{count(r.inquiries)}</td><td className="num">{count(r.booked)}</td>
              <td><div className="bar-cell"><span>{pct(r.bookingRate, 0)}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${(r.bookingRate / max) * 100}%`, background: "var(--s2)" }} /></div></div></td>
              {show && <td className="num">{r.served + r.noShow ? pct(r.showRate, 0) : "—"}</td>}
              <td className="num">{count(r.served)}</td>
              {revenue && <td className="num">{peso(r.revenue)}</td>}
              {revenue && <td className="num">{peso(r.revenue / r.inquiries)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionHead({ n, title, doctor, children }: { n: number; title: string; doctor: string; children?: React.ReactNode }) {
  return (
    <>
      <h2><span className="crm-n">{n}</span>{title}</h2>
      <p className="section-note"><strong>Goal:</strong> {doctor}{children ? <> {children}</> : null}</p>
    </>
  );
}

const DUE_ORDER: DueStatus[] = ["overdue", "today", "upcoming", "unscheduled"];

/**
 * Read-only analysis of the Inquiry Tracker: inquiries are added and updated there (`onOpenTracker`), never here.
 * `deidentified`: Marketing accounts get names replaced by codes and no contact numbers, so call lists are hidden.
 */
export function CrmDashboard({ rows, deidentified = false, onOpenTracker, onUploadTracker }: { rows: InquiryRow[]; deidentified?: boolean; onOpenTracker?: (search?: string) => void; onUploadTracker?: () => void }) {
  const drill = useDrill();
  const [filters, setFilters] = useState<CrmFilters>(DEFAULT_CRM_FILTERS);
  const [recallMonths, setRecallMonths] = useState(3);
  const [dueFilter, setDueFilter] = useState<DueStatus | "all">("all");
  const today = useMemo(() => new Date(), []);
  const filtered = useMemo(() => applyCrmFilters(rows, filters), [rows, filters]);
  const c = useMemo(() => analyzeCrm(filtered, today), [filtered, today]);
  const findings = useMemo(() => crmFindings(c), [c]);
  const recall = useMemo(() => c.recall(recallMonths), [c, recallMonths]);
  const branches = useMemo(() => Array.from(new Set(rows.map((r) => r.branch))).sort(), [rows]);
  const channels = useMemo(() => Array.from(new Set(rows.map((r) => r.channel))).sort(), [rows]);
  const allDates = useMemo(() => rows.map((r) => r.date?.getTime()).filter((t): t is number => typeof t === "number"), [rows]);
  const minDate = allDates.length ? new Date(Math.min(...allDates)) : null, maxDate = allDates.length ? new Date(Math.max(...allDates)) : null;
  const toInput = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "");

  const open = (title: string, list: InquiryRow[], subtitle?: string) => drill({ kind: "inquiries", title, subtitle, rows: list });
  const set = <K extends keyof CrmFilters>(key: K, value: CrmFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const t = c.total;
  const queue = dueFilter === "all" ? c.queue : c.queue.filter((q) => q.status === dueFilter);
  const newRow = c.byPatient.find((x) => x.name === "New"), retRow = c.byPatient.find((x) => x.name === "Returning");
  const referralRows = filtered.filter((r) => /REFER|DOCTOR|\bDR\b/i.test(r.channel) || r.referredBy);
  const missing = [
    !c.columns.respondedFlag && ["Responded (YES/NO)", "whether staff replied to each inquiry, especially price questions (Inquiry management). The Inquiry Tracker export already has it"],
    !c.columns.staff && ["Staff / Handled By", "who handled each inquiry, for staff performance (Concierge monitoring)"],
    !c.columns.responded && ["Date & Time Responded", "when staff first replied, for response times (Inquiry management, Concierge monitoring)"],
    !c.columns.referredBy && ["Referred By", "the referring physician, clinic or corporate partner (Referral management)"],
    !c.columns.campaign && ["Campaign", "which ad or promo the patient saw (Marketing analysis)"],
    !c.columns.appointment && ["Appointment Date", "the scheduled procedure date, to check reminders go out the day before and to time recalls"],
  ].filter((x): x is [string, string] => Boolean(x));

  return (
    <>
      <header className="top">
        <div>
          <h1>CRM Dashboard</h1>
          <p className="sub">Inquiries, bookings, follow-ups and referrals, built from the Inquiry Tracker</p>
          {onOpenTracker && (
            <div className="crm-actions no-print">
              <button type="button" className="btn btn-outline" onClick={() => onOpenTracker()}><ListChecks size={16} />Open the Inquiry Tracker</button>
              {onUploadTracker && <button type="button" className="btn btn-outline" onClick={onUploadTracker}><Upload size={16} />Upload tracker file</button>}
              <span className="hint">Add and update inquiries there; this dashboard follows.</span>
            </div>
          )}
        </div>
        <div className="period">
          Inquiries logged<br /><strong>{c.period ? `${longDate(c.period.from)} – ${longDate(c.period.to)}` : "—"}</strong>
          <div className="filters-note">Follow-up status as of {longDate(today)}</div>
        </div>
      </header>

      <div className="filterbar no-print">
        <label>Branch<select value={filters.branch} onChange={(e) => set("branch", e.target.value)}><option value="all">All branches</option>{branches.map((b) => <option key={b}>{b}</option>)}</select></label>
        {c.columns.patientStatus && <label>Patient<select value={filters.patient} onChange={(e) => set("patient", e.target.value as CrmFilters["patient"])}><option value="all">New and returning</option><option value="New">New</option><option value="Returning">Returning</option></select></label>}
        <label>Channel / source<select value={filters.channel} onChange={(e) => set("channel", e.target.value)}><option value="all">All channels</option>{channels.map((ch) => <option key={ch}>{ch}</option>)}</select></label>
        <label>From<input type="date" value={filters.from} min={toInput(minDate)} max={toInput(maxDate)} onChange={(e) => set("from", e.target.value)} /></label>
        <label>To<input type="date" value={filters.to} min={toInput(minDate)} max={toInput(maxDate)} onChange={(e) => set("to", e.target.value)} /></label>
      </div>

      {!t.inquiries ? <div className="alert"><div>No inquiries match these filters.</div></div> : (
        <>
          {/* 8. Business analytics headline */}
          <div className="kpis">
            <div className="kpi is-clickable" {...clickable(() => open("All inquiries", filtered), "Inquiries: details")}><div className="label">Inquiries</div><div className="value">{count(t.inquiries)}</div><div className="note">{newRow && retRow ? `${count(newRow.inquiries)} new · ${count(retRow.inquiries)} returning` : `${count(c.people)} people`}</div></div>
            <div className="kpi is-clickable" {...clickable(() => open("Booked", filtered.filter((r) => r.booked)), "Booking conversion: details")}><div className="label">Inquiry → booking</div><div className="value">{pct(c.bookingRate, 0)}</div><div className="note">{count(t.booked)} of {count(t.inquiries)} booked</div></div>
            <div className="kpi is-clickable" {...clickable(() => open("Served and no-shows", filtered.filter((r) => r.served || r.noShow)), "Show rate: details")}><div className="label">Show rate</div><div className="value">{pct(c.showRate, 0)}</div><div className="note">{count(t.served)} served · {count(t.noShow)} no-show</div></div>
            <div className="kpi is-clickable" {...clickable(() => open("Served", filtered.filter((r) => r.served)), "Revenue: details")}><div className="label">Revenue from inquiries</div><div className="value">{peso(t.revenue)}</div><div className="note">{peso(t.inquiries ? t.revenue / t.inquiries : 0)} per inquiry</div></div>
            <div className="kpi is-clickable" {...clickable(() => open("Follow-up queue", c.queue.map((q) => q.row)), "Follow-ups: details")}><div className="label">Follow-ups pending</div><div className="value">{count(c.queue.length)}</div><div className="note">{count(c.dueCounts.overdue)} overdue · {count(c.dueCounts.unscheduled)} no date</div></div>
          </div>

          <section className="brief">
            <span className="tag">CRM briefing</span>
            <h2>Where every inquiry ended up</h2>
            <div className="panel">
              <h3>Outcome of {count(t.inquiries)} inquiries</h3>
              <MixBar label="Inquiry outcomes" unit="count" onSelect={(key) => { const s = c.states.find((x) => x.key === key); if (s) open(s.label, s.rows); }} parts={c.states.map((s) => ({ key: s.key, label: s.label, color: s.color, value: s.rows.length, note: pct(s.rows.length / t.inquiries, 0) }))} />
            </div>
            {findings.length > 0 && (
              <div className="findings">
                {findings.map((f) => {
                  const Icon = TONE_ICON[f.tone];
                  return (
                    <div key={f.label} className={`finding ${f.tone}${f.drill ? " is-clickable" : ""}`} {...(f.drill ? clickable(() => drill(f.drill!()), `${f.label}: details`) : {})}>
                      <div className="label"><Icon size={13} aria-hidden />{f.label}</div>
                      <div className="value">{f.value}</div>
                      <p>{f.text}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <SectionHead n={1} title="Inquiry management" doctor="track every patient inquiry and whether staff responded.">
              {count(c.responded)} of {count(t.inquiries)} inquiries ({pct(c.responded / t.inquiries, 0)}) were responded to{c.columns.respondedFlag ? "" : " (judged from what was recorded, until the Responded column is filled in)"}.
              {" "}{count(c.documented)} ({pct(c.documented / t.inquiries, 0)}) have a recorded next step: a booking, a follow-up date, a reminder or an action.
            </SectionHead>
            <div>
              <div className="panel">
                <h3>Inquiries, bookings and served per week</h3>
                <TrendChart data={c.weeks} series={[{ key: "inquiries", label: "Inquiries", color: "var(--s1)" }, { key: "booked", label: "Booked", color: "var(--s2)" }, { key: "served", label: "Served", color: "var(--s4)" }]}
                  onSelect={(i) => { const w = c.weeks[i]; if (w) { const end = new Date(w.start); end.setDate(end.getDate() + 7); open(`Week of ${w.label}`, filtered.filter((r) => r.date && r.date >= w.start && r.date < end)); } }} />
              </div>
              <div className="panel" style={{ marginTop: 18 }}>
                <h3>What patients ask about</h3>
                <StatTable rows={c.byTopic} name="Question" revenue={false} show={false} onSelect={(r) => open(`Asked about: ${r.name}`, filtered.filter((x) => inquiryTopic(x) === r.name))} />
              </div>
            </div>
            {(c.notResponded.length > 0 || c.undocumented.length > 0 || c.openNoDate.length > 0) && (
              <div className="alert" style={{ marginTop: 14 }}><AlertTriangle size={18} /><div>
                {c.notResponded.length > 0 && <><button type="button" className="link-btn" onClick={() => open("Inquiries not responded to", c.notResponded)}>{count(c.notResponded.length)} inquiries</button> have no reply yet{c.priceUnanswered.length ? <>, including <button type="button" className="link-btn" onClick={() => open("Price questions not answered", c.priceUnanswered)}>{count(c.priceUnanswered.length)} price questions</button></> : null}. </>}
                {c.undocumented.length > 0 && <><button type="button" className="link-btn" onClick={() => open("Inquiries without a next step", c.undocumented)}>{count(c.undocumented.length)} inquiries</button> have no booking, follow-up date, reminder or action recorded. </>}
                {c.openNoDate.length > 0 && <><button type="button" className="link-btn" onClick={() => open("Open leads without a follow-up date", c.openNoDate)}>{count(c.openNoDate.length)} open leads</button> have no follow-up date.</>}
              </div></div>
            )}
          </section>

          <section>
            <SectionHead n={2} title="Appointment management" doctor="monitor bookings, cancellations and no-shows.">
              Bookings were made {c.leadTime.avg.toFixed(1)} days after the inquiry on average; {count(c.leadTime.sameDay)} were booked the same day.
            </SectionHead>
            <div className="grid-2">
              <div className="panel">
                <h3>Bookings by outcome</h3>
                <RankedBars label="Bookings by outcome" color="var(--s1)" format={(v) => `${count(v)} · ${pct(v / Math.max(t.booked, 1), 0)}`}
                  items={(["served", "booked", "noShow", "cancelled"] as const).map((k) => ({ name: stateOf(k).label, value: filtered.filter((r) => leadState(r) === k).length }))}
                  onSelect={(name) => { const s = c.states.find((x) => x.label === name); open(name, s ? s.rows : []); }} />
                <p className="empty-note" style={{ marginTop: 12 }}>A cancellation is counted when the action column says &ldquo;cancelled&rdquo;.</p>
              </div>
              <div className="panel">
                <h3>No-shows by procedure</h3>
                {t.noShow ? <RankedBars label="No-shows by procedure" color="var(--s3)" format={(v) => `${count(v)} no-show${v === 1 ? "" : "s"}`}
                  items={c.byProcedure.filter((p) => p.noShow).sort((a, b) => b.noShow - a.noShow).slice(0, 8).map((p) => ({ name: p.name, value: p.noShow, note: `${pct(p.noShow / Math.max(p.booked, 1), 0)} of bookings` }))}
                  onSelect={(name) => open(`No-shows: ${name}`, filtered.filter((r) => r.noShow && r.procedure === name))} /> : <p className="empty-note">No no-shows recorded.</p>}
              </div>
            </div>
          </section>

          <section>
            <SectionHead n={3} title="Follow-up reminders" doctor="remind patients of scheduled consultations or repeat tests when appropriate.">
              {count(c.reminders.sent)} of {count(c.reminders.booked)} booked patients have a reminder recorded{c.reminders.methods.length ? ` (${c.reminders.methods.map((m) => `${m.name}: ${count(m.inquiries)}`).join(", ")})` : ""}.
              {c.columns.appointment ? ` ${count(c.reminders.onTime)} went out on or before the appointment date, ${count(c.reminders.late.length)} after it.` : ""}
            </SectionHead>
            <div className="panel">
              <div className="queue-head">
                <h3>Follow-up queue: open leads and no-shows to reschedule{onOpenTracker ? <small className="muted"> · click a patient to update them in the Inquiry Tracker</small> : null}</h3>
                <div className="chips" role="group" aria-label="Filter follow-ups">
                  <button type="button" className={`chip-btn${dueFilter === "all" ? " on" : ""}`} onClick={() => setDueFilter("all")}>All {count(c.queue.length)}</button>
                  {DUE_ORDER.filter((s) => c.dueCounts[s]).map((s) => <button key={s} type="button" className={`chip-btn ${s}${dueFilter === s ? " on" : ""}`} onClick={() => setDueFilter(s)}>{DUE_LABEL[s]} {count(c.dueCounts[s])}</button>)}
                </div>
              </div>
              {deidentified ? <p className="empty-note">Patient names and numbers are hidden for Marketing accounts. The concierge team works this list.</p> : queue.length ? (
                <div className="table-scroll queue">
                  <table>
                    <tbody>
                      <tr><th>Follow up by</th><th>Patient</th><th>Contact</th><th>Procedure</th><th>Channel</th><th>Branch</th><th>Status</th><th>Next step</th>{onOpenTracker && <th></th>}</tr>
                      {queue.slice(0, 60).map((q) => (
                        <tr key={q.row.rowKey} className="is-clickable" {...clickable(() => (onOpenTracker ? onOpenTracker(q.row.patient) : open(q.row.patient || "Inquiry", [q.row])), `${q.row.patient}: open in the Inquiry Tracker`)}>
                          <td><span className={`due ${q.status}`}>{q.due ? fmt(q.due) : DUE_LABEL.unscheduled}</span>{q.status === "overdue" && <small className="muted"> {q.daysLate}d late</small>}</td>
                          <td className="name">{q.row.patient || "—"}</td><td>{q.row.contact || "—"}</td><td className="name">{q.row.procedure || "—"}</td>
                          <td className="name">{q.row.channel}</td><td className="name">{q.row.branch}</td>
                          <td className="name">{q.state === "noShow" ? "No-show: reschedule" : "Not booked"}</td>
                          <td className="name td-wrap">{q.row.action || q.row.remarks || q.row.inquired || "—"}</td>
                          {onOpenTracker && <td><span className="row-edit"><ListChecks size={14} aria-hidden />In tracker</span></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {queue.length > 60 && <p className="drill-meta">Showing 60 of {count(queue.length)}. <button type="button" className="link-btn" onClick={() => open("Follow-up queue", queue.map((q) => q.row))}>Open all</button> to see or download every one.</p>}
                </div>
              ) : <p className="empty-note">Nothing waiting. Every lead is booked or closed.</p>}
            </div>
          </section>

          <section>
            <SectionHead n={4} title="Patient retention" doctor="identify patients due for clinically recommended follow-up." />
            <div className="grid-2">
              <div className="panel">
                <div className="queue-head">
                  <h3>Recall list: served patients not seen since</h3>
                  <label className="inline-select">Last visit at least
                    <select value={recallMonths} onChange={(e) => setRecallMonths(Number(e.target.value))}>{[1, 2, 3, 6, 12].map((m) => <option key={m} value={m}>{m} month{m === 1 ? "" : "s"} ago</option>)}</select>
                  </label>
                </div>
                {deidentified ? <p className="empty-note">{count(recall.length)} served patients have not been back in {recallMonths}+ months. Names and numbers are hidden for Marketing accounts.</p> : recall.length ? (
                  <div className="table-scroll queue">
                    <table>
                      <tbody>
                        <tr><th>Patient</th><th>Contact</th><th>Procedure</th><th>Last visit</th><th className="num">Months</th></tr>
                        {recall.slice(0, 40).map((x) => (
                          <tr key={x.row.rowKey} className="is-clickable" {...clickable(() => open(x.row.patient, [x.row]), `${x.row.patient}: details`)}>
                            <td className="name">{x.row.patient}</td><td>{x.row.contact || "—"}</td><td className="name">{x.row.procedure}</td><td>{fmt(x.served)}</td>
                            <td className="num">{((today.getTime() - x.served!.getTime()) / (30.44 * 86_400_000)).toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {recall.length > 40 && <p className="drill-meta"><button type="button" className="link-btn" onClick={() => open(`Recall: last visit ${recallMonths}+ months ago`, recall.map((x) => x.row))}>Open all {count(recall.length)}</button> to see or download the full list.</p>}
                  </div>
                ) : <p className="empty-note">No served patient is past this interval yet.</p>}
                <p className="empty-note" style={{ marginTop: 10 }}>The doctors decide who clinically needs a follow-up and when. This list only shows who has not been back.</p>
              </div>
              <div className="panel">
                <h3>New vs. returning patients</h3>
                {c.byPatient.length ? <StatTable rows={c.byPatient} name="Patient" onSelect={(r) => open(`${r.name} patients`, filtered.filter((x) => x.patientStatus === r.name))} /> : <p className="empty-note">Add a &ldquo;New or Returning Patient&rdquo; column to compare them.</p>}
                <p className="empty-note" style={{ marginTop: 12 }}>{count(c.repeatPeople.length)} {c.repeatPeople.length === 1 ? "person" : "people"} inquired more than once in this period (matched by contact number).</p>
              </div>
            </div>
          </section>

          <section>
            <SectionHead n={5} title="Referral management" doctor="track referrals from physicians, clinics and corporate partners." />
            <div className="grid-2">
              <div className="panel">
                <h3>Referral inquiries</h3>
                {c.referral ? (
                  <div className="kpis four mini">
                    <div className="kpi is-clickable" {...clickable(() => open("Referral inquiries", referralRows), "Referrals: details")}><div className="label">Inquiries</div><div className="value">{count(c.referral.inquiries)}</div><div className="note">{pct(c.referral.inquiries / t.inquiries, 0)} of all</div></div>
                    <div className="kpi"><div className="label">Booked</div><div className="value">{pct(c.referral.bookingRate, 0)}</div><div className="note">vs. {pct(c.bookingRate, 0)} overall</div></div>
                    <div className="kpi"><div className="label">Served</div><div className="value">{count(c.referral.served)}</div><div className="note">{count(c.referral.noShow)} no-show</div></div>
                    <div className="kpi"><div className="label">Revenue</div><div className="value">{peso(c.referral.revenue)}</div><div className="note">{pct(c.referral.revenue / Math.max(t.revenue, 1), 0)} of total</div></div>
                  </div>
                ) : <p className="empty-note">No referral inquiries in this selection.</p>}
              </div>
              <div className="panel">
                <h3>By referring physician or partner</h3>
                {c.byReferrer.length ? <StatTable rows={c.byReferrer} name="Referred by" show={false} onSelect={(r) => open(r.name, filtered.filter((x) => x.referredBy === r.name), "Referrals")} />
                  : <p className="empty-note">The tracker only says &ldquo;Doctor&apos;s Referral&rdquo;. Add a <strong>Referred By</strong> column (doctor, clinic or company name) to rank referrers here.</p>}
              </div>
            </div>
          </section>

          <section>
            <SectionHead n={6} title="Marketing analysis" doctor="identify which advertising campaigns lead to actual bookings.">
              Ad spend and cost per patient stay in the Patient Acquisition Dashboard.
            </SectionHead>
            <div className="panel">
              <h3>Inquiries by source group</h3>
              <MixBar label="Inquiries by source group" unit="count" onSelect={(key) => { const g = c.byChannelGroup.find((x) => x.key === key); if (g) open(g.label, filtered.filter((r) => sourceGroup(r.channel) === g.key)); }}
                parts={c.byChannelGroup.map((g) => ({ key: g.key, label: g.label, color: g.color, value: g.inquiries, note: `${pct(g.bookingRate, 0)} booked` }))} />
            </div>
            <div className="panel">
              <h3>Channel / source performance</h3>
              <StatTable rows={c.byChannel} name="Channel / source" onSelect={(r) => open(r.name, filtered.filter((x) => x.channel === r.name))} />
            </div>
            <div className="panel">
              <h3>Campaigns</h3>
              {c.byCampaign.length ? <StatTable rows={c.byCampaign} name="Campaign" onSelect={(r) => open(r.name, filtered.filter((x) => x.campaign === r.name), "Campaign")} />
                : <p className="empty-note">Add a <strong>Campaign</strong> column (for example &ldquo;Sept Heart Month FB ad&rdquo;) and the same table appears per campaign, showing which ads turn into bookings and revenue.</p>}
            </div>
          </section>

          <section>
            <SectionHead n={7} title="Concierge monitoring" doctor="measure response times and staff performance." />
            <div className="grid-even">
              {c.hours.length > 0 && (
                <div className="panel">
                  <h3>When inquiries arrive (by hour)</h3>
                  <CountChart label="Inquiries" color="var(--s1)" data={c.hours.map((h) => ({ label: h.label, value: h.inquiries }))} onSelect={(i) => { const h = c.hours[i]; if (h) open(`Inquiries at ${h.label}`, filtered.filter((r) => r.hasTime && r.date?.getHours() === h.hour)); }} />
                </div>
              )}
              <div className="panel">
                <h3>By day of the week</h3>
                <CountChart label="Inquiries" color="var(--s2)" data={c.weekdays.map((w) => ({ label: w.label, value: w.inquiries }))} onSelect={(i) => open(`${c.weekdays[i].label} inquiries`, filtered.filter((r) => r.date && (r.date.getDay() + 6) % 7 === i))} />
              </div>
            </div>
            <div className="panel">
              <h3>By branch</h3>
              <StatTable rows={c.byBranch} name="Branch" onSelect={(r) => open(`${r.name} branch`, filtered.filter((x) => x.branch === r.name))} />
            </div>
            <div className="grid-even">
              <div className="panel">
                <h3>Staff performance</h3>
                {c.byStaff.length ? <StatTable rows={c.byStaff} name="Staff" show={false} onSelect={(r) => open(r.name, filtered.filter((x) => x.staff === r.name), "Handled by")} />
                  : <p className="empty-note">Add a <strong>Staff</strong> (Handled By) column so each concierge&apos;s inquiries, booking rate and revenue show here.</p>}
              </div>
              <div className="panel">
                <h3>Response time</h3>
                {c.responseHours.length ? (
                  <div className="kpis four mini">
                    <div className="kpi"><div className="label">Median</div><div className="value">{median(c.responseHours).toFixed(1)} h</div></div>
                    <div className="kpi"><div className="label">Within 1 hour</div><div className="value">{pct(c.responseHours.filter((h) => h <= 1).length / c.responseHours.length, 0)}</div></div>
                  </div>
                ) : <p className="empty-note">Add a <strong>Date &amp; Time Responded</strong> column. With the inquiry date and time already in the sheet, the app can then show how fast staff reply.</p>}
              </div>
            </div>
          </section>

          <section>
            <SectionHead n={8} title="Business analytics" doctor="monitor inquiry-to-booking conversion, returning patients and revenue attributable to campaigns." />
            <div className="panel">
              <h3>Demand by procedure</h3>
              <StatTable rows={c.byProcedure} name="Procedure / test" onSelect={(r) => open(r.name, filtered.filter((x) => x.procedure === r.name))} />
            </div>
          </section>

          {missing.length > 0 && (
            <section className="callout">
              <span className="tag">To complete the CRM</span>
              <h2>Columns to add to the concierge inquiry tracker</h2>
              <p>The tracker already covers inquiries, bookings, no-shows, follow-ups, reminders and revenue. Adding these columns fills in the rest of the doctor&apos;s list. The app picks them up automatically on the next upload:</p>
              <ul>{missing.map(([col, why]) => <li key={col}><strong>{col}</strong>: {why}</li>)}</ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
