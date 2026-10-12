import * as XLSX from "xlsx";
import { inquiryTopic } from "./crm";
import type { LeadState } from "./lead";
import { effectiveResponded, leadState } from "./lead";
import type { InquiryRow } from "./parse";

/** The fields staff fill in when adding or updating an inquiry in the app. */
export type InquiryForm = {
  patientStatus: "New" | "Returning" | "";
  date: string; // yyyy-mm-dd
  time: string; // HH:MM
  channel: string;
  patient: string;
  contact: string;
  procedure: string;
  branch: string;
  inquired: string;
  responded: "yes" | "no" | "";
  outcome: LeadState;
  bookedDate: string;
  appointmentDate: string;
  reminderDate: string;
  reminderMethod: string;
  followUpDate: string;
  revenue: string;
  payment: string;
  lostReason: string;
  action: string;
  staff: string;
  referredBy: string;
  campaign: string;
  respondedDate: string;
  respondedTime: string;
};

export const LOST_REASONS = ["Patient chose another facility", "Location too far for patient", "Price / fees too high", "HMO not accepted", "Schedule not available", "No response after follow-ups", "Not interested"];
export const PAYMENT_MODES = ["Cash", "HMO", "GCash", "Debit Card", "Credit Card", "Bank Transfer"];
const LOST_PREFIX = "No further action — ";

