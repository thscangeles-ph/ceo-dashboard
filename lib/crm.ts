import type { Finding } from "./analyze";
import { count, pct, peso, shortDate, sourceGroup, SOURCE_GROUPS } from "./analyze";
import type { LeadState } from "./lead";
import { LEAD_STATES, leadState, needsFollowUp } from "./lead";
import type { InquiryRow } from "./parse";
import { normalize } from "./parse";

export type CrmFilters = { branch: string; patient: "all" | "New" | "Returning"; channel: string; from: string; to: string };
export const DEFAULT_CRM_FILTERS: CrmFilters = { branch: "all", patient: "all", channel: "all", from: "", to: "" };

export function applyCrmFilters(rows: InquiryRow[], f: CrmFilters) {
  const from = f.from ? new Date(`${f.from}T00:00:00`) : null;
  const to = f.to ? new Date(`${f.to}T23:59:59`) : null;
  return rows.filter((r) =>
    (f.branch === "all" || r.branch === f.branch) &&
    (f.patient === "all" || r.patientStatus === f.patient) &&
    (f.channel === "all" || r.channel === f.channel) &&
    (!from || !r.date || r.date >= from) &&
    (!to || !r.date || r.date <= to));
}

/** What the patient asked about, from the free-text "Inquired" column. */
export const TOPICS = [
  { key: "price", label: "Price & fees", test: /PRICE|\bFEES?\b|COST|RATES?\b|HOW MUCH|MAGKANO|PROMO|INSTALL|DISCOUNT/ },
  { key: "hmo", label: "HMO coverage", test: /HMO|INSURANCE|COVERAGE|\bLOA\b/ },
  { key: "doctor", label: "Doctor availability", test: /DOCTOR|DR\.|CARDIOLOGIST/ },
  { key: "walkin", label: "Walk-in allowed?", test: /WALK-?IN/ },
  { key: "schedule", label: "Schedule & earliest slot", test: /SCHEDULE|SLOT|AVAILAB|EARLIEST|APPOINT|CLINIC HOURS|OPEN/ },
  { key: "prep", label: "Preparation & requirements", test: /FASTING|PREP|REQUIREMENT|DURATION|HOW LONG|RESULT/ },
  { key: "repeat", label: "Repeat / follow-up test", test: /REPEAT|FOLLOW-?UP/ },
] as const;
export function inquiryTopic(row: InquiryRow) {
  // Drop the procedure name first so "Facility Fee" doesn't read as a price question.
  const text = normalize(row.inquired.replace(row.procedure, " "));
  if (!text) return "Not recorded";
  return TOPICS.find((t) => t.test.test(text))?.label || "Other";
}

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY);
const weekStart = (d: Date) => { const s = startOfDay(d); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return s; };
const personKey = (r: InquiryRow) => normalize(r.contact).replace(/\D/g, "") || normalize(r.patient);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Stat = { inquiries: number; booked: number; served: number; noShow: number; lost: number; open: number; revenue: number };
const emptyStat = (): Stat => ({ inquiries: 0, booked: 0, served: 0, noShow: 0, lost: 0, open: 0, revenue: 0 });
function addStat(stat: Stat, r: InquiryRow) {
  const state = leadState(r);
  stat.inquiries += 1;
  if (r.booked) stat.booked += 1;
  if (r.served) stat.served += 1;
  if (r.noShow) stat.noShow += 1;
  if (state === "lost") stat.lost += 1;
  if (state === "open") stat.open += 1;
  stat.revenue += r.revenue;
}
function groupBy(rows: InquiryRow[], keyOf: (r: InquiryRow) => string) {
  const map = new Map<string, Stat>();
  for (const r of rows) { const k = keyOf(r) || "Not recorded"; const s = map.get(k) || emptyStat(); addStat(s, r); map.set(k, s); }
  return Array.from(map, ([name, s]) => ({ name, ...s, bookingRate: s.inquiries ? s.booked / s.inquiries : 0, showRate: s.served + s.noShow ? s.served / (s.served + s.noShow) : 0 }))
    .sort((a, b) => b.inquiries - a.inquiries || b.revenue - a.revenue);
}
export type GroupStat = ReturnType<typeof groupBy>[number];

export type DueStatus = "overdue" | "today" | "upcoming" | "unscheduled";
export const DUE_LABEL: Record<DueStatus, string> = { overdue: "Overdue", today: "Due today", upcoming: "Upcoming", unscheduled: "No date set" };

