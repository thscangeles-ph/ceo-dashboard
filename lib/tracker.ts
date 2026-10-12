import * as XLSX from "xlsx";
import type { LeadState } from "./lead";
import { leadState } from "./lead";
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
    patientStatus: "New", date: toDateInput(now), time: toTimeInput(now), channel: "", patient: "", contact: "", procedure: "", branch: "", inquired: "",
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
    outcome: f.outcome, editedAt: new Date(),
    rowKey: base?.rowKey || `app|${Date.now()}|${Math.random().toString(36).slice(2, 8)}`,
  };
}

/** Downloads every inquiry in the same column layout as the concierge scheduling tracker. */
export function exportTracker(rows: InquiryRow[]) {
  const sorted = [...rows].sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
  const optional = {
    "Appointment Date": rows.some((r) => r.appointmentDate), Staff: rows.some((r) => r.staff), "Date Responded": rows.some((r) => r.respondedAt),
    "Referred By": rows.some((r) => r.referredBy), Campaign: rows.some((r) => r.campaign),
  };
  const data = sorted.map((r, i) => {
    const state = leadState(r);
    // Keep the outcome readable when the file comes back in: lost and cancelled are written into the action column.
    let action = r.action || r.remarks;
    if (state === "lost" && !/NO FURTHER ACTION|LOST/i.test(action)) action = `${LOST_PREFIX}${action || "lead closed"}`;
    if (state === "cancelled" && !/CANCEL/i.test(action)) action = `Cancelled${action ? ` — ${action}` : ""}`;
    const row: Record<string, string | number> = {
      "#": i + 1, "New or Returning Patient": r.patientStatus || "—", Date: sheetDate(r.date), Time: r.hasTime ? sheetTime(r.date) : "",
      "Channel / Source": r.channel, Name: r.patient, "Contact Number": r.contact || "—", "Procedure / Test": r.procedure || "—", Branch: r.branch,
      "Mode of Payment": r.payment || "—", Inquired: r.inquired || "—",
      "If not booked, schedule of follow-up": r.followUpDate ? sheetDate(r.followUpDate) : r.followUp || "—",
      "If booked, send a reminder": r.reminder || "—",
      "Booked (Date of Booking)": r.booked ? (r.bookedDate ? sheetDate(r.bookedDate) : "Yes") : "—",
      "No Show": r.noShow ? "Yes" : "No", Served: r.served ? "Yes" : "No",
      "Revenue (Cost of Procedure)": r.revenue ? `₱${Math.round(r.revenue).toLocaleString("en-PH")}` : "—",
      "Other Applicable Actions (Follow-up)": action,
    };
    if (optional["Appointment Date"]) row["Appointment Date"] = r.appointmentDate ? sheetDate(r.appointmentDate) : "—";
    if (optional.Staff) row.Staff = r.staff;
    if (optional["Date Responded"]) row["Date Responded"] = r.respondedAt ? `${sheetDate(r.respondedAt)} ${sheetTime(r.respondedAt)}` : "";
    if (optional["Referred By"]) row["Referred By"] = r.referredBy;
    if (optional.Campaign) row.Campaign = r.campaign;
    return row;
  });
  const sheet = XLSX.utils.json_to_sheet(data);
  sheet["!cols"] = Object.keys(data[0] || {}).map((key) => ({ wch: Math.min(40, Math.max(8, key.length + 2)) }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Scheduling Tracker");
  XLSX.writeFile(book, `THSC Scheduling Tracker ${toDateInput(new Date())}.xlsx`);
}
