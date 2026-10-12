"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Save, Trash2, X } from "lucide-react";
import type { LeadState } from "@/lib/lead";
import { LEAD_STATES } from "@/lib/lead";
import type { InquiryRow } from "@/lib/parse";
import type { InquiryForm } from "@/lib/tracker";
import { emptyForm, formFromRow, LOST_REASONS, PAYMENT_MODES, rowFromForm, toDateInput } from "@/lib/tracker";

/** Opens the inquiry form: with a row to update it, without one to log a new inquiry. */
const EditorContext = createContext<((row?: InquiryRow) => void) | null>(null);
export const EditorProvider = EditorContext.Provider;
export const useInquiryEditor = () => useContext(EditorContext);

const OUTCOME_HELP: Record<LeadState, string> = {
  open: "Not booked yet. Set when to follow up.",
  booked: "Booked, appointment not done yet.",
  served: "Came in and was served.",
  noShow: "Booked but did not come. Set when to call back.",
  cancelled: "Booking was cancelled.",
  lost: "Closed, no further follow-up.",
};

export function InquiryEditor({ row, isNew, rows, onSave, onDelete, onClose }: {
  row: InquiryRow | null; isNew: boolean; rows: InquiryRow[];
  onSave: (row: InquiryRow, base?: InquiryRow) => void; onDelete: (row: InquiryRow) => void; onClose: () => void;
}) {
  const [form, setForm] = useState<InquiryForm>(() => (row ? formFromRow(row) : emptyForm()));
  const [error, setError] = useState("");
  const firstRef = useRef<HTMLSelectElement>(null);
  const options = useMemo(() => {
    const unique = (pick: (r: InquiryRow) => string) => Array.from(new Set(rows.map(pick).filter((v) => v && v !== "Not recorded"))).sort();
    return { channels: unique((r) => r.channel), branches: unique((r) => r.branch), procedures: unique((r) => r.procedure), staff: unique((r) => r.staff), referrers: unique((r) => r.referredBy), campaigns: unique((r) => r.campaign) };
  }, [rows]);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const set = <K extends keyof InquiryForm>(key: K, value: InquiryForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setOutcome = (outcome: LeadState) => setForm((f) => {
    const today = toDateInput(new Date());
    const booked = ["booked", "served", "noShow", "cancelled"].includes(outcome);
    return { ...f, outcome, bookedDate: booked && !f.bookedDate ? today : f.bookedDate };
  });
  const booked = ["booked", "served", "noShow", "cancelled"].includes(form.outcome);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.patient.trim()) { setError("Enter the patient's name."); return; }
    if (!form.date) { setError("Enter the inquiry date."); return; }
    if (form.outcome === "lost" && !form.lostReason && !form.action.trim()) { setError("Choose why the lead was lost."); return; }
    onSave(rowFromForm(form, row || undefined), row || undefined);
  };

  const list = (id: string, values: string[]) => <datalist id={id}>{values.map((v) => <option key={v} value={v} />)}</datalist>;

  return (
    <div className="drill-overlay no-print" onClick={onClose}>
      <aside className="drill editor" role="dialog" aria-modal="true" aria-labelledby="editor-title" onClick={(e) => e.stopPropagation()}>
        <div className="drill-head">
          <div>
            <span className="tag">{isNew ? "New inquiry" : "Update inquiry"}</span>
            <h2 id="editor-title">{isNew ? "Log a patient inquiry" : form.patient || "Inquiry"}</h2>
            <p className="drill-meta">Saved on this device right away. Use Export tracker to update the Excel file.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <form className="drill-body editor-form" onSubmit={submit}>
          <fieldset>
            <legend>Inquiry</legend>
            <div className="field-grid">
              <label>New or returning<select ref={firstRef} value={form.patientStatus} onChange={(e) => set("patientStatus", e.target.value as InquiryForm["patientStatus"])}><option value="New">New</option><option value="Returning">Returning</option><option value="">Not recorded</option></select></label>
              <label>Date<input type="date" required value={form.date} onChange={(e) => set("date", e.target.value)} /></label>
              <label>Time<input type="time" value={form.time} onChange={(e) => set("time", e.target.value)} /></label>
              <label>Channel / source<input list="ed-channels" value={form.channel} placeholder="Viber, Doctor's Referral…" onChange={(e) => set("channel", e.target.value)} /></label>
              <label className="wide">Name<input required value={form.patient} autoComplete="off" onChange={(e) => set("patient", e.target.value)} /></label>
              <label>Contact number<input type="tel" value={form.contact} placeholder="09xx-xxx-xxxx" onChange={(e) => set("contact", e.target.value)} /></label>
              <label>Branch<input list="ed-branches" value={form.branch} onChange={(e) => set("branch", e.target.value)} /></label>
              <label className="wide">Procedure / test<input list="ed-procedures" value={form.procedure} onChange={(e) => set("procedure", e.target.value)} /></label>
              <label className="full">Inquired (what the patient asked)<textarea rows={2} value={form.inquired} onChange={(e) => set("inquired", e.target.value)} /></label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Outcome</legend>
            <div className="outcome-picker" role="radiogroup" aria-label="Outcome">
              {LEAD_STATES.map((s) => (
                <label key={s.key} className={form.outcome === s.key ? "on" : ""}>
                  <input type="radio" name="outcome" value={s.key} checked={form.outcome === s.key} onChange={() => setOutcome(s.key)} />
                  <i style={{ background: s.color }} />{s.label}
                </label>
              ))}
            </div>
            <p className="drill-meta">{OUTCOME_HELP[form.outcome]}</p>
            <div className="field-grid">
              {booked && <label>Booked on<input type="date" value={form.bookedDate} onChange={(e) => set("bookedDate", e.target.value)} /></label>}
              {booked && <label>Appointment date<input type="date" value={form.appointmentDate} onChange={(e) => set("appointmentDate", e.target.value)} /></label>}
              {booked && <label>Reminder sent on<input type="date" value={form.reminderDate} onChange={(e) => set("reminderDate", e.target.value)} /></label>}
              {booked && <label>Reminder via<input list="ed-reminders" value={form.reminderMethod} onChange={(e) => set("reminderMethod", e.target.value)} /></label>}
              {(form.outcome === "open" || form.outcome === "noShow") && <label>Follow up on<input type="date" value={form.followUpDate} onChange={(e) => set("followUpDate", e.target.value)} /></label>}
              {form.outcome === "served" && <label>Revenue (₱)<input inputMode="decimal" value={form.revenue} placeholder="0" onChange={(e) => set("revenue", e.target.value)} /></label>}
              {form.outcome === "served" && <label>Mode of payment<input list="ed-payments" value={form.payment} onChange={(e) => set("payment", e.target.value)} /></label>}
              {form.outcome === "lost" && <label className="wide">Reason lost<select value={form.lostReason} onChange={(e) => set("lostReason", e.target.value)}><option value="">Choose…</option>{LOST_REASONS.map((r) => <option key={r}>{r}</option>)}</select></label>}
              <label className="full">Next step / action taken<textarea rows={2} value={form.action} placeholder="Follow up regarding preferred schedule…" onChange={(e) => set("action", e.target.value)} /></label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Tracking (optional)</legend>
            <div className="field-grid">
              <label>Handled by (staff)<input list="ed-staff" value={form.staff} onChange={(e) => set("staff", e.target.value)} /></label>
              <label>First reply date<input type="date" value={form.respondedDate} onChange={(e) => set("respondedDate", e.target.value)} /></label>
              <label>First reply time<input type="time" value={form.respondedTime} onChange={(e) => set("respondedTime", e.target.value)} /></label>
              <label>Referred by<input list="ed-referrers" value={form.referredBy} placeholder="Doctor, clinic or company" onChange={(e) => set("referredBy", e.target.value)} /></label>
              <label className="wide">Campaign<input list="ed-campaigns" value={form.campaign} placeholder="e.g. Heart Month FB ad" onChange={(e) => set("campaign", e.target.value)} /></label>
            </div>
          </fieldset>

          {list("ed-channels", Array.from(new Set([...options.channels, "Doctor's Referral", "Facebook Messenger", "Viber", "Call", "SMS", "Walk-in", "Google Search", "Website Inquiry", "Family/Relatives", "Friends", "Passed By"])).sort())}
          {list("ed-branches", Array.from(new Set([...options.branches, "Angeles", "Malolos"])).sort())}
          {list("ed-procedures", options.procedures)}
          {list("ed-payments", PAYMENT_MODES)}
          {list("ed-reminders", ["SMS Reminder", "Call Reminder", "Viber Reminder", "Messenger Reminder"])}
          {list("ed-staff", options.staff)}
          {list("ed-referrers", options.referrers)}
          {list("ed-campaigns", options.campaigns)}

          {error && <div className="alert" role="alert"><div>{error}</div></div>}
          <div className="editor-actions">
            {!isNew && row && <button type="button" className="btn btn-outline danger" onClick={() => { if (window.confirm(`Delete the inquiry from ${row.patient || "this patient"}?`)) onDelete(row); }}><Trash2 size={15} />Delete</button>}
            <span />
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary"><Save size={15} />{isNew ? "Add inquiry" : "Save changes"}</button>
          </div>
        </form>
      </aside>
    </div>
  );
}