export function analyzeCrm(rows: InquiryRow[], today: Date) {
  const total = emptyStat();
  rows.forEach((r) => addStat(total, r));
  const states = LEAD_STATES.map((s) => ({ ...s, rows: rows.filter((r) => leadState(r) === s.key) })).filter((s) => s.rows.length);
  const dates = rows.map((r) => r.date?.getTime()).filter((t): t is number => typeof t === "number");

  // Follow-up queue: open leads and no-shows, by when staff said they'd call back.
  const queue = rows.filter(needsFollowUp).map((r) => {
    const due = r.followUpDate;
    const status: DueStatus = !due ? "unscheduled" : daysBetween(today, due) < 0 ? "overdue" : daysBetween(today, due) === 0 ? "today" : "upcoming";
    return { row: r, due, status, daysLate: due ? -daysBetween(today, due) : 0, state: leadState(r) };
  }).sort((a, b) => ({ overdue: 0, today: 1, upcoming: 2, unscheduled: 3 }[a.status] - { overdue: 0, today: 1, upcoming: 2, unscheduled: 3 }[b.status]) || (a.due?.getTime() || 0) - (b.due?.getTime() || 0));
  const dueCounts = { overdue: 0, today: 0, upcoming: 0, unscheduled: 0 } as Record<DueStatus, number>;
  queue.forEach((q) => { dueCounts[q.status] += 1; });

  // Reminders for booked patients.
  const bookedRows = rows.filter((r) => r.booked);
  const withReminder = bookedRows.filter((r) => r.reminder);
  // Reminder timing can only be judged against an appointment date column.
  const reminderLate = withReminder.filter((r) => r.reminderDate && r.appointmentDate && r.reminderDate > r.appointmentDate);
  const reminderOnTime = withReminder.filter((r) => r.reminderDate && r.appointmentDate && r.reminderDate <= r.appointmentDate);
  const reminderMethods = groupBy(withReminder, (r) => r.reminder.split(/[–—-]\s*/).slice(1).join(" ").trim() || "Not stated");
  const noReminder = bookedRows.filter((r) => !r.reminder);

  // Every inquiry should end with a documented next step.
  const documented = rows.filter((r) => r.booked || r.followUpDate || r.reminder || r.action);
  const undocumented = rows.filter((r) => !(r.booked || r.followUpDate || r.reminder || r.action));
  const openNoDate = rows.filter((r) => leadState(r) === "open" && !r.followUpDate);

  // Time from inquiry to booking date.
  const leadTimes = bookedRows.filter((r) => r.date && r.bookedDate).map((r) => daysBetween(r.date!, r.bookedDate!)).filter((d) => d >= 0);
  const sameDay = leadTimes.filter((d) => d === 0).length;

  // Patients and retention.
  const people = new Map<string, InquiryRow[]>();
  rows.forEach((r) => { const k = personKey(r); if (k) people.set(k, [...(people.get(k) || []), r]); });
  const repeatPeople = Array.from(people.values()).filter((list) => list.length > 1);
  const servedRows = rows.filter((r) => r.served);
  const visitDate = (r: InquiryRow) => r.appointmentDate || r.bookedDate || r.date;
  const lastActivity = (k: string) => Math.max(...(people.get(k) || []).map((r) => visitDate(r)?.getTime() || 0));
  /** Served patients whose last served visit is at least `months` old and who haven't come back since. */
  const recall = (months: number) => {
    const cutoff = new Date(today); cutoff.setMonth(cutoff.getMonth() - months);
    const latest = new Map<string, InquiryRow>();
    servedRows.forEach((r) => {
      const k = personKey(r); const when = visitDate(r)?.getTime() || 0;
      const prev = latest.get(k); if (!prev || when > (visitDate(prev)?.getTime() || 0)) latest.set(k, r);
    });
    return Array.from(latest.entries())
      .map(([k, r]) => ({ row: r, served: visitDate(r), last: lastActivity(k) }))
      .filter((x) => x.served && x.served <= cutoff && x.last <= x.served.getTime())
      .sort((a, b) => a.served!.getTime() - b.served!.getTime());
  };

  // Referrals: "Doctor's Referral" and any referral partner column.
  const referralRows = rows.filter((r) => sourceGroup(r.channel) === "doctor" || r.referredBy);
  const lostReasons = groupBy(rows.filter((r) => leadState(r) === "lost"), (r) => r.action || r.remarks || "No reason recorded").sort((a, b) => b.inquiries - a.inquiries);

  // When inquiries arrive (to plan concierge coverage).
  const hours = Array.from({ length: 24 }, (_, h) => ({ label: `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`, hour: h, inquiries: 0 }));
  rows.forEach((r) => { if (r.date && r.hasTime) hours[r.date.getHours()].inquiries += 1; });
  const firstHour = hours.findIndex((h) => h.inquiries), lastHour = 23 - [...hours].reverse().findIndex((h) => h.inquiries);
  const weekdays = WEEKDAYS.map((label) => ({ label, inquiries: 0, booked: 0 }));
  rows.forEach((r) => { if (r.date) { const w = weekdays[(r.date.getDay() + 6) % 7]; w.inquiries += 1; if (r.booked) w.booked += 1; } });

  const weeks = new Map<number, { start: Date; inquiries: number; booked: number; served: number }>();
  rows.forEach((r) => {
    if (!r.date) return;
    const s = weekStart(r.date); const w = weeks.get(s.getTime()) || { start: s, inquiries: 0, booked: 0, served: 0 };
    w.inquiries += 1; if (r.booked) w.booked += 1; if (r.served) w.served += 1; weeks.set(s.getTime(), w);
  });

  // Response time, only when the sheet records when staff replied.
  const responses = rows.filter((r) => r.date && r.respondedAt && r.hasTime).map((r) => (r.respondedAt!.getTime() - r.date!.getTime()) / 3_600_000).filter((h) => h >= 0);

  return {
    rows, total, states, queue, dueCounts,
    period: dates.length ? { from: new Date(Math.min(...dates)), to: new Date(Math.max(...dates)) } : null,
    bookingRate: total.inquiries ? total.booked / total.inquiries : 0,
    showRate: total.served + total.noShow ? total.served / (total.served + total.noShow) : 0,
    servedRate: total.inquiries ? total.served / total.inquiries : 0,
    byChannel: groupBy(rows, (r) => r.channel),
    byChannelGroup: SOURCE_GROUPS.map((g) => ({ ...g, ...groupBy(rows.filter((r) => sourceGroup(r.channel) === g.key), () => g.key)[0] })).filter((g) => g.inquiries),
    byBranch: groupBy(rows, (r) => r.branch),
    byProcedure: groupBy(rows, (r) => r.procedure),
    byTopic: groupBy(rows, inquiryTopic),
    byPatient: groupBy(rows.filter((r) => r.patientStatus), (r) => r.patientStatus),
    byPayment: groupBy(rows.filter((r) => r.payment), (r) => r.payment),
    byStaff: groupBy(rows.filter((r) => r.staff), (r) => r.staff),
    byReferrer: groupBy(rows.filter((r) => r.referredBy), (r) => r.referredBy),
    byCampaign: groupBy(rows.filter((r) => r.campaign), (r) => r.campaign),
    referral: groupBy(referralRows, () => "Referrals")[0] || null,
    lostReasons,
    reminders: { booked: bookedRows.length, sent: withReminder.length, late: reminderLate, onTime: reminderOnTime.length, missing: noReminder, methods: reminderMethods },
    documented: documented.length, undocumented, openNoDate,
    leadTime: { avg: leadTimes.length ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length : 0, sameDay, count: leadTimes.length },
    people: people.size, repeatPeople, recall,
    hours: firstHour >= 0 ? hours.slice(firstHour, lastHour + 1) : [], weekdays,
    weeks: Array.from(weeks.values()).sort((a, b) => a.start.getTime() - b.start.getTime()).map((w) => ({ ...w, label: shortDate(w.start) })),
    responseHours: responses,
    columns: {
      appointment: rows.some((r) => r.appointmentDate), staff: rows.some((r) => r.staff), referredBy: rows.some((r) => r.referredBy), campaign: rows.some((r) => r.campaign),
      responded: rows.some((r) => r.respondedAt), time: rows.some((r) => r.hasTime), patientStatus: rows.some((r) => r.patientStatus),
    },
  };
}
export type CrmSummary = ReturnType<typeof analyzeCrm>;
export const stateOf = (key: LeadState) => LEAD_STATES.find((s) => s.key === key)!;

