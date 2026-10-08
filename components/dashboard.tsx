"use client";

import { Fragment } from "react";
import { AlertTriangle, CheckCircle2, Eye } from "lucide-react";
import { DailyChart, MixBar, RankedBars, ServiceChart } from "@/components/charts";
import { clickable, useDrill } from "@/components/drill";
import type { Decision, Finding, InquirySummary, PatientTypeFilter, SalesSummary } from "@/lib/analyze";
import { count, longDate, patientTypeInfo, pct, peso, titleCase } from "@/lib/analyze";

const CATEGORY_COLORS: Record<string, string> = { REGULAR: "var(--s1)", SENIOR: "var(--s2)", "SENIOR CITIZEN": "var(--s2)", SC: "var(--s2)", PWD: "var(--s3)" };
const categoryColor = (name: string, fallbackIndex: number) => CATEGORY_COLORS[name] || (fallbackIndex === 0 ? "var(--s4)" : "var(--neutral)");
const TONE_ICON = { risk: AlertTriangle, watch: Eye, ok: CheckCircle2 };

const KPI_PATIENT_LABEL: Record<PatientTypeFilter, string> = { all: "Patients", new: "New patients", returning: "Returning patients", scheduled: "Scheduled patients", walkin: "Walk-in patients", home: "Home service patients", sendin: "Send-in patients", trial: "Clinical trial patients" };

export function Kpis({ s, typeKey }: { s: SalesSummary; typeKey: PatientTypeFilter }) {
  const all = typeKey === "all";
  const drill = useDrill();
  const label = KPI_PATIENT_LABEL[typeKey];
  const openAll = () => drill({ kind: "sales", title: all ? "All records" : label, rows: s.rowsFor.all() });
  return (
    <div className="kpis">
      <div className="kpi is-clickable" {...clickable(openAll, `${label}: details`)}><div className="label">{KPI_PATIENT_LABEL[typeKey]}</div><div className="value">{count(s.patients)}</div><div className="note">{all && s.newPatients && s.returning.patients ? `${count(s.newPatients)} new · ${count(s.returning.patients)} returning` : `${count(s.visits)} visits`}</div></div>
      <div className="kpi is-clickable" {...clickable(openAll, "Total revenue: details")}><div className="label">Total revenue</div><div className="value">{peso(s.revenue)}</div><div className="note">{all ? `${count(s.visits)} visits, all patient types` : `${patientTypeInfo(typeKey).short} patients only`}</div></div>
      <div className="kpi is-clickable" {...clickable(openAll, "Avg. revenue / patient: details")}><div className="label">Avg. revenue / patient</div><div className="value">{peso(s.avgPerPatient)}</div><div className="note">median {peso(s.medianPerPatient)}</div></div>
      <div className="kpi is-clickable" {...clickable(openAll, "Items per visit: details")}><div className="label">Items per visit</div><div className="value">{s.visits ? (s.lineItems / s.visits).toFixed(1) : "—"}</div><div className="note">{count(s.lineItems)} billed line items</div></div>
      <div className="kpi is-clickable" {...clickable(() => drill({ kind: "sales", title: "Discounted items", rows: s.rowsFor.discounted() }), "Discount given: details")}><div className="label">Discount given</div><div className="value">{peso(s.discount)}</div><div className="note">{s.gross ? `${pct(s.discount / s.gross)} of gross ${peso(s.gross)}` : "no discount column"}</div></div>
    </div>
  );
}

const TYPE_MIX = [
  { key: "new", label: "NEW", color: "var(--s1)" },
  { key: "returning", label: "Returning (Scheduled, Walk-in, HMO)", color: "var(--s2)" },
  { key: "home", label: "Home service", color: "var(--s3)" },
  { key: "sendin", label: "Send-in", color: "var(--s4)" },
  { key: "trial", label: "Clinical trial", color: "var(--neutral)" },
  { key: "other", label: "Other / not recorded", color: "var(--neutral-soft)" },
];

