import type { AcquisitionSpend, AcquisitionSummary } from "./acquisition";
import type { Decision, Finding, SalesSummary } from "./analyze";
import { count, longDate, pct, peso, SOURCE_GROUPS } from "./analyze";
import type { CrmSummary } from "./crm";
import { DUE_LABEL } from "./crm";
import { effectiveResponded } from "./lead";
import type { InquiryRow } from "./parse";
import { createReport, fileRange } from "./pdf";
import type { FeedbackSummary, Survey } from "./feedback";
import { dayText as fbDay, pctText } from "./feedback";
import type { Channel, PodcastPlan, Snapshot, Video } from "./podcast";
import { engagementRate, episodeName, formatOf, FORMATS, localDay, PLAN_FORMATS, PLAN_STATUSES, planAlert, sumKnown, videoIdOf } from "./podcast";
import type { NextStep } from "./tracker";
import { STEP_LABEL } from "./tracker";

/** The PDF reports behind each tab's "Download PDF" button, built from what the tab is showing. */

const exact = (v: number) => `PHP ${v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const share = (part: number, whole: number) => (whole ? pct(part / whole) : "-");
const day = (d: Date | null | undefined) => (d ? longDate(d) : "-");
const patientsText = (n: number) => `${count(n)} patient${n === 1 ? "" : "s"}`;

export async function salesReport(s: SalesSummary, o: { period: string; filters: string; findings: Finding[]; decisions: Decision[]; typeLabel: string }) {
  const r = await createReport({ title: "Sales Report", period: o.period, filters: o.filters });
  r.kpis([
    { label: o.typeLabel, value: count(s.patients), note: s.newPatients && s.returning.patients ? `${count(s.newPatients)} new · ${count(s.returning.patients)} returning` : `${count(s.visits)} visits` },
    { label: "Total revenue", value: peso(s.revenue), note: `${count(s.visits)} visits` },
    { label: "Avg. revenue / patient", value: peso(s.avgPerPatient), note: `median ${peso(s.medianPerPatient)}` },
    { label: "Items per visit", value: s.visits ? (s.lineItems / s.visits).toFixed(1) : "-", note: `${count(s.lineItems)} billed line items` },
    { label: "Discount given", value: peso(s.discount), note: s.gross ? `${pct(s.discount / s.gross)} of gross ${peso(s.gross)}` : undefined },
  ]);
  if (s.types.length) {
    r.heading("Patients by type", "A patient seen as two types in the period counts once in each.");
    r.table(["Patient type", "Patients", "Visits", "Revenue", "Share of revenue"],
      s.types.map((t) => [t.returning ? `   ${t.label} (returning)` : t.label, count(t.patients), count(t.visits), peso(t.revenue), share(t.revenue, s.revenue)]), { right: [1, 2, 3, 4] });
  }
  if (o.findings.length) { r.heading("CEO briefing: findings"); r.findings(o.findings); }
  if (o.decisions.length) {
    r.heading("Suggested decisions for the next leadership meeting");
    r.table(["#", "Decision", "Why", "Check next period"], o.decisions.map((d, i) => [i + 1, d.decision, d.why, d.measure]), { widths: { 0: 7 } });
  }
  if (s.groups.length) {
    r.heading("Where new patients come from", `New patients (NEW and HMO/NEW) by the first source they gave. ${count(s.sourcedPatients)} patients, ${peso(s.sourcedRevenue)}.`);
    r.bars(s.groups.map((g) => ({ label: g.label, value: g.patients, display: `${patientsText(g.patients)} · ${peso(g.revenue)}` })));
    r.table(["Source", "Group", "New patients", "Revenue", "Avg. per patient"],
      s.sources.map((x) => [x.source, SOURCE_GROUPS.find((g) => g.key === x.group)?.label || "-", count(x.patients), peso(x.revenue), peso(x.avg)]), { right: [2, 3, 4] });
  }
  if (s.services.length) {
    r.heading(`Revenue by ${s.serviceLabel}`);
    r.bars(s.services.map((x) => ({ label: x.name, value: x.revenue, display: `${peso(x.revenue)} · ${share(x.revenue, s.revenue)}` })));
  }
  if (s.categories.length) {
    r.heading("Revenue by patient category", `Statutory (Senior / PWD) discounts: ${peso(s.statutoryDiscount)}; other discounts: ${peso(s.otherDiscount)}.`);
    r.table(["Category", "Patients", "Revenue", "Share"], s.categories.map((c) => [c.name, count(c.patients), peso(c.revenue), share(c.revenue, s.revenue)]), { right: [1, 2, 3] });
  }
  if (s.physicians.length) {
    r.heading("Top referring physicians");
    r.table(["Physician", "Patients", "Revenue"], s.physicians.slice(0, 15).map((p) => [p.name, count(p.patients), peso(p.revenue)]), { right: [1, 2] });
  }
  if (s.days.length) {
    r.heading("Daily volume");
    r.table(["Date", "Patients", "Revenue"], [...s.days.map((d) => [longDate(d.date), count(d.patients), peso(d.revenue)]), ["Total", count(s.patients), peso(s.revenue)]], { right: [1, 2], boldLast: true });
  }
  r.note("Patient names are used only to count unique patients and are never shown from the sales report.");
  r.save(`THSC Sales Report ${fileRange(s.minDate, s.maxDate)}.pdf`);
}

export async function acquisitionReport(a: AcquisitionSummary, spend: AcquisitionSpend, o: { filters: string; typeLabel: string; selectedNote: string }) {
  const period = a.period ? `${longDate(a.period.from)} - ${longDate(a.period.to)}` : "No rows in this range";
  const r = await createReport({ title: "Patient Acquisition Cost Report", period, filters: o.filters });
  const cost = a.newPatients && spend.total ? spend.total / a.newPatients : 0;
  r.kpis([
    { label: `Unique patients · ${o.typeLabel}`, value: count(a.selected.patients), note: o.selectedNote },
    { label: "Transactions", value: count(a.selected.transactions), note: "Unique transaction numbers" },
    { label: "Patient revenue", value: peso(a.selected.revenue), note: "Sum of Total Payment" },
    { label: "Acquisition cost / new patient", value: cost ? exact(cost) : "-", note: spend.total ? `${exact(spend.total)} / ${count(a.newPatients)} new patients` : "No marketing spend entered", accent: true },
  ]);
  r.heading("Patients by type");
  r.table(["Patient type", "Includes", "Unique patients", "Transactions", "Revenue", "Share"],
    [...a.types.map((t) => [t.label, t.parts?.map((p) => `${count(p.patients)} ${p.label}`).join(" · ") || t.includes, count(t.patients), count(t.transactions), peso(t.revenue), share(t.revenue, a.total.revenue)]),
      ["ALL PATIENT TYPES", "Each patient counted once", count(a.total.patients), count(a.total.transactions), peso(a.total.revenue), a.total.revenue ? "100%" : "-"]],
    { right: [2, 3, 4, 5], boldLast: true });
  r.heading("New patients by acquisition source", `Only NEW and HMO/NEW patients carry a source; each counts once, under the first source they gave.${a.noSource ? ` ${count(a.noSource)} new patients without a source are left out.` : ""}`);
  if (a.sources.length) r.bars(a.sources.slice(0, 12).map((s) => ({ label: s.source, value: s.patients, display: `${patientsText(s.patients)} · ${peso(s.revenue)}` })));
  const allocated = Object.values(spend.bySource).reduce((sum, v) => sum + (v || 0), 0);
  r.heading("Cost by acquisition source", spend.total ? `Total marketing spend ${exact(spend.total)}; allocated to sources ${exact(allocated)}.` : "No marketing spend entered for this date range.");
  r.table(["Source", "New patients", "Revenue", "Spend", "Cost / patient"],
    a.sources.map((s) => { const v = spend.bySource[s.source] || 0; return [s.source, count(s.patients), peso(s.revenue), v ? exact(v) : "-", v ? exact(v / s.patients) : "-"]; }), { right: [1, 2, 3, 4] });
  r.note("Counting rule: one unique Patient Name equals one patient. RETURNING PATIENTS combines SCHEDULED, WALK-IN and HMO. Patient names are never shown.");
  r.save(`THSC Patient Acquisition Cost ${fileRange(a.period?.from, a.period?.to)}.pdf`);
}

export async function crmReport(c: CrmSummary, o: { findings: Finding[]; filters: string; deidentified: boolean; today: Date }) {
  const t = c.total;
  const period = c.period ? `${longDate(c.period.from)} - ${longDate(c.period.to)}` : "-";
  const r = await createReport({ title: "CRM Report", period, filters: `${o.filters} · Follow-up status as of ${longDate(o.today)}`, confidential: !o.deidentified });
  r.kpis([
    { label: "Inquiries", value: count(t.inquiries), note: `${count(c.people)} people` },
    { label: "Inquiry -> booking", value: pct(c.bookingRate, 0), note: `${count(t.booked)} of ${count(t.inquiries)} booked` },
    { label: "Show rate", value: pct(c.showRate, 0), note: `${count(t.served)} served · ${count(t.noShow)} no-show` },
    { label: "Revenue from inquiries", value: peso(t.revenue), note: `${peso(t.inquiries ? t.revenue / t.inquiries : 0)} per inquiry` },
    { label: "Follow-ups pending", value: count(c.queue.length), note: `${count(c.dueCounts.overdue)} overdue · ${count(c.dueCounts.unscheduled)} no date` },
  ]);
  r.heading("Where every inquiry ended up");
  r.bars(c.states.map((s) => ({ label: s.label, value: s.rows.length, display: `${count(s.rows.length)} · ${share(s.rows.length, t.inquiries)}` })));
  if (o.findings.length) { r.heading("Findings"); r.findings(o.findings); }
  r.heading("1. Inquiry management", `${count(c.responded)} of ${count(t.inquiries)} inquiries (${share(c.responded, t.inquiries)}) were responded to; ${count(c.priceUnanswered.length)} price questions are still unanswered. ${count(c.documented)} have a recorded next step.`);
  r.table(["What patients ask", "Inquiries", "Booked", "Booking %"], c.byTopic.map((x) => [x.name, count(x.inquiries), count(x.booked), pct(x.bookingRate, 0)]), { right: [1, 2, 3] });
  r.table(["Week of", "Inquiries", "Booked", "Served"], c.weeks.map((w) => [w.label, count(w.inquiries), count(w.booked), count(w.served)]), { right: [1, 2, 3] });
  r.heading("2-3. Appointments and follow-ups", `Bookings were made ${c.leadTime.avg.toFixed(1)} days after the inquiry on average. ${count(c.reminders.sent)} of ${count(c.reminders.booked)} booked patients have a reminder recorded.`);
  r.table(["Follow-up status", "Leads"], (["overdue", "today", "upcoming", "unscheduled"] as const).map((k) => [DUE_LABEL[k], count(c.dueCounts[k])]), { right: [1] });
  if (!o.deidentified && c.queue.length) {
    r.note(`Follow-up queue (${c.queue.length > 60 ? "first 60 of " : ""}${count(c.queue.length)}, most urgent first):`);
    r.table(["Follow up by", "Patient", "Contact", "Procedure", "Channel", "Status"],
      c.queue.slice(0, 60).map((q) => [q.due ? `${day(q.due)}${q.status === "overdue" ? ` (${q.daysLate}d late)` : ""}` : DUE_LABEL.unscheduled, q.row.patient || "-", q.row.contact || "-", q.row.procedure || "-", q.row.channel, q.state === "noShow" ? "No-show: reschedule" : "Not booked"]), { fontSize: 7.5 });
  }
  r.heading("6. Marketing: channel / source performance");
  r.table(["Channel / source", "Inquiries", "Booked", "Booking %", "Served", "Revenue"], c.byChannel.map((x) => [x.name, count(x.inquiries), count(x.booked), pct(x.bookingRate, 0), count(x.served), peso(x.revenue)]), { right: [1, 2, 3, 4, 5] });
  if (c.byCampaign.length) r.table(["Campaign", "Inquiries", "Booked", "Booking %", "Revenue"], c.byCampaign.map((x) => [x.name, count(x.inquiries), count(x.booked), pct(x.bookingRate, 0), peso(x.revenue)]), { right: [1, 2, 3, 4] });
  if (c.byReferrer.length) { r.heading("5. Referral partners"); r.table(["Referred by", "Inquiries", "Booked", "Served", "Revenue"], c.byReferrer.map((x) => [x.name, count(x.inquiries), count(x.booked), count(x.served), peso(x.revenue)]), { right: [1, 2, 3, 4] }); }
  r.heading("7. Concierge monitoring");
  r.table(["Branch", "Inquiries", "Booked", "Booking %", "Served", "Revenue"], c.byBranch.map((x) => [x.name, count(x.inquiries), count(x.booked), pct(x.bookingRate, 0), count(x.served), peso(x.revenue)]), { right: [1, 2, 3, 4, 5] });
  if (c.byStaff.length) r.table(["Staff", "Inquiries", "Booked", "Booking %", "Revenue"], c.byStaff.map((x) => [x.name, count(x.inquiries), count(x.booked), pct(x.bookingRate, 0), peso(x.revenue)]), { right: [1, 2, 3, 4] });
  r.heading("8. Demand by procedure");
  r.table(["Procedure / test", "Inquiries", "Booked", "No-show", "Served", "Revenue"], c.byProcedure.map((x) => [x.name, count(x.inquiries), count(x.booked), count(x.noShow), count(x.served), peso(x.revenue)]), { right: [1, 2, 3, 4, 5] });
  r.save(`THSC CRM Report ${fileRange(c.period?.from, c.period?.to)}.pdf`);
}

export async function trackerReport(items: { row: InquiryRow; step: NextStep; n: number }[], o: { view: string; filters: string; counts: { label: string; value: number }[] }) {
  const times = items.map((i) => i.row.date?.getTime()).filter((x): x is number => typeof x === "number");
  const from = times.length ? new Date(Math.min(...times)) : null, to = times.length ? new Date(Math.max(...times)) : null;
  const r = await createReport({ title: `Inquiry Tracker: ${o.view}`, period: from && to ? `${longDate(from)} - ${longDate(to)}` : "-", filters: o.filters, landscape: true, confidential: true });
  r.kpis(o.counts.map((x) => ({ label: x.label, value: count(x.value) })));
  r.table(["#", "Date", "Name", "Contact", "Channel", "Procedure", "Inquired", "Resp.", "Booked", "Outcome", "Next step / status"],
    items.map(({ row, step, n }) => [
      n, row.date ? `${longDate(row.date)}${row.hasTime ? ` ${row.date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}` : "-",
      row.patient || "-", row.contact || "-", row.channel === "Not recorded" ? "-" : row.channel, row.procedure || "-", row.inquired || "-",
      effectiveResponded(row) ? "YES" : "NO", row.booked ? (row.bookedDate ? longDate(row.bookedDate) : "Yes") : "-",
      row.served ? "Served" : row.noShow ? "No-show" : "-", step.tone === "done" ? `COMPLETE - ${step.detail}` : `${STEP_LABEL[step.tone]}: ${step.text} (${step.detail})`,
    ]), { fontSize: 7, widths: { 0: 9, 1: 24, 6: 52, 10: 50 } });
  r.save(`THSC Inquiry Tracker ${fileRange(from, to)}.pdf`);
}

