"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import type { LeadState } from "@/lib/lead";
import { LEAD_STATES } from "@/lib/lead";
import type { InquiryRow } from "@/lib/parse";
import { cloudConfigured } from "@/lib/cloud";
import type { InquiryForm } from "@/lib/tracker";
import { caps, CHANNELS, emptyForm, formFromRow, LOST_REASONS, OUTCOME_ORDER, PAYMENT_MODES, rowFromForm, toDateInput, tomorrowInput } from "@/lib/tracker";

/** Opens the inquiry form: with a row to update it, without one to log a new inquiry. */
const EditorContext = createContext<((row?: InquiryRow) => void) | null>(null);
export const EditorProvider = EditorContext.Provider;
export const useInquiryEditor = () => useContext(EditorContext);

const OUTCOME_LABEL: Record<LeadState, string> = {
  open: "Open lead", booked: "Booked (not yet served)", served: "Served", cancelled: "Cancelled", lost: "Lost", noShow: "No-show",
};
const OUTCOME_HELP: Record<LeadState, string> = {
  open: "Not booked yet. The follow-up date is set to tomorrow unless you change it.",
  booked: "Booked, appointment not done yet.",
  served: "Came in and was served.",
  cancelled: "The booking was cancelled.",
  lost: "Closed, no further follow-up.",
  noShow: "Booked but did not come. Set when to call back.",
};
const BOOKED: LeadState[] = ["booked", "served", "noShow", "cancelled"];
const filled = (value: string) => value.trim().length > 0;

/** A form box whose label shows a red asterisk while it is empty, and turns red if saving was tried with it empty. */
function Field({ label, ok, tried, className, children }: { label: string; ok: boolean; tried: boolean; className?: string; children: React.ReactNode }) {
  return (
    <label className={[className, tried && !ok ? "invalid" : ""].filter(Boolean).join(" ") || undefined}>
      <span>{label}{!ok && <span className="req" aria-label="required">*</span>}</span>
      {children}
    </label>
  );
}
const stamp = (d: Date) => d.toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * The inquiry form, as a large pop-up: Tracking and the inquiry itself on the left, the outcome on the right.
 * Everything typed is kept in capitals. Each action or step taken is its own entry, stamped with when and by
 * whom; once saved, a step can only be removed by an Admin, ManCom or Doctors account (`canDelete`).
 */