const TYPE_TITLE: Record<string, string> = { new: "NEW patients (NEW + HMO/NEW)", returning: "Returning patients", scheduled: "Scheduled (returning)", walkin: "Walk-in (returning)", hmo: "HMO (returning)", home: "Home service", sendin: "Send-in", trial: "Clinical trial", other: "Other / not recorded" };

export function PatientTypes({ s }: { s: SalesSummary }) {
  const drill = useDrill();
  const openType = (key: string) => drill({ kind: "sales", title: TYPE_TITLE[key] || key, rows: s.rowsFor.type(key) });
  const mixKey = (key: string, returning?: boolean) => (returning ? "returning" : key);
  const parts = TYPE_MIX.map((m) => {
    const rows = s.types.filter((t) => mixKey(t.key, t.returning) === m.key);
    return { ...m, value: rows.reduce((sum, t) => sum + t.revenue, 0), patients: m.key === "returning" ? s.returning.patients : rows.reduce((sum, t) => sum + t.patients, 0) };
  }).filter((p) => p.patients > 0);
  return (
    <section>
      <h2>Patients by type</h2>
      <p className="section-note">NEW includes NEW and HMO/NEW. Returning patients are Scheduled, Walk-in and HMO. A patient seen as two types in the period counts once in each.</p>
      <div className="panel">
        <h3>Revenue by patient type ({peso(s.revenue)})</h3>
        <MixBar label="Revenue by patient type" onSelect={openType} parts={parts.map((p) => ({ key: p.key, label: p.label, color: p.color, value: p.value, note: `${count(p.patients)} patient${p.patients === 1 ? "" : "s"}` }))} />
        <div className="table-scroll" style={{ marginTop: 18 }}>
          <table>
            <tbody>
              <tr><th>Patient type</th><th className="num">Patients</th><th className="num">Visits</th><th className="num">Revenue</th><th className="num">Share</th><th className="num">Avg / patient</th></tr>
              {s.types.map((t, i) => (
                <Fragment key={t.key}>
                  {t.returning && !s.types[i - 1]?.returning && (
                    <tr className="group-row is-clickable" {...clickable(() => openType("returning"), "Returning patients: details")}><td className="name">Returning patients</td><td className="num">{count(s.returning.patients)}</td><td className="num">{count(s.types.filter((x) => x.returning).reduce((sum, x) => sum + x.visits, 0))}</td><td className="num">{peso(s.returning.revenue)}</td><td className="num">{pct(s.returning.revenue / s.revenue)}</td><td className="num">{peso(s.returning.revenue / s.returning.patients)}</td></tr>
                  )}
                  <tr className={`is-clickable${t.returning ? " sub-row" : ""}`} {...clickable(() => openType(t.key), `${t.label}: details`)}>
                    <td className="name">{t.returning ? `↳ ${t.label}` : t.label}</td>
                    <td className="num">{count(t.patients)}</td><td className="num">{count(t.visits)}</td><td className="num">{peso(t.revenue)}</td><td className="num">{pct(t.revenue / s.revenue)}</td><td className="num">{peso(t.revenue / t.patients)}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function Briefing({ s, findings, decisions, period }: { s: SalesSummary; findings: Finding[]; decisions: Decision[]; period: string }) {
  const drill = useDrill();
  const groupLabel = (key: string) => s.groups.find((g) => g.key === key)?.label || key;
  return (
    <section className="brief" aria-labelledby="ceo-briefing">
      <span className="tag">CEO briefing</span>
      <h2 id="ceo-briefing">What this period says, and what to decide</h2>
      <p className="section-note">A one-screen summary of the sections below. Every figure is calculated from the uploaded workbook ({period}). Nothing is estimated.</p>

      {s.groups.length > 0 && (
      <div className="panel">
        <h3>Where new-patient revenue came from ({peso(s.sourcedRevenue)})</h3>
        <MixBar label="New-patient revenue by source group" onSelect={(key) => drill({ kind: "sales", title: groupLabel(key), subtitle: "New patients", rows: s.rowsFor.sourceGroup(key) })} parts={s.groups.map((g) => ({ key: g.key, label: g.label, color: g.color, value: g.revenue, note: `${count(g.patients)} patient${g.patients === 1 ? "" : "s"}` }))} />
      </div>
      )}

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

      {decisions.length > 0 && (
        <div className="panel">
          <h3>Decisions for the next leadership meeting</h3>
          <div className="table-scroll">
            <table className="decisions">
              <tbody>
                <tr><th></th><th>Decision</th><th>Why</th><th>Check next period</th></tr>
                {decisions.map((d, i) => <tr key={d.decision}><td className="n">{i + 1}</td><td>{d.decision}</td><td>{d.why}</td><td className="measure">{d.measure}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p className="decisions-note">Suggested from this period&apos;s numbers. Marketing spend and cost per patient are tracked in the Patient Acquisition Dashboard.</p>
        </div>
      )}
    </section>
  );
}

export function Funnel({ q }: { q: InquirySummary }) {
  const span = q.minDate && q.maxDate ? `${longDate(q.minDate)} – ${longDate(q.maxDate)}` : "the uploaded log";
  const noShows = q.followUps.filter((r) => r.noShow).length;
  const drill = useDrill();
  const open = (title: string, rows: typeof q.rows) => drill({ kind: "inquiries", title, rows });
  const stage: Record<string, typeof q.rows> = { Inquiries: q.rows, Booked: q.rows.filter((r) => r.booked), "Served (completed)": q.rows.filter((r) => r.served) };
  return (
    <section>
      <h2>Full funnel: Central Concierge log</h2>
      <p className="section-note">This is the upstream half the billing data can&apos;t see: every inquiry, not just the ones that paid. The log holds <strong>{count(q.inquiries)} inquir{q.inquiries === 1 ? "y" : "ies"} ({span})</strong>.{q.inquiries < 30 ? " That is too few to act on; treat these rates as a pilot, not a baseline." : ""}</p>
      <div className="kpis four">
        <div className="kpi is-clickable" {...clickable(() => open("All inquiries", q.rows), "Inquiries logged: details")}><div className="label">Inquiries logged</div><div className="value">{count(q.inquiries)}</div><div className="note">{span}</div></div>
        <div className="kpi"><div className="label">Booking conversion</div><div className="value">{q.inquiries ? pct(q.booked / q.inquiries, 0) : "—"}</div><div className="note">{count(q.booked)} of {count(q.inquiries)} booked</div></div>
        <div className="kpi"><div className="label">Show rate</div><div className="value">{q.booked ? pct(q.served / q.booked, 0) : "—"}</div><div className="note">{count(q.served)} of {count(q.booked)} booked attended</div></div>
        <div className="kpi is-clickable" {...clickable(() => open("Leads needing follow-up", q.followUps), "Open follow-ups: details")}><div className="label">Open follow-ups</div><div className="value">{count(q.followUps.length)}</div><div className="note">{count(q.followUps.length - noShows)} unconverted + {count(noShows)} no-show</div></div>
      </div>
      <div className="grid-2">
        <div className="panel">
          <h3>Inquiry → Booking → Served</h3>
          <RankedBars label="Funnel" color="var(--s2)" onSelect={(name) => open(name, stage[name])} format={(v) => `${count(v)} of ${count(q.inquiries)}`} items={[{ name: "Inquiries", value: q.inquiries }, { name: "Booked", value: q.booked }, { name: "Served (completed)", value: q.served }]} />
        </div>
        <div className="panel">
          <h3>Inquiries by branch</h3>
          <RankedBars label="Inquiries by branch" color="var(--s1)" onSelect={(name) => open(`${name} branch`, q.rows.filter((r) => r.branch === name))} format={(v) => `${count(v)} inquir${v === 1 ? "y" : "ies"}`} items={q.branches.map((b) => ({ name: b.branch, value: b.inquiries }))} />
        </div>
      </div>
      <div className="panel" style={{ marginTop: 18 }}>
        <h3>Conversion by channel</h3>
        <div className="table-scroll">
          <table>
            <tbody>
              <tr><th>Channel</th><th className="num">Inquiries</th><th className="num">Booked</th><th>Booking %</th><th className="num">Show %</th></tr>
              {q.channels.map((c) => {
                const rate = c.inquiries ? c.booked / c.inquiries : 0;
                return <tr key={c.channel} className="is-clickable" {...clickable(() => open(c.channel, q.rows.filter((r) => r.channel === c.channel)), `${c.channel}: details`)}><td className="name">{c.channel}</td><td className="num">{c.inquiries}</td><td className="num">{c.booked}</td><td><div className="bar-cell"><span>{pct(rate, 0)}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${rate * 100}%`, background: "var(--s2)" }} /></div></div></td><td className="num">{c.booked ? pct(c.served / c.booked, 0) : "—"}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </div>
      {q.followUps.length > 0 && (
        <div className="panel" style={{ marginTop: 18 }}>
          <h3>Needs follow-up</h3>
          <div className="table-scroll">
            <table>
              <tbody>
                <tr><th>Patient</th><th>Status</th><th>Channel</th><th>Branch</th><th>Procedure</th><th>Follow-up by</th></tr>
                {q.followUps.map((r) => (
                  <tr key={r.rowKey}>
                    <td className="name">{r.patient || "—"}</td>
                    <td className="name">{r.noShow ? "No-show" : "No booking"}{r.remarks ? ` — ${r.remarks}` : r.status && !/^NO/i.test(r.status) ? ` — ${r.status}` : ""}</td>
                    <td>{r.channel}</td><td>{r.branch}</td><td className="name">{r.procedure || "—"}</td><td>{r.followUp || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

export function DailyVolume({ s }: { s: SalesSummary }) {
  const drill = useDrill();
  if (!s.days.length) return null;
  const avg = s.days.reduce((sum, d) => sum + d.patients, 0) / s.days.length;
  const peaks = s.days.filter((d) => d.patients >= avg * 1.5);
  const openDay = (i: number) => { const d = s.days[i]; if (d) drill({ kind: "sales", title: d.date.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" }), rows: s.rowsFor.day(d.date) }); };
  return (
    <section>
      <h2>Daily volume</h2>
      <p className="section-note">Patients and revenue per day from the billing export, {s.days.length} day{s.days.length === 1 ? "" : "s"} with transactions.{peaks.length ? ` ${peaks.map((d) => d.label).join(" and ")} stand${peaks.length === 1 ? "s" : ""} out. Worth checking what drove ${peaks.length === 1 ? "that day" : "those days"} (campaign, referral batch, or clinic schedule) so it can be repeated.` : ""}</p>
      <div className="grid-even">
        <div className="panel"><h3>Patients per day</h3><DailyChart data={s.days} metric="patients" onSelect={openDay} /></div>
        <div className="panel"><h3>Revenue per day</h3><DailyChart data={s.days} metric="revenue" onSelect={openDay} /></div>
      </div>
    </section>
  );
}

export function Sources({ s }: { s: SalesSummary }) {
  const drill = useDrill();
  if (!s.sources.length) {
    if (!s.hasTypeColumn) return null;
    return (
      <section>
        <h2>Where new patients come from</h2>
        <p className="section-note">Source is recorded for new patients only (NEW and HMO/NEW). Choose <strong>All patient types</strong> or <strong>NEW</strong> to see it.</p>
      </section>
    );
  }
  const max = Math.max(...s.sources.map((x) => x.revenue), 1);
  const openSource = (source: string) => drill({ kind: "sales", title: source, subtitle: "New patients", rows: s.rowsFor.source(source) });
  return (
    <section>
      <h2>Where new patients come from</h2>
      <p className="section-note">Source is recorded for new patients only (NEW and HMO/NEW), so returning patients are left out. Each new patient is credited to the first source recorded for them, with all of their revenue in the period: {count(s.sourcedPatients)} patients, {peso(s.sourcedRevenue)}.</p>
      <div className="grid-2 flip">
        <div className="panel">
          <h3>Revenue by source</h3>
          <RankedBars label="Revenue by source" color="var(--s2)" onSelect={openSource} items={s.sources.slice(0, 10).map((x) => ({ name: x.source, value: x.revenue }))} />
        </div>
        <div className="panel">
          <h3>Source performance</h3>
          <div className="table-scroll">
            <table>
              <tbody>
                <tr><th>Source</th><th className="num">Patients</th><th>Revenue</th><th className="num">Avg / patient</th></tr>
                {s.sources.map((x) => (
                  <tr key={x.source} className="is-clickable" {...clickable(() => openSource(x.source), `${x.source}: details`)}>
                    <td className="name">{x.source}</td><td className="num">{count(x.patients)}</td>
                    <td><div className="bar-cell"><span>{peso(x.revenue)}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${(x.revenue / max) * 100}%`, background: "var(--s2)" }} /></div></div></td>
                    <td className="num">{peso(x.avg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

export function RevenueMix({ s }: { s: SalesSummary }) {
  const drill = useDrill();
  const openCategory = (name: string) => drill({ kind: "sales", title: `${titleCase(name)} patients`, rows: s.rowsFor.category(name) });
  return (
    <section>
      <h2>Revenue mix</h2>
      <div className={s.categories.length ? "grid-2" : ""}>
        <div className="panel">
          <h3>By {s.serviceLabel}</h3>
          <ServiceChart data={s.services.map((x) => ({ name: x.name, revenue: x.revenue }))} onSelect={(i) => { const x = s.services[i]; if (x) drill({ kind: "sales", title: titleCase(x.name), rows: s.rowsFor.service(x.name) }); }} />
        </div>
        {s.categories.length > 0 && (
          <div className="panel">
            <h3>By patient category</h3>
            <MixBar label="Revenue by patient category" onSelect={openCategory} parts={s.categories.map((c, i) => ({ key: c.name, label: titleCase(c.name), color: categoryColor(c.name, s.categories.slice(0, i).filter((x) => !CATEGORY_COLORS[x.name]).length), value: c.revenue, note: `${count(c.patients)} pts` }))} />
            <div className="table-scroll" style={{ marginTop: 14 }}>
              <table>
                <tbody>
                  <tr><th>Category</th><th className="num">Patients</th><th className="num">Revenue</th><th className="num">Share</th></tr>
                  {s.categories.map((c) => <tr key={c.name} className="is-clickable" {...clickable(() => openCategory(c.name), `${titleCase(c.name)}: details`)}><td className="name">{titleCase(c.name)}</td><td className="num">{count(c.patients)}</td><td className="num">{peso(c.revenue)}</td><td className="num">{pct(c.revenue / s.revenue)}</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function Physicians({ s }: { s: SalesSummary }) {
  const drill = useDrill();
  if (!s.physicians.length) return null;
  const top = s.physicians.slice(0, 8);
  return (
    <section>
      <h2>Top referring physicians</h2>
      <p className="section-note">{s.referralPatients ? `Doctor referrals brought ${count(s.referralPatients)} new patients and ${peso(s.referralRevenue)}. ` : ""}These {top.length} physicians account for the bulk of it. Use this as the physician-relations follow-up list.</p>
      <div className="panel">
        <RankedBars label="Revenue by referring physician" color="var(--s1)" onSelect={(name) => drill({ kind: "sales", title: name, subtitle: "Referred new patients", rows: s.rowsFor.physician(name) })} items={top.map((p) => ({ name: p.name, value: p.revenue, note: `${count(p.patients)} pt${p.patients === 1 ? "" : "s"}` }))} />
      </div>
    </section>
  );
}

export function StillOpen({ gaps }: { gaps: string[] }) {
  if (!gaps.length) return null;
  return (
    <section className="callout">
      <span className="tag">Still open</span>
      <h2>What this still can&apos;t tell you</h2>
      <p>The dashboard only knows what the uploaded workbooks contain. These gaps limit what it can answer:</p>
      <ul>{gaps.map((g) => <li key={g}>{g}</li>)}</ul>
    </section>
  );
}