/** Plain-language CRM findings, each clickable through to the inquiries behind it. */
export function crmFindings(c: CrmSummary): Finding[] {
  const out: Finding[] = [];
  const t = c.total;
  if (c.dueCounts.overdue || c.dueCounts.today) {
    const rows = c.queue.filter((q) => q.status === "overdue" || q.status === "today").map((q) => q.row);
    out.push({ tone: "risk", label: "Follow-ups due", value: count(rows.length), text: `leads are past or at their follow-up date (${count(c.dueCounts.overdue)} overdue). Call them back, then update the sheet: booked, or no further action.`, drill: () => ({ kind: "inquiries", title: "Follow-ups due or overdue", rows }) });
  }
  const channels = c.byChannel.filter((x) => x.inquiries >= 10);
  if (channels.length >= 2) {
    const best = [...channels].sort((a, b) => b.bookingRate - a.bookingRate)[0];
    const worst = [...channels].sort((a, b) => a.bookingRate - b.bookingRate)[0];
    out.push({ tone: "ok", label: "Best-converting channel", value: pct(best.bookingRate, 0), text: `of ${best.name} inquiries were booked (${count(best.booked)} of ${count(best.inquiries)}), vs. ${pct(c.bookingRate, 0)} overall. Lowest: ${worst.name} at ${pct(worst.bookingRate, 0)}.`, drill: () => ({ kind: "inquiries", title: best.name, rows: c.rows.filter((r) => r.channel === best.name) }) });
  }
  const topics = c.byTopic.filter((x) => x.inquiries >= 10 && x.name !== "Not recorded");
  if (topics.length >= 2) {
    const weakest = [...topics].sort((a, b) => a.bookingRate - b.bookingRate)[0];
    out.push({ tone: "watch", label: "Hardest questions", value: pct(weakest.bookingRate, 0), text: `booking rate when patients ask about ${weakest.name.toLowerCase()} (${count(weakest.inquiries)} inquiries). A ready answer or script for this question may lift bookings.`, drill: () => ({ kind: "inquiries", title: `Asked about: ${weakest.name}`, rows: c.rows.filter((r) => inquiryTopic(r) === weakest.name) }) });
  }
  if (t.noShow) {
    const rows = c.rows.filter((r) => r.noShow);
    out.push({ tone: t.noShow / Math.max(t.booked, 1) > 0.1 ? "risk" : "watch", label: "No-shows", value: count(t.noShow), text: `booked patients did not come (${pct(t.noShow / Math.max(t.booked, 1))} of bookings), about ${peso(t.served ? (t.revenue / t.served) * t.noShow : 0)} in revenue at the average served bill.`, drill: () => ({ kind: "inquiries", title: "No-shows", rows }) });
  }
  if (c.leadTime.count) {
    const rows = c.rows.filter((r) => r.booked && r.date && r.bookedDate && startOfDay(r.date).getTime() === startOfDay(r.bookedDate).getTime());
    out.push({ tone: "ok", label: "Speed to book", value: `${c.leadTime.avg.toFixed(1)} days`, text: `on average from inquiry to booking. ${pct(c.leadTime.sameDay / c.leadTime.count, 0)} of bookings (${count(c.leadTime.sameDay)}) were made the same day the patient asked.`, drill: () => ({ kind: "inquiries", title: "Booked the same day", rows }) });
  }
  if (c.reminders.late.length) {
    out.push({ tone: "risk", label: "Late reminders", value: count(c.reminders.late.length), text: `reminders are dated after the appointment date, so the patient got them too late (or a date was entered wrong). Send reminders the day before.`, drill: () => ({ kind: "inquiries", title: "Reminder dated after the appointment", rows: c.reminders.late }) });
  }
  if (c.byPatient.length === 2) {
    const n = c.byPatient.find((x) => x.name === "New"), r = c.byPatient.find((x) => x.name === "Returning");
    if (n && r) out.push({ tone: "ok", label: "Returning patients", value: pct(r.inquiries / t.inquiries, 0), text: `of inquiries are from returning patients. They book at ${pct(r.bookingRate, 0)} vs. ${pct(n.bookingRate, 0)} for new patients and brought ${peso(r.revenue)}.`, drill: () => ({ kind: "inquiries", title: "Returning patients", rows: c.rows.filter((x) => x.patientStatus === "Returning") }) });
  }
  if (c.lostReasons.length) {
    const top = c.lostReasons[0];
    out.push({ tone: "watch", label: "Lost leads", value: count(c.lostReasons.reduce((s, x) => s + x.inquiries, 0)), text: `inquiries were closed as lost. Most common: "${top.name}" (${count(top.inquiries)}).`, drill: () => ({ kind: "inquiries", title: "Lost leads", rows: c.rows.filter((r) => leadState(r) === "lost") }) });
  }
  return out;
}