export function InquiryEditor({ row, isNew, rows, onSave, onDelete, onClose, actor = "", canDelete = true }: {
  row: InquiryRow | null; isNew: boolean; rows: InquiryRow[];
  onSave: (row: InquiryRow, base?: InquiryRow) => void | Promise<void>; onDelete: (row: InquiryRow) => void | Promise<void>; onClose: () => void;
  /** Who is signed in, recorded on each new step. */
  actor?: string;
  /** Full-access accounts: may delete saved steps and whole inquiries. */
  canDelete?: boolean;
}) {
  const [form, setForm] = useState<InquiryForm>(() => (row ? formFromRow(row) : emptyForm()));
  const [savedCount, setSavedCount] = useState(form.steps.length); // steps already saved; the rest were added in this form
  const [otherChannel, setOtherChannel] = useState(() => Boolean(form.channel) && !CHANNELS.includes(form.channel));
  const [newStep, setNewStep] = useState("");
  const [tried, setTried] = useState(false); // saving was attempted: empty boxes turn red
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Saving can fail when accounts are on (no connection, no access); keep the form open with the reason.
  const attempt = async (action: () => void | Promise<void>) => {
    setSaving(true); setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Could not save. Try again."); }
    setSaving(false);
  };
  const firstRef = useRef<HTMLInputElement>(null);
  const options = useMemo(() => {
    const unique = (pick: (r: InquiryRow) => string, extra: string[] = []) => Array.from(new Set([...rows.map(pick), ...extra].map((v) => caps(v || "")).filter((v) => v && v !== "NOT RECORDED"))).sort();
    return { branches: unique((r) => r.branch, ["ANGELES", "MALOLOS"]), procedures: unique((r) => r.procedure), staff: unique((r) => r.staff) };
  }, [rows]);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const set = <K extends keyof InquiryForm>(key: K, value: InquiryForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  /** Props for a text box whose typing is kept in capitals. */
  const text = (key: "patient" | "contact" | "procedure" | "branch" | "inquired" | "staff" | "referredBy" | "payment" | "reminderMethod" | "channel") =>
    ({ value: form[key], autoComplete: "off", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key, caps(e.target.value)) });
  // Any outcome past Open lead means staff already replied, so Responded turns to YES (it can still be changed).
  const setOutcome = (outcome: LeadState) => setForm((f) => ({
    ...f, outcome,
    bookedDate: BOOKED.includes(outcome) && !f.bookedDate ? toDateInput(new Date()) : f.bookedDate,
    followUpDate: (outcome === "open" || outcome === "noShow") && !f.followUpDate ? tomorrowInput() : f.followUpDate,
  }));
  const booked = BOOKED.includes(form.outcome);
  const showStepBox = form.outcome !== "open";

  const addStep = () => {
    const value = newStep.trim();
    if (!value) return;
    setForm((f) => ({ ...f, steps: [...f.steps, { text: caps(value), at: new Date(), by: caps(actor) || "STAFF", outcome: f.outcome }] }));
    setNewStep("");
  };
  const removeStep = (index: number) => {
    const saved = index < savedCount;
    if (saved && !window.confirm("Delete this step? Everyone will stop seeing it.")) return;
    setForm((f) => ({ ...f, steps: f.steps.filter((_, i) => i !== index) }));
    if (saved) setSavedCount((n) => n - 1);
  };

  // Every box shown must be filled before the inquiry can be saved.
  const replied = form.responded === "yes";
  const needsSteps = showStepBox;
  const checks: [string, boolean][] = [
    ["Handled by (staff)", filled(form.staff)],
    ...(replied ? [["First reply date", filled(form.respondedDate)], ["First reply time", filled(form.respondedTime)]] as [string, boolean][] : []),
    ["New or returning", filled(form.patientStatus)], ["Date", filled(form.date)], ["Time", filled(form.time)],
    [otherChannel ? "Other channel" : "Channel", filled(form.channel)], ["Name", filled(form.patient)], ["Contact number", filled(form.contact)],
    ["Branch", filled(form.branch)], ["Procedure / test", filled(form.procedure)], ["Inquired", filled(form.inquired)],
    ...((form.outcome === "open" || form.outcome === "noShow") ? [["Follow up on", filled(form.followUpDate)]] as [string, boolean][] : []),
    ...(booked ? [["Booked on", filled(form.bookedDate)], ["Appointment date", filled(form.appointmentDate)], ["Reminder date", filled(form.reminderDate)], ["Reminder via", filled(form.reminderMethod)]] as [string, boolean][] : []),
    ...(form.outcome === "served" ? [["Revenue", filled(form.revenue)], ["Mode of payment", filled(form.payment)]] as [string, boolean][] : []),
    ...(form.outcome === "lost" ? [["Reason lost", filled(form.lostReason)]] as [string, boolean][] : []),
    ...(needsSteps ? [["Actions / steps taken (at least one)", form.steps.length > 0 || filled(newStep)]] as [string, boolean][] : []),
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([label]) => label);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (missing.length) { setError(`Fill in every box before saving. Still empty: ${missing.join(", ")}.`); return; }
    // A step typed but not yet added is kept too.
    const pending = newStep.trim() && showStepBox ? [{ text: caps(newStep.trim()), at: new Date(), by: caps(actor) || "STAFF", outcome: form.outcome }] : [];
    const final = { ...form, steps: [...form.steps, ...pending], respondedDate: replied ? form.respondedDate : "", respondedTime: replied ? form.respondedTime : "" };
    void attempt(() => onSave(rowFromForm(final, row || undefined), row || undefined));
  };

  const list = (id: string, values: string[]) => <datalist id={id}>{values.map((v) => <option key={v} value={v} />)}</datalist>;

  return (
    <div className="modal-overlay no-print" onClick={onClose}>
      <div className="modal editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="tag">{isNew ? "New inquiry" : "Update inquiry"}</span>
            <h2 id="editor-title">{isNew ? "Add a patient inquiry" : form.patient || "Inquiry"}</h2>
            <p className="drill-meta">{cloudConfigured ? "Saved to the shared database for the whole team." : "Saved on this device right away."} Typing is kept in capitals. Every box is required; empty ones show a red <span className="req">*</span>.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <form className="modal-form" onSubmit={submit}>
          <div className="modal-body editor-grid">
            <div className="editor-col">
              <fieldset>
                <legend><span className="step-n">1</span>Tracking</legend>
                <div className="field-grid">
                  <Field label="Handled by (staff)" ok={filled(form.staff)} tried={tried} className="wide"><input ref={firstRef} list="ed-staff" placeholder="YOUR NAME" {...text("staff")} /></Field>
                  <Field label="Responded" ok={true} tried={tried}><select value={form.responded} onChange={(e) => set("responded", e.target.value as InquiryForm["responded"])}><option value="no">NO, NOT YET</option><option value="yes">YES, WE REPLIED</option></select></Field>
                  {replied && <Field label="First reply date" ok={filled(form.respondedDate)} tried={tried}><input type="date" value={form.respondedDate} onChange={(e) => set("respondedDate", e.target.value)} /></Field>}
                  {replied && <Field label="First reply time" ok={filled(form.respondedTime)} tried={tried}><input type="time" value={form.respondedTime} onChange={(e) => set("respondedTime", e.target.value)} /></Field>}
                </div>
              </fieldset>
              <fieldset>
                <legend><span className="step-n">2</span>Inquiry</legend>
                <div className="field-grid">
                  <Field label="New or returning" ok={filled(form.patientStatus)} tried={tried}><select value={form.patientStatus} onChange={(e) => set("patientStatus", e.target.value as InquiryForm["patientStatus"])}><option value="" disabled>CHOOSE…</option><option value="New">NEW</option><option value="Returning">RETURNING</option></select></Field>
                  <Field label="Date" ok={filled(form.date)} tried={tried}><input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} /></Field>
                  <Field label="Time" ok={filled(form.time)} tried={tried}><input type="time" value={form.time} onChange={(e) => set("time", e.target.value)} /></Field>
                  <Field label="Channel" ok={otherChannel || filled(form.channel)} tried={tried}>
                    <select value={otherChannel ? "OTHERS" : form.channel} onChange={(e) => {
                      if (e.target.value === "OTHERS") { setOtherChannel(true); set("channel", ""); } else { setOtherChannel(false); set("channel", e.target.value); }
                    }}>
                      <option value="">CHOOSE…</option>
                      {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                      <option value="OTHERS">OTHERS</option>
                    </select>
                  </Field>
                  {otherChannel && <Field label="Other channel" ok={filled(form.channel)} tried={tried} className="wide"><input placeholder="TYPE THE CHANNEL" {...text("channel")} /></Field>}
                  <Field label="Name" ok={filled(form.patient)} tried={tried} className="wide"><input {...text("patient")} /></Field>
                  <Field label="Contact number" ok={filled(form.contact)} tried={tried}><input type="tel" placeholder="09XX-XXX-XXXX" {...text("contact")} /></Field>
                  <Field label="Branch" ok={filled(form.branch)} tried={tried}><input list="ed-branches" {...text("branch")} /></Field>
                  <Field label="Procedure / test" ok={filled(form.procedure)} tried={tried} className="wide"><input list="ed-procedures" {...text("procedure")} /></Field>
                  <Field label="Inquired (what the patient asked)" ok={filled(form.inquired)} tried={tried} className="full"><textarea rows={3} {...text("inquired")} /></Field>
                </div>
              </fieldset>
            </div>

            <div className="editor-col">
              <fieldset>
                <legend><span className="step-n">3</span>Outcome</legend>
                <div className="outcome-list" role="radiogroup" aria-label="Outcome">
                  {OUTCOME_ORDER.map((key, i) => {
                    const s = LEAD_STATES.find((x) => x.key === key)!;
                    return (
                      <label key={key} className={form.outcome === key ? "on" : ""}>
                        <input type="radio" name="outcome" value={key} checked={form.outcome === key} onChange={() => setOutcome(key)} />
                        <span className="outcome-n">{i + 1}</span><i style={{ background: s.color }} />{OUTCOME_LABEL[key]}
                      </label>
                    );
                  })}
                </div>
                <p className="drill-meta">{OUTCOME_HELP[form.outcome]}</p>
                <div className="field-grid two">
                  {(form.outcome === "open" || form.outcome === "noShow") && <Field label="Follow up on" ok={filled(form.followUpDate)} tried={tried}><input type="date" value={form.followUpDate} onChange={(e) => set("followUpDate", e.target.value)} /></Field>}
                  {booked && <Field label="Booked on" ok={filled(form.bookedDate)} tried={tried}><input type="date" value={form.bookedDate} onChange={(e) => set("bookedDate", e.target.value)} /></Field>}
                  {booked && <Field label="Appointment date" ok={filled(form.appointmentDate)} tried={tried}><input type="date" value={form.appointmentDate} onChange={(e) => set("appointmentDate", e.target.value)} /></Field>}
                  {booked && <Field label="Reminder date (sent or planned)" ok={filled(form.reminderDate)} tried={tried}><input type="date" value={form.reminderDate} onChange={(e) => set("reminderDate", e.target.value)} /></Field>}
                  {booked && <Field label="Reminder via" ok={filled(form.reminderMethod)} tried={tried}><input list="ed-reminders" {...text("reminderMethod")} /></Field>}
                  {form.outcome === "served" && <Field label="Revenue (₱)" ok={filled(form.revenue)} tried={tried}><input inputMode="decimal" value={form.revenue} placeholder="0" onChange={(e) => set("revenue", e.target.value)} /></Field>}
                  {form.outcome === "served" && <Field label="Mode of payment" ok={filled(form.payment)} tried={tried}><input list="ed-payments" {...text("payment")} /></Field>}
                  {form.outcome === "lost" && <Field label="Reason lost" ok={filled(form.lostReason)} tried={tried} className="full"><select value={form.lostReason} onChange={(e) => set("lostReason", e.target.value)}><option value="">CHOOSE…</option>{LOST_REASONS.map((r) => <option key={r}>{r}</option>)}</select></Field>}
                </div>

                {(showStepBox || form.steps.length > 0) && (
                  <div className="steps-log">
                    <h4 className={tried && showStepBox && !form.steps.length && !filled(newStep) ? "invalid" : undefined}>Actions / steps taken{showStepBox && !form.steps.length && !filled(newStep) && <span className="req" aria-label="required">*</span>}</h4>
                    {form.steps.length ? (
                      <ol>
                        {form.steps.map((step, i) => (
                          <li key={`${i}-${step.text}`} className={i >= savedCount ? "new" : undefined}>
                            <div>
                              <p>{step.text}</p>
                              <small>{stamp(new Date(step.at))} · {step.by}{step.outcome ? ` · ${OUTCOME_LABEL[step.outcome].toUpperCase()}` : ""}{i >= savedCount ? " · not saved yet" : ""}</small>
                            </div>
                            {(canDelete || i >= savedCount) && <button type="button" className="icon-btn" onClick={() => removeStep(i)} aria-label={`Delete step: ${step.text}`}><Trash2 size={15} /></button>}
                          </li>
                        ))}
                      </ol>
                    ) : <p className="empty-note">No steps recorded yet.</p>}
                    {showStepBox && (
                      <div className="step-add">
                        <textarea rows={2} value={newStep} placeholder="TYPE THE ACTION OR STEP TAKEN, THEN ADD IT…" onChange={(e) => setNewStep(caps(e.target.value))}
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addStep(); } }} />
                        <button type="button" className="btn btn-outline btn-sm" onClick={addStep} disabled={!newStep.trim()}><Plus size={14} />Add step</button>
                      </div>
                    )}
                    <p className="drill-meta">Each step is its own entry with the date and who added it. {canDelete ? "As an Admin, ManCom or Doctors account you can delete a step." : "Saved steps can't be deleted; ask an Admin, ManCom or Doctors account if one needs removing."}</p>
                  </div>
                )}
              </fieldset>
            </div>
          </div>

          {list("ed-branches", options.branches)}
          {list("ed-procedures", options.procedures)}
          {list("ed-payments", PAYMENT_MODES)}
          {list("ed-reminders", ["SMS REMINDER", "CALL REMINDER", "VIBER REMINDER", "MESSENGER REMINDER"])}
          {list("ed-staff", options.staff)}
          

          <div className="modal-foot">
            {error && <div className="alert" role="alert"><div>{error}</div></div>}
            <div className="editor-actions">
              {!isNew && row && canDelete && <button type="button" className="btn btn-outline danger" onClick={() => { if (window.confirm(`Delete the inquiry from ${row.patient || "this patient"}?`)) void attempt(() => onDelete(row)); }}><Trash2 size={15} />Delete inquiry</button>}
              <span />
              <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}><Save size={15} />{saving ? "Saving…" : isNew ? "Add inquiry" : "Save changes"}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
