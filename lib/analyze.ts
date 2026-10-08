import type { InquiryRow, SalesRow } from "./parse";
import { normalize } from "./parse";

export const peso = (value: number) => `₱${Math.round(value).toLocaleString("en-PH")}`;
export const count = (value: number) => value.toLocaleString("en-PH");
export const pct = (value: number, digits = 1) => `${(Number.isFinite(value) ? value * 100 : 0).toFixed(digits)}%`;
export const shortDate = (date: Date) => date.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
export const longDate = (date: Date) => date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const weekday = (date: Date) => date.toLocaleDateString("en-PH", { weekday: "long" });

/** How a raw Patient Type value from the sales report is grouped. */
export type TypeGroup = "new" | "scheduled" | "walkin" | "hmo" | "returning" | "home" | "sendin" | "trial" | "other";
export function typeGroup(raw: string): TypeGroup {
  const t = normalize(raw).replace(/[\s_-]+/g, " ");
  if (/^(NEW|HMO ?\/? ?NEW|NEW ?\/? ?HMO)$/.test(t)) return "new";
  if (/SCHED/.test(t)) return "scheduled";
  if (/WALK ?IN/.test(t)) return "walkin";
  if (/^HMO\b/.test(t)) return "hmo";
  if (/HOME/.test(t)) return "home";
  if (/SEND ?IN/.test(t)) return "sendin";
  if (/CLINICAL|TRIAL/.test(t)) return "trial";
  if (/RETURN|OLD|FOLLOW/.test(t)) return "returning";
  return "other";
}
const RETURNING: TypeGroup[] = ["scheduled", "walkin", "hmo", "returning"];

/** The patient types the dashboard can be filtered to, in display order. */
export const PATIENT_TYPES = [
  { key: "all", label: "All patient types", short: "All", groups: null },
  { key: "new", label: "NEW (NEW + HMO/NEW)", short: "NEW", groups: ["new"] },
  { key: "returning", label: "Returning patients (Scheduled + Walk-in + HMO)", short: "Returning", groups: RETURNING },
  { key: "scheduled", label: "Scheduled (returning)", short: "Scheduled", groups: ["scheduled"] },
  { key: "walkin", label: "Walk-in (returning)", short: "Walk-in", groups: ["walkin"] },
  { key: "home", label: "Home service", short: "Home service", groups: ["home"] },
  { key: "sendin", label: "Send-in", short: "Send-in", groups: ["sendin"] },
  { key: "trial", label: "Clinical trial", short: "Clinical trial", groups: ["trial"] },
] as const satisfies readonly { key: string; label: string; short: string; groups: readonly TypeGroup[] | null }[];
export type PatientTypeFilter = (typeof PATIENT_TYPES)[number]["key"];
export const patientTypeInfo = (key: PatientTypeFilter) => PATIENT_TYPES.find((t) => t.key === key)!;
export const matchesType = (key: PatientTypeFilter, raw: string) => {
  const groups = patientTypeInfo(key).groups as readonly TypeGroup[] | null;
  return !groups || groups.includes(typeGroup(raw));
};
export type StatusFilter = "paid" | "all";
export type Filters = { patientType: PatientTypeFilter; status: StatusFilter; from: string; to: string };

/** Type rows of the "patients by type" table; HMO stays its own line inside Returning. */
const TYPE_ROWS: { key: TypeGroup; label: string; returning?: boolean }[] = [
  { key: "new", label: "NEW (incl. HMO/NEW)" },
  { key: "scheduled", label: "Scheduled", returning: true },
  { key: "walkin", label: "Walk-in", returning: true },
  { key: "hmo", label: "HMO", returning: true },
  { key: "returning", label: "Other returning", returning: true },
  { key: "home", label: "Home service" },
  { key: "sendin", label: "Send-in" },
  { key: "trial", label: "Clinical trial" },
  { key: "other", label: "Other / not recorded" },
];
export const isPaid = (status: string) => /PAID|COMPLETE|POSTED|SETTLED/.test(status) && !/UNPAID|NOT PAID|CANCEL|VOID|REFUND/.test(status);

