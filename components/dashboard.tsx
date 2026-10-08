"use client";

import { AlertTriangle, CheckCircle2, Eye } from "lucide-react";
import { DailyChart, MixBar, RankedBars, ServiceChart } from "@/components/charts";
import type { Decision, Finding, InquirySummary, SalesSummary } from "@/lib/analyze";
import { count, longDate, pct, peso, titleCase } from "@/lib/analyze";

const CATEGORY_COLORS: Record<string, string> = { REGULAR: "var(--s2)", SENIOR: "var(--s1)", "SENIOR CITIZEN": "var(--s1)", SC: "var(--s1)", PWD: "var(--s3)" };
const categoryColor = (name: string, fallbackIndex: number) => CATEGORY_COLORS[name] || (fallbackIndex === 0 ? "var(--s4)" : "var(--neutral)");
const TONE_ICON = { risk: AlertTriangle, watch: Eye, ok: CheckCircle2 };

export function Kpis({ s, newOnly }: { s: SalesSummary; newOnly: boolean }) {
  return (
    <div className="kpis">
      <div className="kpi"><div className="label">{newOnly ? "New patients" : "Patients"}</div><div className="value">{count(s.patients)}</div><div className="note">{count(s.visits)} visits</div></div>
      <div className="kpi"><div className="label">Total revenue</div><div className="value">{peso(s.revenue)}</div><div className="note">{newOnly ? "from new patients only" : "all patient types"}</div></div>
      <div className="kpi"><div className="label">Avg. revenue / patient</div><div className="value">{peso(s.avgPerPatient)}</div><div className="note">median {peso(s.medianPerPatient)}</div></div>
      <div className="kpi"><div className="label">Items per visit</div><div className="value">{s.visits ? (s.lineItems / s.visits).toFixed(1) : "—"}</div><div className="note">{count(s.lineItems)} billed line items</div></div>
      <div className="kpi"><div className="label">Discount given</div><div className="value">{peso(s.discount)}</div><div className="note">{s.gross ? `${pct(s.discount / s.gross)} of gross ${peso(s.gross)}` : "no discount column"}</div></div>
    </div>
  );
}