/** Podcast Tracker & Scheduler: the YouTube channel's figures (all time) and the schedule. */
export async function podcastReport(o: { channel: Channel | null; videos: Video[]; history: Snapshot[]; plans: PodcastPlan[]; today: string; fetchedAt: string | null }) {
  const n = (v: number | null | undefined) => (v === null || v === undefined ? "-" : count(Math.round(v)));
  const when = (d: string, t: string) => (d ? `${longDate(new Date(`${d}T00:00:00`))}${t ? ` ${t}` : ""}` : "-");
  const r = await createReport({ title: "Podcast Report (YouTube)", period: o.fetchedAt ? `YouTube figures as of ${new Date(o.fetchedAt).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}` : "YouTube not connected", filters: o.channel ? `Channel: ${o.channel.name} · All uploads, lifetime views` : undefined });
  const views = sumKnown(o.videos.map((v) => v.views));
  const parts = FORMATS.map((f) => { const list = o.videos.filter((v) => formatOf(v) === f.id); const vw = sumKnown(list.map((v) => v.views)); const likes = sumKnown(list.map((v) => v.likes)), comments = sumKnown(list.map((v) => v.comments)); return { ...f, list, views: vw, likes, comments, avg: list.length ? vw / list.length : null, rate: vw ? (likes + comments) / vw : null }; });
  // Subscriber growth over the last 30 days of daily readings.
  const last = o.history.at(-1);
  const since = last ? o.history.find((s) => s.date >= localDay(Date.now() - 30 * 86_400_000) && s.date !== last.date) : undefined;
  const gain = since && last && since.subscribers !== null && last.subscribers !== null ? last.subscribers - since.subscribers : null;
  r.kpis([
    { label: "Subscribers", value: n(o.channel?.subscribers), note: gain !== null ? `${gain >= 0 ? "+" : ""}${count(gain)} since ${longDate(new Date(`${since!.date}T00:00:00`))}` : undefined, accent: true },
    { label: "Channel views", value: n(o.channel?.totalViews), note: `${n(o.channel?.videoCount)} public videos` },
    { label: "Upload views", value: count(views), note: `${count(o.videos.length)} uploads` },
    { label: "Full episodes", value: count(parts[0].list.length), note: parts[0].avg !== null ? `${count(Math.round(parts[0].avg))} avg views` : "8 min or longer" },
    { label: "Clips & shorts", value: count(parts[1].list.length), note: parts[1].avg !== null ? `${count(Math.round(parts[1].avg))} avg views` : "Under 8 min" },
  ]);
  r.heading("Episodes vs clips", "Full episodes are uploads 8 minutes or longer. Engagement rate = likes and comments / views.");
  r.table(["Format", "Uploads", "Views", "Avg views", "Likes", "Comments", "Engagement", "Share of views"],
    [...parts.map((p) => [p.label, count(p.list.length), count(p.views), n(p.avg), count(p.likes), count(p.comments), p.rate === null ? "-" : pct(p.rate), views ? pct(p.views / views) : "-"]),
      ["All uploads", count(o.videos.length), count(views), n(o.videos.length ? views / o.videos.length : null), count(sumKnown(o.videos.map((v) => v.likes))), count(sumKnown(o.videos.map((v) => v.comments))), views ? pct((sumKnown(o.videos.map((v) => v.likes)) + sumKnown(o.videos.map((v) => v.comments))) / views) : "-", views ? "100%" : "-"]],
    { right: [1, 2, 3, 4, 5, 6, 7], boldLast: true });
  const top = [...o.videos].filter((v) => v.views).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 10);
  if (top.length) {
    r.heading("Top videos");
    r.bars(top.map((v) => ({ label: episodeName(v.title), value: v.views ?? 0, display: `${count(v.views ?? 0)} views` })));
  }
  const latest = [...o.videos].filter((v) => v.publishedAt).sort((a, b) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!)).slice(0, 15);
  if (latest.length) {
    r.heading("Latest uploads");
    r.table(["Published", "Video", "Format", "Views", "Likes", "Comments", "Engagement"],
      latest.map((v) => [longDate(new Date(v.publishedAt!)), v.title, FORMATS.find((f) => f.id === formatOf(v))!.short, n(v.views), n(v.likes), n(v.comments), engagementRate(v) === null ? "-" : pct(engagementRate(v)!)]),
      { right: [3, 4, 5, 6], widths: { 0: 26, 1: 74 }, fontSize: 7.5 });
  }
  const label = (id: string, list: { id: string; label: string }[]) => list.find((x) => x.id === id)?.label ?? id;
  const open = o.plans.filter((p) => p.status !== "published").sort((a, b) => (a.publishDate || a.recordDate || "9999").localeCompare(b.publishDate || b.recordDate || "9999"));
  r.heading("Schedule: not yet published", `${count(open.length)} planned upload${open.length === 1 ? "" : "s"}; ${count(o.plans.filter((p) => o.today && planAlert(p, o.today)).length)} need attention (recording or publish date has passed).`);
  if (open.length) {
    r.table(["Title", "Format", "Status", "Recording", "Publish on YouTube", "Guest"],
      open.map((p) => [`${p.title}${o.today && planAlert(p, o.today) ? ` (${planAlert(p, o.today)})` : ""}`, label(p.format, PLAN_FORMATS), label(p.status, PLAN_STATUSES), when(p.recordDate, p.recordTime), when(p.publishDate, p.publishTime), p.guest || "-"]),
      { fontSize: 7.5, widths: { 0: 50 } });
  }
  const byId = new Map(o.videos.map((v) => [v.id, v]));
  const done = o.plans.filter((p) => p.status === "published").sort((a, b) => (b.publishDate || "").localeCompare(a.publishDate || "")).slice(0, 20);
  if (done.length) {
    r.heading("Published from the schedule");
    r.table(["Title", "Published", "Views", "Likes", "Comments"], done.map((p) => { const v = byId.get(videoIdOf(p.youtubeUrl)); return [p.title, when(p.publishDate, ""), n(v?.views), n(v?.likes), n(v?.comments)]; }), { right: [2, 3, 4], widths: { 0: 90 } });
  }
  r.save(`THSC Podcast Report ${fileRange(new Date(), new Date())}.pdf`);
}