export function applyFilters(rows: SalesRow[], filters: Filters) {
  const from = filters.from ? new Date(`${filters.from}T00:00:00`) : null;
  const to = filters.to ? new Date(`${filters.to}T23:59:59`) : null;
  return rows.filter((row) => {
    if (!matchesType(filters.patientType, row.patientType)) return false;
    if (filters.status === "paid" && !isPaid(row.status)) return false;
    if (from && row.date && row.date < from) return false;
    if (to && row.date && row.date > to) return false;
    return true;
  });
}

/** Source groups, in the fixed order (and color slot) they are always drawn in. */
export const SOURCE_GROUPS = [
  { key: "doctor", label: "Doctor referrals", color: "var(--s1)" },
  { key: "word", label: "Word of mouth (family, friends)", color: "var(--s2)" },
  { key: "digital", label: "Digital (Google, Facebook, website)", color: "var(--s3)" },
  { key: "walk", label: "Walk-by", color: "var(--s4)" },
  { key: "other", label: "Other sources", color: "var(--neutral)" },
  { key: "none", label: "No source recorded", color: "var(--neutral-soft)" },
] as const;
export type SourceGroupKey = (typeof SOURCE_GROUPS)[number]["key"];

export function sourceGroup(source: string): SourceGroupKey {
  const s = normalize(source);
  if (!s || /^(N\/?A|NONE|-+|NOT SPECIFIED|UNKNOWN)$/.test(s)) return "none";
  if (/FAMIL|RELATIVE|FRIEND|WORD|NEIGHBO|CO-?WORKER|COLLEAGUE|SPOUSE|PATIENT REFERRAL|KAKILALA/.test(s)) return "word";
  if (/DOCTOR|\bDRA?\b|PHYSICIAN|REFER|\bMD\b|\bOB\b|CARDIO/.test(s)) return "doctor";
  if (/GOOGLE|FACEBOOK|\bFB\b|WEB|ONLINE|INTERNET|SOCIAL|INSTAGRAM|TIKTOK|YOUTUBE|MESSENGER|VIBER|SEARCH|\bADS?\b|EMAIL|\bSMS\b/.test(s)) return "digital";
  if (/PASS|WALK|SIGNAGE|SIGN\b|BILLBOARD|NEARBY|DROVE|DRIVE/.test(s)) return "walk";
  return "other";
}
const DIGITAL_LABEL = "Google, Facebook or the website";

type Tone = "risk" | "watch" | "ok";
export type Finding = { tone: Tone; label: string; value: string; text: string };
export type Decision = { decision: string; why: string; measure: string };

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const listNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
const surname = (name: string) => {
  const parts = name.replace(/,?\s*(MD|M\.D\.|FPCP|FPCC|FPHA|DPBA)\b\.?/gi, "").replace(/^(DR\.?|DRA\.?)\s+/i, "").replace(/\b[A-Z]\.\s*/g, "").trim().split(/\s+/);
  return parts[parts.length - 1] || name;
};