const pad = (n: number) => String(n).padStart(2, "0");
export const toDateInput = (d: Date | null | undefined) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "");
const toTimeInput = (d: Date | null | undefined) => (d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "");
const fromInputs = (date: string, time = "") => {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time ? time.split(":").map(Number) : [0, 0];
  return new Date(y, m - 1, d, hh, mm);
};
const sheetDate = (d: Date | null | undefined) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const sheetTime = (d: Date | null | undefined) => (d ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");

export function emptyForm(now = new Date()): InquiryForm {
  return {
    patientStatus: "New", date: toDateInput(now), time: toTimeInput(now), channel: "", patient: "", contact: "", procedure: "", branch: "", inquired: "", responded: "no",
    outcome: "open", bookedDate: "", appointmentDate: "", reminderDate: "", reminderMethod: "SMS Reminder", followUpDate: "", revenue: "", payment: "",
    lostReason: "", action: "", staff: "", referredBy: "", campaign: "", respondedDate: "", respondedTime: "",
  };
}

export function formFromRow(row: InquiryRow): InquiryForm {
  const outcome = leadState(row);
  const lost = outcome === "lost" && row.action.startsWith(LOST_PREFIX);
  return {
    patientStatus: row.patientStatus, date: toDateInput(row.date), time: row.hasTime ? toTimeInput(row.date) : "",
    channel: row.channel === "Not recorded" ? "" : row.channel, patient: row.patient, contact: row.contact, procedure: row.procedure,
    branch: row.branch === "Not recorded" ? "" : row.branch, inquired: row.inquired, outcome,
    responded: effectiveResponded(row) ? "yes" : "no",
    bookedDate: toDateInput(row.bookedDate), appointmentDate: toDateInput(row.appointmentDate), reminderDate: toDateInput(row.reminderDate),
    reminderMethod: row.reminder.split(/\s[–—-]\s/).slice(1).join(" ").trim() || "SMS Reminder",
    followUpDate: toDateInput(row.followUpDate), revenue: row.revenue ? String(row.revenue) : "", payment: row.payment,
    lostReason: lost ? row.action.slice(LOST_PREFIX.length) : "", action: lost ? "" : row.action,
    staff: row.staff, referredBy: row.referredBy, campaign: row.campaign,
    respondedDate: toDateInput(row.respondedAt), respondedTime: toTimeInput(row.respondedAt),
  };
}

/** Turns the form back into a tracker row, keeping the same row identity when editing. */
export function rowFromForm(f: InquiryForm, base?: InquiryRow): InquiryRow {
  const booked = ["booked", "served", "noShow", "cancelled"].includes(f.outcome);
  const date = fromInputs(f.date, f.time);
  const followUpDate = f.outcome === "open" || f.outcome === "noShow" ? fromInputs(f.followUpDate) : null;
  const reminderDate = booked ? fromInputs(f.reminderDate) : null;
  const action = f.outcome === "lost" && f.lostReason ? `${LOST_PREFIX}${f.lostReason}${f.action ? `. ${f.action}` : ""}` : f.action.trim();
  return {
    date, hasTime: Boolean(f.time), patient: f.patient.trim(), contact: f.contact.trim(), patientStatus: f.patientStatus,
    channel: f.channel.trim() || "Not recorded", branch: f.branch.trim() || "Not recorded", procedure: f.procedure.trim(),
    payment: f.outcome === "served" ? f.payment : "", inquired: f.inquired.trim(), status: "",
    booked, bookedDate: booked ? fromInputs(f.bookedDate) : null, appointmentDate: booked ? fromInputs(f.appointmentDate) : null,
    served: f.outcome === "served", noShow: f.outcome === "noShow",
    followUp: followUpDate ? sheetDate(followUpDate) : "", followUpDate,
    reminder: reminderDate ? `${sheetDate(reminderDate)} – ${f.reminderMethod || "SMS Reminder"}` : "", reminderDate,
    revenue: f.outcome === "served" ? Math.max(0, Number(f.revenue.replace(/[₱,\s]/g, "")) || 0) : 0,
    action, remarks: action, staff: f.staff.trim(), referredBy: f.referredBy.trim(), campaign: f.campaign.trim(),
    respondedAt: fromInputs(f.respondedDate, f.respondedTime),
    responded: f.responded === "" ? null : f.responded === "yes",
    outcome: f.outcome, editedAt: new Date(),
    rowKey: base?.rowKey || `app|${Date.now()}|${Math.random().toString(36).slice(2, 8)}`,
  };
}

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysFrom = (today: Date, d: Date) => Math.round((startOfDay(d).getTime() - startOfDay(today).getTime()) / DAY);
const shortDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** done = nothing left to do, overdue / today = act now, todo = needs an action, wait = the next step is scheduled later. */
export type StepTone = "done" | "overdue" | "today" | "todo" | "wait";
export type NextStep = { text: string; detail: string; tone: StepTone };
export const STEP_LABEL: Record<StepTone, string> = { overdue: "Overdue", today: "Due today", todo: "To do", wait: "Scheduled", done: "Complete" };

const due = (today: Date, d: Date, act: string, detail: string): NextStep => {
  const days = daysFrom(today, d);
  if (days < 0) return { text: act, detail: `${detail} was ${shortDay(d)} · ${-days}d late`, tone: "overdue" };
  if (days === 0) return { text: act, detail: `${detail} today`, tone: "today" };
  return { text: act, detail: `${detail} ${shortDay(d)}`, tone: "wait" };
};

/** What staff should do next for an inquiry, or Complete when nothing is left. */
export function nextStep(row: InquiryRow, today: Date): NextStep {
  const state = leadState(row);
  if (state === "served") return { text: "Complete", detail: row.revenue ? `Served · ₱${Math.round(row.revenue).toLocaleString("en-PH")}` : "Served", tone: "done" };
  if (state === "lost") return { text: "Complete", detail: "Closed, no further action", tone: "done" };
  if (state === "cancelled") return { text: "Complete", detail: "Booking cancelled", tone: "done" };
  if (!effectiveResponded(row)) {
    const act = inquiryTopic(row) === "Price & fees" ? "Reply with the price" : "Reply to the inquiry";
    const late = row.date ? daysFrom(today, row.date) < 0 : false;
    return { text: act, detail: row.date ? `Asked ${shortDay(row.date)}, not answered yet` : "Not answered yet", tone: late ? "overdue" : "today" };
  }
  if (state === "noShow") return row.followUpDate ? due(today, row.followUpDate, "Call to reschedule", "Call back") : { text: "Call to reschedule", detail: "No-show, no call-back date set", tone: "todo" };
  if (state === "booked") {
    const visit = row.appointmentDate || row.bookedDate;
    if (visit && daysFrom(today, visit) < 0) return { text: "Mark Served or No-show", detail: `Appointment was ${shortDay(visit)}`, tone: "overdue" };
    if (!row.reminder) {
      const soon = visit ? daysFrom(today, visit) <= 1 : true;
      return { text: "Send a reminder", detail: visit ? `Appointment ${shortDay(visit)}` : "Booked, no reminder yet", tone: soon ? "today" : "todo" };
    }
    return { text: "Wait for the appointment", detail: visit ? `Appointment ${shortDay(visit)}, reminder sent` : "Reminder sent", tone: "wait" };
  }
  return row.followUpDate ? due(today, row.followUpDate, "Follow up", "Follow-up") : { text: "Set a follow-up date", detail: "Not booked, no follow-up date", tone: "todo" };
}

/** The tracker's columns that can be edited in place, cell by cell. */
export type CellField =
  | "patientStatus" | "date" | "time" | "channel" | "patient" | "contact" | "procedure" | "branch" | "payment" | "inquired" | "responded"
  | "followUpDate" | "reminderDate" | "bookedDate" | "noShow" | "served" | "revenue" | "action";

/** The value a cell's editor starts with. */
export function cellValue(row: InquiryRow, field: CellField): string {
  switch (field) {
    case "date": return toDateInput(row.date);
    case "time": return row.hasTime ? toTimeInput(row.date) : "";
    case "channel": case "branch": return row[field] === "Not recorded" ? "" : row[field];
    case "responded": return effectiveResponded(row) ? "yes" : "no";
    case "followUpDate": case "reminderDate": case "bookedDate": return toDateInput(row[field]);
    case "noShow": case "served": return row[field] ? "yes" : "no";
    case "revenue": return row.revenue ? String(row.revenue) : "";
    case "action": return row.action || row.remarks;
    default: return row[field];
  }
}

/** Applies one cell edit, keeping the rest of the row (and its identity) as it was. */
export function applyEdit(row: InquiryRow, field: CellField, value: string): InquiryRow {
  const next: InquiryRow = { ...row, editedAt: new Date() };
  const v = value.trim();
  switch (field) {
    case "date": {
      const d = fromInputs(v, row.hasTime ? toTimeInput(row.date) : "");
      if (d) next.date = d;
      break;
    }
    case "time": next.date = fromInputs(toDateInput(row.date || new Date()), v); next.hasTime = Boolean(v); break;
    case "channel": case "branch": next[field] = v || "Not recorded"; break;
    case "patientStatus": next.patientStatus = v === "New" || v === "Returning" ? v : ""; break;
    case "responded": next.responded = v === "yes"; break;
    case "followUpDate": next.followUpDate = fromInputs(v); next.followUp = next.followUpDate ? sheetDate(next.followUpDate) : ""; break;
    case "reminderDate": {
      next.reminderDate = fromInputs(v);
      const method = row.reminder.split(/\s[–—-]\s/).slice(1).join(" ").trim() || "SMS Reminder";
      next.reminder = next.reminderDate ? `${sheetDate(next.reminderDate)} – ${method}` : "";
      break;
    }
    case "bookedDate":
      next.bookedDate = fromInputs(v); next.booked = Boolean(v) || row.served || row.noShow;
      next.outcome = undefined;
      break;
    case "noShow": case "served":
      next[field] = v === "yes";
      if (v === "yes") { next.booked = true; next[field === "served" ? "noShow" : "served"] = false; next.followUpDate = field === "served" ? null : row.followUpDate; }
      next.outcome = undefined;
      break;
    case "revenue": next.revenue = Math.max(0, Number(v.replace(/[₱,\s]/g, "")) || 0); break;
    case "action": next.action = v; next.remarks = v; next.outcome = row.outcome === "lost" || row.outcome === "cancelled" ? undefined : row.outcome; break;
    default: next[field] = v;
  }
  if (!next.outcome) delete next.outcome;
  return next;
}

const known = (v: string) => (v && v !== "Not recorded" ? v : "—");
/** "Yes"/"No" the way the tracker writes it. */
const yesNo = (value: boolean) => (value ? "Yes" : "No");

/**
 * Downloads every inquiry as the concierge scheduling tracker: the same title row ("OUTCOME (REMARKS)"
 * over No Show and Served), the same columns in the same order and widths, plus Responded and the
 * app's Next Step / Status. The file can be uploaded again; edits made in the app are kept.
 */
export function exportTracker(rows: InquiryRow[], today = new Date()) {
  const sorted = [...rows].sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
  const optional = [
    ["Appointment Date", rows.some((r) => r.appointmentDate), (r: InquiryRow) => (r.appointmentDate ? sheetDate(r.appointmentDate) : "—")],
    ["Staff", rows.some((r) => r.staff), (r: InquiryRow) => r.staff],
    ["Date Responded", rows.some((r) => r.respondedAt), (r: InquiryRow) => (r.respondedAt ? `${sheetDate(r.respondedAt)} ${sheetTime(r.respondedAt)}` : "")],
    ["Referred By", rows.some((r) => r.referredBy), (r: InquiryRow) => r.referredBy],
    ["Campaign", rows.some((r) => r.campaign), (r: InquiryRow) => r.campaign],
  ] as const;
  const extra = optional.filter(([, used]) => used);
  const headers = [
    "#", "New or Returning Patient", "Date", "Time", "Channel / Source", "Name", "Contact Number", "Procedure / Test", "Branch", "Mode of Payment", "Inquired",
    "Responded (YES/NO)", "If not booked, schedule of follow-up", "If booked, send a reminder", "Booked (Date of Booking)", "No Show", "Served",
    "Revenue (Cost of Procedure)", "Other Applicable Actions (Follow-up)", ...extra.map(([name]) => name), "Next Step / Status",
  ];
  const widths = [4.25, 25, 14, 14, 22.88, 18, 15, 22, 14, 17.25, 32, 12, 25.75, 24, 16, 14, 14, 23.75, 38.5, ...extra.map(() => 18), 34];
  const body = sorted.map((r, i) => {
    const state = leadState(r);
    // Keep the outcome readable when the file comes back in: lost and cancelled are written into the action column.
    let action = r.action || r.remarks;
    if (state === "lost" && !/NO FURTHER ACTION|LOST/i.test(action)) action = `${LOST_PREFIX}${action || "lead closed"}`;
    if (state === "cancelled" && !/CANCEL/i.test(action)) action = `Cancelled${action ? ` — ${action}` : ""}`;
    const step = nextStep(r, today);
    return [
      i + 1, r.patientStatus || "—", sheetDate(r.date), r.hasTime ? sheetTime(r.date) : "", known(r.channel), r.patient, r.contact || "—", r.procedure || "—", known(r.branch),
      r.payment || "—", r.inquired || "—", effectiveResponded(r) ? "YES" : "NO",
      r.followUpDate ? sheetDate(r.followUpDate) : r.followUp || "—", r.reminder || "—",
      r.booked ? (r.bookedDate ? sheetDate(r.bookedDate) : "Yes") : "—", yesNo(r.noShow), yesNo(r.served),
      r.revenue ? `₱${Math.round(r.revenue).toLocaleString("en-PH")}` : "—", action || "—",
      ...extra.map(([, , get]) => get(r)),
      step.tone === "done" ? `COMPLETE — ${step.detail}` : `${step.text} (${step.detail})`,
    ];
  });
  const title: string[] = headers.map(() => "");
  const outcomeCol = headers.indexOf("No Show");
  title[outcomeCol] = "OUTCOME (REMARKS)";
  const sheet = XLSX.utils.aoa_to_sheet([title, headers, ...body]);
  sheet["!merges"] = [{ s: { r: 0, c: outcomeCol }, e: { r: 0, c: outcomeCol + 1 } }];
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 1, c: 0 }, e: { r: body.length + 1, c: headers.length - 1 } }) };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Inquiry Tracker");
  XLSX.writeFile(book, `THSC Inquiry Tracker ${toDateInput(today)}.xlsx`);
}