/** Patient Feedback: the survey results for the period and service chosen on the tab. */
export async function feedbackReport(a: FeedbackSummary, survey: Survey, o: { findings: { label: string; text: string }[]; filters: string }) {
  const t = a.totals;
  const r = await createReport({ title: "Patient Feedback Report", period: a.period ? `Date of visit ${fbDay(a.period.from)} - ${fbDay(a.period.to)}` : "No responses in this period", filters: o.filters, landscape: true, confidential: true });
  r.kpis([
    { label: "Responses", value: count(t.responses), note: a.previous ? `${count(a.previous.responses)} in the previous period` : undefined },
    { label: "Satisfied", value: pctText(t.csat, 1), note: "Very Satisfied or Satisfied", accent: true },
    { label: "Very satisfied", value: pctText(t.verySatisfied, 1), note: t.average === null ? undefined : `Average ${t.average.toFixed(2)} of 5` },
    { label: "Would recommend", value: pctText(t.recommend, 1), note: t.recAnswers ? `${t.rec.Yes} yes, ${t.rec.Maybe} maybe, ${t.rec.No} no` : undefined },
    { label: "Needs follow-up", value: count(a.unhappy.length), note: "Responses with a Dissatisfied rating" },
  ]);
  if (o.findings.length) { r.heading("Interpretation & analysis"); r.findings(o.findings.map((f) => ({ label: f.label, value: "", text: f.text }))); }
  if (a.trend.length > 1) {
    r.heading(`By ${a.byMonth ? "month" : "week"} of visit`);
    r.table([a.byMonth ? "Month" : "Week of", "Responses", "Satisfied", "Would recommend"], a.trend.map((x) => [x.label, count(x.responses), x.satisfied === null ? "-" : `${x.satisfied.toFixed(1)}%`, x.recommend === null ? "-" : `${x.recommend.toFixed(1)}%`]), { right: [1, 2, 3] });
  }
  r.heading("By service");
  r.table(["Service", "Responses", "Very satisfied", "Satisfied", "Average", "Dissatisfied ratings", "Would recommend", "Comments"],
    [...a.services.map((s) => [s.section.name, count(s.responses), pctText(s.verySatisfied), pctText(s.csat), s.average === null ? "-" : s.average.toFixed(2), count(s.dissatisfied), pctText(s.recommend), count(s.comments)]),
      ...(a.services.length > 1 ? [["All services", count(t.responses), pctText(t.verySatisfied), pctText(t.csat), t.average === null ? "-" : t.average.toFixed(2), count(t.dissatisfied), pctText(t.recommend), count(t.comments)]] : [])],
    { right: [1, 2, 3, 4, 5, 6, 7], boldLast: a.services.length > 1 });
  a.services.forEach((s) => {
    const labels = [5, 4, 3, 2, 1].map((p) => s.questions[0]?.column.labels?.[p] ?? String(p));
    r.heading(`${s.section.name}: ${count(s.responses)} response${s.responses === 1 ? "" : "s"}, ${pctText(s.csat)} satisfied`);
    r.table(["Question", ...labels, "N/A", "Satisfied"], s.questions.map((q) => [q.column.text, ...[5, 4, 3, 2, 1].map((p) => count(q.counts[p] || 0)), count(q.na), pctText(q.csat)]), { right: [1, 2, 3, 4, 5, 6, 7], widths: { 0: 120 }, fontSize: 7.5 });
  });
  const profile = a.profile.filter((p) => p.column !== survey.router);
  if (profile.length) {
    r.heading("Who answered");
    profile.forEach((p) => r.table([p.column.text, "Responses", "Share"], p.items.map((i) => [i.name, count(i.value), pctText(i.value / p.answered)]), { right: [1, 2], widths: { 0: 120 } }));
  }
  if (a.unhappy.length) {
    r.heading("Needs follow-up", "Responses with a Dissatisfied (or worse) rating. Sheet row = the response's row in the Google Sheet.");
    r.table(["Date of visit", "Service", "Low ratings", "What they said", "Row"], a.unhappy.map((u) => [fbDay(u.response.visit), u.service || "-", u.low.map((l) => `${l.answer}: ${l.question}`).join("\n"), u.comments.join(" / ") || "-", u.response.row]), { fontSize: 7.5, widths: { 0: 24, 1: 40, 2: 90, 4: 14 } });
  }
  if (a.comments.length) {
    r.heading("Comments & experiences", a.comments.length > 60 ? `The newest 60 of ${count(a.comments.length)}.` : undefined);
    r.table(["Date of visit", "Service", "Type", "Comment"], a.comments.slice(0, 60).map((c) => [fbDay(c.response.visit), c.service, c.kind, `${c.text}${c.low ? " (low rating)" : ""}`]), { fontSize: 7.5, widths: { 0: 24, 1: 40, 2: 32 } });
  }
  r.save(`THSC Patient Feedback ${a.period ? `${a.period.from} to ${a.period.to}` : fileRange(new Date(), new Date())}.pdf`);
}