export function analyzeSales(rows: SalesRow[]) {
  const patients = new Map<string, { source: string; revenue: number; category: string }>();
  const visits = new Set<string>();
  let revenue = 0, gross = 0, discount = 0;
  const dates: number[] = [];
  for (const row of rows) {
    const p = patients.get(row.patient) || { source: "", revenue: 0, category: "" };
    if (!p.source && row.source) p.source = row.source;
    if (!p.category && row.category) p.category = row.category;
    p.revenue += row.revenue;
    patients.set(row.patient, p);
    visits.add(row.transaction || `${row.patient}|${row.date ? dayKey(row.date) : ""}`);
    revenue += row.revenue; gross += row.gross; discount += row.discount;
    if (row.date) dates.push(row.date.getTime());
  }
  const minDate = dates.length ? new Date(Math.min(...dates)) : null;
  const maxDate = dates.length ? new Date(Math.max(...dates)) : null;
  const perPatient = Array.from(patients.values()).map((p) => p.revenue);

  // Sources: every patient is credited to the first source recorded for them, with all of their revenue.
  const sourceMap = new Map<string, { patients: number; revenue: number }>();
  const groupMap = new Map<SourceGroupKey, { patients: number; revenue: number }>();
  patients.forEach((p) => {
    const label = p.source || "No source recorded";
    const s = sourceMap.get(label) || { patients: 0, revenue: 0 };
    s.patients += 1; s.revenue += p.revenue; sourceMap.set(label, s);
    const key = sourceGroup(p.source);
    const g = groupMap.get(key) || { patients: 0, revenue: 0 };
    g.patients += 1; g.revenue += p.revenue; groupMap.set(key, g);
  });
  const sources = Array.from(sourceMap, ([source, v]) => ({ source, ...v, avg: v.revenue / v.patients, group: sourceGroup(source === "No source recorded" ? "" : source) })).sort((a, b) => b.revenue - a.revenue);
  const groups = SOURCE_GROUPS.map((g) => ({ ...g, ...(groupMap.get(g.key) || { patients: 0, revenue: 0 }) })).filter((g) => g.patients > 0);

  // Daily volume.
  const dayMap = new Map<string, { date: Date; patients: Set<string>; revenue: number }>();
  for (const row of rows) {
    if (!row.date) continue;
    const key = dayKey(row.date);
    const d = dayMap.get(key) || { date: new Date(row.date.getFullYear(), row.date.getMonth(), row.date.getDate()), patients: new Set<string>(), revenue: 0 };
    d.patients.add(row.patient); d.revenue += row.revenue; dayMap.set(key, d);
  }
  const days = Array.from(dayMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime()).map((d) => ({ date: d.date, label: shortDate(d.date), patients: d.patients.size, revenue: d.revenue }));

  // Service lines (falls back to individual tests when the report has no department column).
  const hasServiceLine = rows.some((r) => r.serviceLine);
  const serviceMap = new Map<string, number>();
  for (const row of rows) {
    const key = (hasServiceLine ? row.serviceLine : row.service.toUpperCase()) || "UNCLASSIFIED";
    serviceMap.set(key, (serviceMap.get(key) || 0) + row.revenue);
  }
  let services = Array.from(serviceMap, ([name, value]) => ({ name, revenue: value })).sort((a, b) => b.revenue - a.revenue);
  if (services.length > 8) {
    const rest = services.slice(7).reduce((sum, s) => sum + s.revenue, 0);
    services = [...services.slice(0, 7), { name: "OTHER", revenue: rest }];
  }

  // Patient categories (REGULAR, SENIOR, PWD …).
  const categoryMap = new Map<string, { patients: number; revenue: number }>();
  patients.forEach((p) => {
    if (!p.category) return;
    const c = categoryMap.get(p.category) || { patients: 0, revenue: 0 };
    c.patients += 1; c.revenue += p.revenue; categoryMap.set(p.category, c);
  });
  const categories = Array.from(categoryMap, ([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue);
  const statutory = (category: string) => /SENIOR|\bSC\b|PWD/.test(category);
  let statutoryDiscount = 0, otherDiscount = 0, statutoryGross = 0;
  const statutoryPatients = new Set<string>();
  for (const row of rows) {
    if (statutory(row.category)) { statutoryDiscount += row.discount; statutoryGross += row.gross; statutoryPatients.add(row.patient); }
    else otherDiscount += row.discount;
  }

  // Referring physicians. When sources are recorded, only doctor-referral patients count.
  const referralPatients = new Set<string>();
  patients.forEach((p, name) => { if (sourceGroup(p.source) === "doctor") referralPatients.add(name); });
  const physicianMap = new Map<string, { name: string; patients: Set<string>; revenue: number }>();
  for (const row of rows) {
    if (!row.physician) continue;
    if (referralPatients.size && !referralPatients.has(row.patient)) continue;
    const key = normalize(row.physician).replace(/[^A-Z ]/g, "").replace(/\b(DR|DRA|MD)\b/g, "").replace(/\s+/g, " ").trim();
    if (!key) continue;
    const ph = physicianMap.get(key) || { name: row.physician, patients: new Set<string>(), revenue: 0 };
    ph.patients.add(row.patient); ph.revenue += row.revenue; physicianMap.set(key, ph);
  }
  const physicians = Array.from(physicianMap.values()).map((p) => ({ name: p.name, patients: p.patients.size, revenue: p.revenue })).sort((a, b) => b.revenue - a.revenue);

  // Patient-type mix. A patient seen as two types in the period counts once in each.
  const typeMap = new Map<TypeGroup, { patients: Set<string>; visits: Set<string>; revenue: number }>();
  for (const row of rows) {
    const key = typeGroup(row.patientType);
    const t = typeMap.get(key) || { patients: new Set<string>(), visits: new Set<string>(), revenue: 0 };
    t.patients.add(row.patient); t.visits.add(row.transaction || `${row.patient}|${row.date ? dayKey(row.date) : ""}`); t.revenue += row.revenue;
    typeMap.set(key, t);
  }
  const types = TYPE_ROWS.map((t) => {
    const v = typeMap.get(t.key);
    return { ...t, patients: v?.patients.size || 0, visits: v?.visits.size || 0, revenue: v?.revenue || 0 };
  }).filter((t) => t.patients > 0);
  const returningPatients = new Set<string>();
  let returningRevenue = 0;
  RETURNING.forEach((key) => { const v = typeMap.get(key); if (v) { v.patients.forEach((name) => returningPatients.add(name)); returningRevenue += v.revenue; } });

  return {
    types, returning: { patients: returningPatients.size, revenue: returningRevenue },
    newPatients: typeMap.get("new")?.patients.size || 0,
    patients: patients.size, visits: visits.size, lineItems: rows.length, revenue, gross, discount,
    avgPerPatient: patients.size ? revenue / patients.size : 0, medianPerPatient: median(perPatient),
    minDate, maxDate, sources, groups, days, services, serviceLabel: hasServiceLine ? "service line" : "test / examination",
    categories, statutoryDiscount, otherDiscount, statutoryGross, statutoryPatients: statutoryPatients.size,
    physicians, referralRevenue: groupMap.get("doctor")?.revenue || 0, referralPatients: groupMap.get("doctor")?.patients || 0,
  };
}
export type SalesSummary = ReturnType<typeof analyzeSales>;

export function analyzeInquiries(rows: InquiryRow[]) {
  const booked = rows.filter((r) => r.booked).length;
  const served = rows.filter((r) => r.served).length;
  const followUps = rows.filter((r) => !r.booked || r.noShow);
  const channelMap = new Map<string, { inquiries: number; booked: number; served: number }>();
  const branchMap = new Map<string, number>();
  for (const r of rows) {
    const c = channelMap.get(r.channel) || { inquiries: 0, booked: 0, served: 0 };
    c.inquiries += 1; if (r.booked) c.booked += 1; if (r.served) c.served += 1;
    channelMap.set(r.channel, c);
    branchMap.set(r.branch, (branchMap.get(r.branch) || 0) + 1);
  }
  const dates = rows.map((r) => r.date?.getTime()).filter((t): t is number => typeof t === "number");
  const priceMentions = followUps.filter((r) => /PRICE|FEE|COST|RATE|MAHAL|EXPENSIVE|HOW MUCH|MAGKANO/i.test(`${r.remarks} ${r.status}`)).length;
  return {
    inquiries: rows.length, booked, served, followUps, priceMentions,
    channels: Array.from(channelMap, ([channel, v]) => ({ channel, ...v })).sort((a, b) => b.inquiries - a.inquiries),
    branches: Array.from(branchMap, ([branch, inquiries]) => ({ branch, inquiries })).sort((a, b) => b.inquiries - a.inquiries),
    minDate: dates.length ? new Date(Math.min(...dates)) : null,
    maxDate: dates.length ? new Date(Math.max(...dates)) : null,
  };
}
export type InquirySummary = ReturnType<typeof analyzeInquiries>;

/** Plain-language findings for the CEO briefing, each computed from the uploaded data. */
export function buildFindings(s: SalesSummary, q: InquirySummary | null): Finding[] {
  const findings: Finding[] = [];
  const top3 = s.physicians.slice(0, 3);
  if (top3.length >= 2 && s.revenue > 0) {
    const value = top3.reduce((sum, p) => sum + p.revenue, 0);
    const share = value / s.revenue;
    findings.push({
      tone: share >= 0.25 ? "risk" : "watch", label: "Concentration risk", value: pct(share),
      text: `of all revenue (${peso(value)}) came from just ${top3.length} referring physicians: ${listNames(top3.map((p) => surname(p.name)))}. ${share >= 0.25 ? "Losing one would be felt immediately." : "Referrals are reasonably spread."}`,
    });
  }
  const digital = s.groups.find((g) => g.key === "digital");
  if (s.patients) {
    const best = s.sources.filter((src) => src.group === "digital").sort((a, b) => b.avg - a.avg)[0];
    findings.push({
      tone: "watch", label: digital ? "Digital channels" : "No digital patients", value: `${count(digital?.patients || 0)} of ${count(s.patients)}`,
      text: digital
        ? `patients came from ${DIGITAL_LABEL} (${pct(digital.revenue / s.revenue)} of revenue).${best ? ` ${best.source} patients spent ${peso(best.avg)} each vs. ${peso(s.avgPerPatient)} overall${best.patients < 5 ? `, but ${best.patients} patient${best.patients === 1 ? " is" : "s are"} too few to call it a trend` : ""}.` : ""}`
        : `No patient in this period listed ${DIGITAL_LABEL} as their source.`,
    });
  }
  if (s.discount > 0) {
    const otherShare = s.gross ? s.otherDiscount / s.gross : 0;
    const statutoryRate = s.statutoryGross ? s.statutoryDiscount / s.statutoryGross : 0;
    findings.push({
      tone: otherShare > 0.02 ? "watch" : "ok", label: otherShare > 0.02 ? "Discretionary discounts" : s.otherDiscount > 0 ? "Discounts mostly statutory" : "Discounts are statutory", value: peso(s.discount),
      text: s.statutoryPatients
        ? `in discounts, ${pct(s.discount / s.gross)} of gross ${peso(s.gross)}. ${peso(s.statutoryDiscount)} went to ${count(s.statutoryPatients)} senior and PWD patients (${pct(statutoryRate)} off their bills)${s.otherDiscount > 0 ? `; ${peso(s.otherDiscount)} went to other patients and should have an approval trail.` : ". No discretionary discounting shows up in this period."}`
        : `in discounts, ${pct(s.discount / s.gross)} of gross ${peso(s.gross)}. Add a patient category column to separate senior/PWD discounts from discretionary ones.`,
    });
  }
  if (s.services.length >= 2 && s.revenue > 0) {
    const [a, b] = s.services;
    findings.push({
      tone: "ok", label: "Service mix", value: pct((a.revenue + b.revenue) / s.revenue),
      text: `of revenue came from ${titleCase(a.name)} (${peso(a.revenue)}) and ${titleCase(b.name)} (${peso(b.revenue)}). These are the services patients come in for.`,
    });
  }
  if (s.days.length >= 3) {
    const counts = s.days.map((d) => d.patients);
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const peaks = s.days.filter((d) => d.patients >= avg * 1.5);
    const peakDays = new Set(peaks.map((d) => weekday(d.date)));
    findings.push({
      tone: "watch", label: "Uneven days", value: `${Math.min(...counts)} – ${Math.max(...counts)}`,
      text: `patients a day (average ${avg.toFixed(1)}).${peaks.length ? ` Busiest: ${listNames(peaks.slice(0, 4).map((d) => `${d.label} (${d.patients})`))}.${peaks.length > 1 && peakDays.size === peaks.length ? " They fell on different weekdays, so the cause is still unknown." : ""}` : " Volume was fairly even."}`,
    });
  }
  if (q) {
    findings.push({
      tone: q.followUps.length ? "risk" : "ok", label: "Leads waiting", value: count(q.followUps.length),
      text: q.followUps.length
        ? `concierge leads need follow-up (${count(q.followUps.filter((r) => !r.booked).length)} never booked, ${count(q.followUps.filter((r) => r.noShow).length)} no-show). Confirm each one was closed.`
        : "open concierge leads. Every inquiry in the log was booked and attended.",
    });
  }
  if (s.newPatients && s.returning.patients && s.revenue) {
    const share = s.returning.revenue / s.revenue;
    findings.push({
      tone: "ok", label: "New vs. returning", value: `${count(s.newPatients)} / ${count(s.returning.patients)}`,
      text: `new vs. returning patients (Scheduled, Walk-in, HMO). Returning patients brought ${pct(share)} of revenue (${peso(s.returning.revenue)}); new patients ${pct((s.types.find((t) => t.key === "new")?.revenue || 0) / s.revenue)}.`,
    });
  }
  const none = s.groups.find((g) => g.key === "none");
  if (none && none.patients / s.patients >= 0.05) {
    findings.push({ tone: "watch", label: "Source missing", value: pct(none.patients / s.patients, 0), text: `of patients (${count(none.patients)}) have no source recorded, so their revenue can't be credited to a channel.` });
  }
  return findings;
}

/** Suggested decisions for the next leadership meeting. Marketing spend and acquisition cost live in the acquisition dashboard. */
export function buildDecisions(s: SalesSummary, q: InquirySummary | null): Decision[] {
  const decisions: Decision[] = [];
  const top = s.physicians.slice(0, 8);
  if (top.length >= 3 && s.referralRevenue > 0) {
    const value = top.reduce((sum, p) => sum + p.revenue, 0);
    decisions.push({
      decision: top.length < s.physicians.length ? `Assign a physician-relations owner for the top ${top.length} referring doctors` : `Assign a physician-relations owner for the ${top.length} referring doctors`,
      why: top.length < s.physicians.length
        ? `They produced ${peso(value)}, which is ${pct(value / s.referralRevenue)} of referral revenue and ${pct(value / s.revenue)} of all revenue.`
        : `Together they produced ${peso(value)}, ${pct(value / s.revenue)} of all revenue.`,
      measure: `Referral revenue holds at or above ${peso(s.referralRevenue)}; no top-${top.length} doctor drops off`,
    });
  }
  const billed = s.newPatients || s.patients;
  if (!q || q.inquiries < billed * 0.5) {
    decisions.push({
      decision: "Make concierge logging mandatory for every inquiry, at every branch",
      why: q ? `Only ${count(q.inquiries)} inquiries were logged against ${count(billed)} ${s.newPatients ? "new " : ""}patients billed. Conversion rates need real volume before they mean anything.` : "No concierge log was uploaded, so the dashboard can't see inquiries that never became paying patients.",
      measure: "Inquiries logged ≈ patients billed, with every branch reporting",
    });
  }
  if (s.days.length >= 3) {
    const avg = s.days.reduce((sum, d) => sum + d.patients, 0) / s.days.length;
    const peaks = s.days.filter((d) => d.patients >= avg * 1.5).sort((a, b) => b.patients - a.patients).slice(0, 3);
    if (peaks.length) {
      decisions.push({
        decision: `Find out what drove ${listNames(peaks.map((d) => d.label))}`,
        why: `${peaks.length === 1 ? "It" : "Each"} had ${listNames(peaks.map((d) => String(d.patients)))} patients against a daily average of ${avg.toFixed(1)}. Whatever caused it may be repeatable.`,
        measure: "Cause identified (campaign, referral batch or doctor schedule)",
      });
    }
  }
  if (q && q.followUps.length) {
    decisions.push({
      decision: `Close the ${count(q.followUps.length)} open concierge lead${q.followUps.length === 1 ? "" : "s"} and track why leads are lost`,
      why: q.priceMentions ? `${count(q.priceMentions)} of them mentioned price or fees. If this keeps happening, it is a pricing or communication issue, not a channel issue.` : "Lost-lead reasons are the cheapest way to learn why inquiries don't convert.",
      measure: "Lost-lead reasons tallied; share citing price",
    });
  }
  if (s.gross && s.otherDiscount / s.gross > 0.02) {
    decisions.push({
      decision: "Require approval for discounts outside senior and PWD",
      why: `${peso(s.otherDiscount)} (${pct(s.otherDiscount / s.gross)} of gross) was discounted for patients who are not senior or PWD.`,
      measure: "Discretionary discounts below 2% of gross, each with an approver",
    });
  }
  const none = s.groups.find((g) => g.key === "none");
  if (none && none.patients / s.patients >= 0.05) {
    decisions.push({
      decision: "Make the Source field mandatory at registration",
      why: `${count(none.patients)} patients (${peso(none.revenue)}) have no source, so their revenue can't be credited to a channel.`,
      measure: "No-source patients below 2%",
    });
  }
  return decisions.slice(0, 5);
}

export const titleCase = (value: string) => value.toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase()).replace(/\b(Ecg|Ct|Mri|Hmo|Pwd|Ob|2d)\b/g, (m) => m.toUpperCase());
