import type { PatientTypeFilter, StatusFilter } from "./analyze";
import { isPaid, matchesType, sourceGroup, typeGroup } from "./analyze";
import type { SalesRow } from "./parse";
import { normalize } from "./parse";

/**
 * Patient acquisition cost, from the same sales report rows as the Sales Dashboard (it used to be the
 * separate THSC Patient Acquisition Dashboard). Marketing spend is entered per date range and divided by
 * the new patients (NEW and HMO/NEW) of that range; only new patients carry a source.
 */
export type AcquisitionFilters = { patientType: PatientTypeFilter; status: StatusFilter; from: string; to: string };

/** Marketing spend for one date range ("" = from the first / to the last uploaded date). */
export type AcquisitionSpend = { from: string; to: string; total: number; bySource: Record<string, number>; updatedAt?: Date };
export const spendKey = (from: string, to: string) => `${from || "start"}|${to || "end"}`;

/** Rows of the "Patients by type" table, in the old dashboard's order; Returning is the roll-up. */
export const ACQ_TYPES: { key: Exclude<PatientTypeFilter, "all">; label: string; includes: string; parts?: { label: string; test: (raw: string) => boolean; optional?: boolean }[] }[] = [
  { key: "new", label: "NEW", includes: "NEW and HMO/NEW patients", parts: [
    { label: "NEW", test: (raw) => typeGroup(raw) === "new" && !/HMO/.test(normalize(raw)) },
    { label: "HMO/NEW", test: (raw) => typeGroup(raw) === "new" && /HMO/.test(normalize(raw)) },
  ] },
  { key: "scheduled", label: "SCHEDULED", includes: "Returning scheduled patients" },
  { key: "walkin", label: "WALK-IN", includes: "Returning walk-in patients" },
  { key: "returning", label: "RETURNING PATIENTS", includes: "SCHEDULED, WALK-IN and HMO", parts: [
    { label: "SCHEDULED", test: (raw) => typeGroup(raw) === "scheduled" },
    { label: "WALK-IN", test: (raw) => typeGroup(raw) === "walkin" },
    { label: "HMO", test: (raw) => typeGroup(raw) === "hmo" },
    { label: "other returning", test: (raw) => typeGroup(raw) === "returning", optional: true },
  ] },
  { key: "home", label: "HOME SERVICE", includes: "Home service patients" },
  { key: "sendin", label: "SEND-IN", includes: "Send-in patients" },
  { key: "trial", label: "CLINICAL TRIAL", includes: "Clinical trial patients" },
];

const visitKey = (r: SalesRow) => r.transaction || `${r.patient}|${r.date ? r.date.toDateString() : ""}`;

function summarize(rows: SalesRow[]) {
  const patients = new Set<string>(), visits = new Set<string>();
  let revenue = 0;
  for (const r of rows) { patients.add(r.patient); visits.add(visitKey(r)); revenue += r.revenue; }
  return { patients: patients.size, transactions: visits.size, revenue, rows };
}

export function analyzeAcquisition(all: SalesRow[], f: AcquisitionFilters) {
  const from = f.from ? new Date(`${f.from}T00:00:00`) : null;
  const to = f.to ? new Date(`${f.to}T23:59:59`) : null;
  // Date range and status apply to everything on the tab; the patient type only to the cards.
  const base = all.filter((r) => (f.status === "all" || isPaid(r.status)) && (!from || !r.date || r.date >= from) && (!to || !r.date || r.date <= to));
  const selected = summarize(base.filter((r) => matchesType(f.patientType, r.patientType)));
  const total = summarize(base);
  const types = ACQ_TYPES.map((t) => {
    const rows = base.filter((r) => matchesType(t.key, r.patientType));
    const s = summarize(rows);
    // Each patient counts once, under the type of their first visit in the range, so the parts add up to the total.
    const firstType = new Map<string, string>();
    [...rows].sort((x, y) => (x.date?.getTime() || 0) - (y.date?.getTime() || 0)).forEach((r) => { if (!firstType.has(r.patient)) firstType.set(r.patient, r.patientType); });
    const parts = t.parts?.map((p) => ({ label: p.label, optional: p.optional, patients: Array.from(firstType.values()).filter((raw) => p.test(raw)).length }))
      .filter((p) => !p.optional || p.patients > 0);
    return { ...t, ...s, parts };
  });

  // New patients and the source each one gave first, with all of their revenue in the range.
  const newRows = base.filter((r) => typeGroup(r.patientType) === "new");
  const people = new Map<string, { source: string; revenue: number }>();
  for (const r of newRows) {
    const p = people.get(r.patient) || { source: "", revenue: 0 };
    if (!p.source && sourceGroup(r.source) !== "none") p.source = r.source.trim();
    p.revenue += r.revenue;
    people.set(r.patient, p);
  }
  const sourceMap = new Map<string, { patients: number; revenue: number; names: Set<string> }>();
  let noSource = 0;
  people.forEach((p, name) => {
    if (!p.source) { noSource += 1; return; }
    const s = sourceMap.get(p.source) || { patients: 0, revenue: 0, names: new Set<string>() };
    s.patients += 1; s.revenue += p.revenue; s.names.add(name);
    sourceMap.set(p.source, s);
  });
  const sources = Array.from(sourceMap, ([source, s]) => ({ source, patients: s.patients, revenue: s.revenue, rows: newRows.filter((r) => s.names.has(r.patient)) }))
    .sort((a, b) => b.patients - a.patients || b.revenue - a.revenue);

  const times = base.map((r) => r.date?.getTime()).filter((t): t is number => typeof t === "number");
  return {
    selected, total, types, sources, noSource,
    newPatients: people.size, newRows,
    period: times.length ? { from: new Date(Math.min(...times)), to: new Date(Math.max(...times)) } : null,
  };
}
export type AcquisitionSummary = ReturnType<typeof analyzeAcquisition>;
