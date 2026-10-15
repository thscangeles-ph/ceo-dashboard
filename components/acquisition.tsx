"use client";

import { useMemo, useState } from "react";
import { FileSpreadsheet, MousePointerClick, Plus } from "lucide-react";
import { RankedBars } from "@/components/charts";
import { clickable, useDrill } from "@/components/drill";
import type { AcquisitionFilters, AcquisitionSpend } from "@/lib/acquisition";
import { ACQ_TYPES, analyzeAcquisition, spendKey } from "@/lib/acquisition";
import { count, isPaid, longDate, patientTypeInfo, peso } from "@/lib/analyze";
import type { SalesRow } from "@/lib/parse";
import { PdfButton } from "@/components/pdf-button";
import { acquisitionReport } from "@/lib/reports";

const exact = (v: number) => `₱${v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const toInput = (d: Date | null | undefined) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "");

/** A peso amount that saves when you leave the box or press Enter. */
function SpendInput({ value, label, disabled, onCommit, wide = false }: { value: number; label: string; disabled: boolean; onCommit: (v: number) => void; wide?: boolean }) {
  const [draft, setDraft] = useState(value ? String(value) : "");
  const commit = () => {
    const next = Math.max(0, Number(draft.replace(/[₱,\s]/g, "")) || 0);
    setDraft(next ? String(next) : "");
    if (next !== value) onCommit(next);
  };
  return (
    <span className={`peso-input${wide ? " wide" : ""}`}>
      <span aria-hidden>₱</span>
      <input inputMode="decimal" aria-label={label} placeholder="0.00" value={draft} disabled={disabled}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    </span>
  );
}

/**
 * The Patient Acquisition Cost tab: what it costs to bring in each new patient, from the uploaded sales
 * reports and the marketing spend entered here (saved per date range, shared with the team).
 */
export function AcquisitionDashboard({ rows, spends, canEdit, onSaveSpend, onAddSales, files }: {
  rows: SalesRow[]; spends: AcquisitionSpend[]; canEdit: boolean;
  onSaveSpend: (spend: AcquisitionSpend) => Promise<void>; onAddSales?: () => void;
  /** The team's sales report files panel. */
  files?: React.ReactNode;
}) {
  const drill = useDrill();
  const hasPaid = useMemo(() => rows.some((r) => isPaid(r.status)), [rows]);
  const [filters, setFilters] = useState<AcquisitionFilters>({ patientType: "new", status: hasPaid ? "paid" : "all", from: "", to: "" });
  const [saving, setSaving] = useState<"" | "saving" | "saved">("");
  const [error, setError] = useState("");
  const a = useMemo(() => analyzeAcquisition(rows, filters), [rows, filters]);
  const set = <K extends keyof AcquisitionFilters>(key: K, value: AcquisitionFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const times = useMemo(() => rows.map((r) => r.date?.getTime()).filter((t): t is number => typeof t === "number"), [rows]);
  const minDate = times.length ? new Date(Math.min(...times)) : null, maxDate = times.length ? new Date(Math.max(...times)) : null;

  const rangeKey = spendKey(filters.from, filters.to);
  const spend = spends.find((s) => spendKey(s.from, s.to) === rangeKey) || { from: filters.from, to: filters.to, total: 0, bySource: {} };
  const allocated = Object.values(spend.bySource).reduce((sum, v) => sum + (v || 0), 0);
  const save = async (next: AcquisitionSpend) => {
    setSaving("saving"); setError("");
    try { await onSaveSpend({ ...next, updatedAt: new Date() }); setSaving("saved"); } catch (e) { setError((e as Error).message); setSaving(""); }
  };
  const open = (title: string, list: SalesRow[], subtitle?: string) => drill({ kind: "sales", title, subtitle, rows: list });

  const type = filters.patientType === "all" ? null : ACQ_TYPES.find((t) => t.key === filters.patientType)!;
  const typeLabel = type ? type.label : "ALL PATIENT TYPES";
  const selectedRow = a.types.find((t) => t.key === filters.patientType);
  const breakdown = (parts?: { label: string; patients: number }[]) => parts?.map((p) => `${count(p.patients)} ${p.label}`).join(" · ");
  const rangeText = filters.from || filters.to
    ? `${filters.from ? longDate(new Date(`${filters.from}T00:00:00`)) : "first date"} – ${filters.to ? longDate(new Date(`${filters.to}T00:00:00`)) : "last date"}`
    : "all uploaded dates";
  const costPerNew = a.newPatients && spend.total ? spend.total / a.newPatients : 0;

  return (
    <>
      <header className="top">
        <div>
          <h1>Patient Acquisition Cost</h1>
          <p className="sub">What it costs to bring in each new patient: the uploaded sales reports and the marketing spend entered here</p>
          {rows.length > 0 && (
            <div className="crm-actions no-print">
              <PdfButton make={() => acquisitionReport(a, spend, {
                typeLabel, selectedNote: (selectedRow && breakdown(selectedRow.parts)) || type?.includes || "Across all patient types",
                filters: [`Patient type: ${typeLabel}`, hasPaid ? `Status: ${filters.status === "paid" ? "PAID only" : "all statuses"}` : "", `Dates: ${rangeText}`].filter(Boolean).join(" · "),
              })} />
            </div>
          )}
        </div>
        <div className="period">
          Reporting period<br /><strong>{a.period ? `${longDate(a.period.from)} – ${longDate(a.period.to)}` : rows.length ? "No rows in this range" : "No sales report yet"}</strong>
          <div className="filters-note">Patient type: {typeLabel}{hasPaid ? ` · Status: ${filters.status === "paid" ? "PAID" : "All"}` : ""}</div>
        </div>
      </header>

      {files}

      {!rows.length ? (files ? null :
        <div className="panel empty-tab">
          <h3><FileSpreadsheet size={16} />No sales report added yet</h3>
          <p className="empty-note">Acquisition cost is worked out from the Detailed Sales Report. {onAddSales ? "Add the team's sales report here, then enter the marketing spend." : "An Admin, ManCom or Doctors account adds it."}</p>
          {onAddSales && <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={onAddSales}><Plus size={16} />Add sales report</button>}
        </div>
      ) : (
        <>
          <div className="filterbar no-print">
            <label>Patient type
              <select value={filters.patientType} onChange={(e) => set("patientType", e.target.value as AcquisitionFilters["patientType"])}>
                {ACQ_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                <option value="all">ALL PATIENT TYPES</option>
              </select>
            </label>
            {hasPaid && <label>Status<select value={filters.status} onChange={(e) => set("status", e.target.value as AcquisitionFilters["status"])}><option value="paid">Paid only</option><option value="all">All statuses</option></select></label>}
            <label>From<input type="date" value={filters.from} min={toInput(minDate)} max={toInput(maxDate)} onChange={(e) => set("from", e.target.value)} /></label>
            <label>To<input type="date" value={filters.to} min={toInput(minDate)} max={toInput(maxDate)} onChange={(e) => set("to", e.target.value)} /></label>
            <label>Total marketing spend (PHP)
              <SpendInput key={`${rangeKey}|total|${spend.total}`} wide value={spend.total} label="Total marketing spend" disabled={!canEdit}
                onCommit={(total) => void save({ ...spend, total })} />
            </label>
          </div>
          <p className="click-hint no-print">
            <MousePointerClick size={15} aria-hidden />Spend is saved for {rangeText}{canEdit ? "; pick a date range first to enter a month's spend" : " (read-only)"}.
            {saving === "saving" ? " Saving…" : saving === "saved" ? " Saved for the whole team." : ""}
          </p>
          {error && <div className="alert" role="alert"><div>{error}</div></div>}

          <div className="kpis four">
            <div className="kpi is-clickable" {...clickable(() => open(`Patients · ${typeLabel}`, a.selected.rows), "Unique patients: details")}>
              <div className="label">Unique patients · {type ? patientTypeInfo(type.key).short : "All"}</div>
              <div className="value">{count(a.selected.patients)}</div>
              <div className="note">{(selectedRow && breakdown(selectedRow.parts)) || type?.includes || "Across all patient types"}</div>
            </div>
            <div className="kpi"><div className="label">Transactions</div><div className="value">{count(a.selected.transactions)}</div><div className="note">Unique transaction numbers</div></div>
            <div className="kpi"><div className="label">Patient revenue</div><div className="value">{peso(a.selected.revenue)}</div><div className="note">Sum of Total Payment</div></div>
            <div className="kpi accent">
              <div className="label">Acquisition cost / new patient</div>
              <div className="value">{costPerNew ? exact(costPerNew) : "—"}</div>
              <div className="note">{spend.total ? `${exact(spend.total)} ÷ ${count(a.newPatients)} new patients` : "Enter the total marketing spend"}</div>
            </div>
          </div>

          <section>
            <h2>Patients by type</h2>
            <p className="section-note">Unique patients, transactions and revenue for each patient type. Click a row to show that type in the cards above.</p>
            <div className="panel">
              <div className="table-scroll">
                <table className="acq-types">
                  <tbody>
                    <tr><th>Patient type</th><th>Includes</th><th className="num">Unique patients</th><th className="num">Transactions</th><th className="num">Revenue</th><th className="num">Share of revenue</th></tr>
                    {a.types.map((t) => (
                      <tr key={t.key} className={`is-clickable${filters.patientType === t.key ? " selected" : ""}${t.key === "returning" ? " rollup" : ""}`} {...clickable(() => set("patientType", t.key), `Show ${t.label}`)}>
                        <td className="name">{t.label}</td>
                        <td className="name muted">{breakdown(t.parts) || t.includes}</td>
                        <td className="num">{count(t.patients)}</td><td className="num">{count(t.transactions)}</td><td className="num">{peso(t.revenue)}</td>
                        <td className="num">{a.total.revenue ? `${((t.revenue / a.total.revenue) * 100).toFixed(1)}%` : "—"}</td>
                      </tr>
                    ))}
                    <tr className={`is-clickable total${filters.patientType === "all" ? " selected" : ""}`} {...clickable(() => set("patientType", "all"), "Show all patient types")}>
                      <td className="name">ALL PATIENT TYPES</td><td className="name muted">Each patient counted once</td>
                      <td className="num">{count(a.total.patients)}</td><td className="num">{count(a.total.transactions)}</td><td className="num">{peso(a.total.revenue)}</td><td className="num">{a.total.revenue ? "100%" : "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section>
            <h2>Acquisition sources</h2>
            <p className="section-note">Only NEW and HMO/NEW patients are asked where they learned about the clinic, so sources cover new patients whatever the patient type above. Each new patient counts once, under the first source they gave.{a.noSource ? ` ${count(a.noSource)} new patient${a.noSource === 1 ? " has" : "s have"} no source recorded and ${a.noSource === 1 ? "is" : "are"} left out of the source figures.` : ""}</p>
            <div className="grid-2 acq-grid">
              <div className="panel">
                <h3>New patients by acquisition source</h3>
                {a.sources.length ? <RankedBars label="New patients by source" color="var(--s2)" format={(v) => `${count(v)} patient${v === 1 ? "" : "s"}`}
                  items={a.sources.slice(0, 10).map((s) => ({ name: s.source, value: s.patients, note: peso(s.revenue) }))}
                  onSelect={(name) => { const s = a.sources.find((x) => x.source === name); if (s) open(`New patients from ${name}`, s.rows, "Acquisition source"); }} />
                  : <p className="empty-note">No new patients with a source in this range.</p>}
              </div>
              <div className="panel">
                <div className="queue-head">
                  <h3>Cost by acquisition source</h3>
                  {spend.total > 0 && <span className={`alloc${Math.abs(spend.total - allocated) < 0.01 ? " ok" : ""}`}>Allocated {exact(allocated)} of {exact(spend.total)}</span>}
                </div>
                <p className="drill-meta" style={{ marginTop: 0 }}>Enter the spend for each source to see its cost per new patient.</p>
                <div className="table-scroll acq-sources">
                  <table>
                    <tbody>
                      <tr><th>Source</th><th className="num">New patients</th><th className="num">Revenue</th><th className="num">Spend (PHP)</th><th className="num">Cost / patient</th></tr>
                      {a.sources.map((s) => {
                        const v = spend.bySource[s.source] || 0;
                        return (
                          <tr key={s.source}>
                            <td className="name">{s.source}</td><td className="num">{count(s.patients)}</td><td className="num">{peso(s.revenue)}</td>
                            <td className="num"><SpendInput key={`${rangeKey}|${s.source}|${v}`} value={v} label={`Spend for ${s.source}`} disabled={!canEdit}
                              onCommit={(amount) => void save({ ...spend, bySource: { ...spend.bySource, [s.source]: amount } })} /></td>
                            <td className="num strong">{v ? exact(v / s.patients) : "—"}</td>
                          </tr>
                        );
                      })}
                      {!a.sources.length && <tr><td colSpan={5} className="empty-note">Source results appear once the sales report has new patients with a source.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
          <footer className="source">Counting rule: one unique Patient Name equals one patient. Only new patients (NEW and HMO/NEW) have a source. RETURNING PATIENTS combines SCHEDULED, WALK-IN and HMO. Patient names are only used for counting and are never shown.</footer>
        </>
      )}
    </>
  );
}