export function Briefing({ s, findings, decisions, period }: { s: SalesSummary; findings: Finding[]; decisions: Decision[]; period: string }) {
  return (
    <section className="brief" aria-labelledby="ceo-briefing">
      <span className="tag">CEO briefing</span>
      <h2 id="ceo-briefing">What this period says, and what to decide</h2>
      <p className="section-note">A one-screen summary of the sections below. Every figure is calculated from the uploaded workbook ({period}). Nothing is estimated.</p>

      <div className="panel">
        <h3>Where revenue came from ({peso(s.revenue)})</h3>
        <MixBar label="Revenue by source group" parts={s.groups.map((g) => ({ key: g.key, label: g.label, color: g.color, value: g.revenue, note: `${count(g.patients)} patient${g.patients === 1 ? "" : "s"}` }))} />
      </div>

      {findings.length > 0 && (
        <div className="findings">
          {findings.map((f) => {
            const Icon = TONE_ICON[f.tone];
            return (
              <div key={f.label} className={`finding ${f.tone}`}>
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
  return (
    <section>
      <h2>Full funnel: Central Concierge log</h2>
      <p className="section-note">This is the upstream half the billing data can&apos;t see: every inquiry, not just the ones that paid. The log holds <strong>{count(q.inquiries)} inquir{q.inquiries === 1 ? "y" : "ies"} ({span})</strong>.{q.inquiries < 30 ? " That is too few to act on; treat these rates as a pilot, not a baseline." : ""}</p>
      <div className="kpis four">
        <div className="kpi"><div className="label">Inquiries logged</div><div className="value">{count(q.inquiries)}</div><div className="note">{span}</div></div>
        <div className="kpi"><div className="label">Booking conversion</div><div className="value">{q.inquiries ? pct(q.booked / q.inquiries, 0) : "—"}</div><div className="note">{count(q.booked)} of {count(q.inquiries)} booked</div></div>
        <div className="kpi"><div className="label">Show rate</div><div className="value">{q.booked ? pct(q.served / q.booked, 0) : "—"}</div><div className="note">{count(q.served)} of {count(q.booked)} booked attended</div></div>
        <div className="kpi"><div className="label">Open follow-ups</div><div className="value">{count(q.followUps.length)}</div><div className="note">{count(q.followUps.length - noShows)} unconverted + {count(noShows)} no-show</div></div>
      </div>
      <div className="grid-2">
        <div className="panel">
          <h3>Inquiry → Booking → Served</h3>
          <RankedBars label="Funnel" color="var(--s3)" format={(v) => `${count(v)} of ${count(q.inquiries)}`} items={[{ name: "Inquiries", value: q.inquiries }, { name: "Booked", value: q.booked }, { name: "Served (completed)", value: q.served }]} />
        </div>
        <div className="panel">
          <h3>Inquiries by branch</h3>
          <RankedBars label="Inquiries by branch" color="var(--s4)" format={(v) => `${count(v)} inquir${v === 1 ? "y" : "ies"}`} items={q.branches.map((b) => ({ name: b.branch, value: b.inquiries }))} />
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
                return <tr key={c.channel}><td className="name">{c.channel}</td><td className="num">{c.inquiries}</td><td className="num">{c.booked}</td><td><div className="bar-cell"><span>{pct(rate, 0)}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${rate * 100}%`, background: "var(--s2)" }} /></div></div></td><td className="num">{c.booked ? pct(c.served / c.booked, 0) : "—"}</td></tr>;
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
  if (!s.days.length) return null;
  const avg = s.days.reduce((sum, d) => sum + d.patients, 0) / s.days.length;
  const peaks = s.days.filter((d) => d.patients >= avg * 1.5);
  return (
    <section>
      <h2>Daily volume</h2>
      <p className="section-note">Patients and revenue per day from the billing export, {s.days.length} day{s.days.length === 1 ? "" : "s"} with transactions.{peaks.length ? ` ${peaks.map((d) => d.label).join(" and ")} stand${peaks.length === 1 ? "s" : ""} out. Worth checking what drove ${peaks.length === 1 ? "that day" : "those days"} (campaign, referral batch, or clinic schedule) so it can be repeated.` : ""}</p>
      <div className="grid-even">
        <div className="panel"><h3>Patients per day</h3><DailyChart data={s.days} metric="patients" /></div>
        <div className="panel"><h3>Revenue per day</h3><DailyChart data={s.days} metric="revenue" /></div>
      </div>
    </section>
  );
}

export function Sources({ s }: { s: SalesSummary }) {
  const max = Math.max(...s.sources.map((x) => x.revenue), 1);
  return (
    <section>
      <h2>Where patients come from</h2>
      <p className="section-note">Each patient is credited to the first source recorded for them, together with all of their revenue in the period.</p>
      <div className="grid-2 flip">
        <div className="panel">
          <h3>Revenue by source</h3>
          <RankedBars label="Revenue by source" color="var(--s1)" items={s.sources.slice(0, 10).map((x) => ({ name: x.source, value: x.revenue }))} />
        </div>
        <div className="panel">
          <h3>Source performance</h3>
          <div className="table-scroll">
            <table>
              <tbody>
                <tr><th>Source</th><th className="num">Patients</th><th>Revenue</th><th className="num">Avg / patient</th></tr>
                {s.sources.map((x) => (
                  <tr key={x.source}>
                    <td className="name">{x.source}</td><td className="num">{count(x.patients)}</td>
                    <td><div className="bar-cell"><span>{peso(x.revenue)}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${(x.revenue / max) * 100}%`, background: "var(--s1)" }} /></div></div></td>
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
  return (
    <section>
      <h2>Revenue mix</h2>
      <div className={s.categories.length ? "grid-2" : ""}>
        <div className="panel">
          <h3>By {s.serviceLabel}</h3>
          <ServiceChart data={s.services.map((x) => ({ name: x.name, revenue: x.revenue }))} />
        </div>
        {s.categories.length > 0 && (
          <div className="panel">
            <h3>By patient category</h3>
            <MixBar label="Revenue by patient category" parts={s.categories.map((c, i) => ({ key: c.name, label: titleCase(c.name), color: categoryColor(c.name, s.categories.slice(0, i).filter((x) => !CATEGORY_COLORS[x.name]).length), value: c.revenue, note: `${count(c.patients)} pts` }))} />
            <div className="table-scroll" style={{ marginTop: 14 }}>
              <table>
                <tbody>
                  <tr><th>Category</th><th className="num">Patients</th><th className="num">Revenue</th><th className="num">Share</th></tr>
                  {s.categories.map((c) => <tr key={c.name}><td className="name">{titleCase(c.name)}</td><td className="num">{count(c.patients)}</td><td className="num">{peso(c.revenue)}</td><td className="num">{pct(c.revenue / s.revenue)}</td></tr>)}
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
  if (!s.physicians.length) return null;
  const top = s.physicians.slice(0, 8);
  return (
    <section>
      <h2>Top referring physicians</h2>
      <p className="section-note">{s.referralPatients ? `Doctor referrals brought ${count(s.referralPatients)} patients and ${peso(s.referralRevenue)}. ` : ""}These {top.length} physicians account for the bulk of it. Use this as the physician-relations follow-up list.</p>
      <div className="panel">
        <RankedBars label="Revenue by referring physician" color="var(--s1)" items={top.map((p) => ({ name: p.name, value: p.revenue, note: `${count(p.patients)} pt${p.patients === 1 ? "" : "s"}` }))} />
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
