import * as XLSX from "xlsx";
import type { LeadState } from "./lead";

/** One billed line item from the Detailed Sales Report. */
export type SalesRow = {
  date: Date | null;
  transaction: string;
  patient: string; // normalized name, used only for counting
  patientType: string;
  status: string;
  source: string;
  service: string; // Test / Examination
  serviceLine: string; // Department / Section
  category: string; // REGULAR, SENIOR, PWD …
  physician: string;
  gross: number;
  discount: number;
  revenue: number; // Total Payment
  rowKey: string;
};

/** One inquiry from the Central Concierge / scheduling tracker (the CRM sheet staff fill in). */
export type InquiryRow = {
  date: Date | null; // inquiry date, with the inquiry time when the sheet has one
  hasTime: boolean;
  patient: string; // display name, shown in follow-up lists
  contact: string;
  patientStatus: "New" | "Returning" | "";
  channel: string; // "Channel / Source"
  branch: string;
  procedure: string;
  payment: string;
  inquired: string; // what the patient asked
  status: string;
  booked: boolean;
  bookedDate: Date | null; // the day the booking was made
  appointmentDate: Date | null; // only when the sheet has an appointment / schedule date column
  served: boolean;
  noShow: boolean;
  followUp: string;
  followUpDate: Date | null;
  reminder: string;
  reminderDate: Date | null;
  revenue: number;
  action: string; // "Other Applicable Actions (Follow-up)"
  remarks: string;
  staff: string;
  referredBy: string;
  campaign: string;
  respondedAt: Date | null;
  /** Set when staff update the inquiry in the app; overrides what the sheet columns imply. */
  outcome?: LeadState;
  editedAt?: Date;
  rowKey: string;
};

export type SheetSummary = { file: string; sheet: string; kind: "sales" | "concierge"; rows: number; columns: string[] };
export type ParseResult = { sales: SalesRow[]; inquiries: InquiryRow[]; sheets: SheetSummary[]; problems: string[] };

export const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
export const normalize = (value: unknown) => clean(value).toUpperCase();
const headerKey = (value: unknown) => normalize(value).replace(/[^A-Z0-9]/g, "");

type FieldSpec = Record<string, string[]>;

// Header names are matched without spaces or punctuation, so "Transaction No." = "TRANSACTION NO" = "TransactionNo".
const SALES_FIELDS: FieldSpec = {
  date: ["Date", "Transaction Date", "Date/Time", "Date Time", "Visit Date"],
  transaction: ["Transaction No.", "Transaction Number", "Trans No.", "OR No.", "OR Number", "Invoice No.", "Receipt No."],
  patient: ["Patient Name", "Patient", "Name of Patient", "Name"],
  patientType: ["Patient Type", "Type", "Patient Classification Type"],
  status: ["Status", "Payment Status", "Transaction Status"],
  source: ["Source", "Referral Source", "Patient Source", "How did you hear about us"],
  service: ["Test Examination", "Test/Examination", "Examination", "Test", "Procedure", "Service", "Item", "Description", "Particulars"],
  serviceLine: ["Department", "Section", "Service Line", "Service Type", "Service Category", "Test Category", "Item Group", "Group", "Modality", "Unit"],
  category: ["Patient Category", "Discount Type", "Classification", "Patient Class", "Patient Classification"],
  physician: ["Referring Physician", "Referring Doctor", "Referred By", "Referral Doctor", "Requesting Physician", "Requesting Doctor", "Physician", "Doctor", "Source Details", "Source Detail", "Referral Name"],
  gross: ["Gross Amount", "Gross", "Amount", "Total Amount", "Price", "Unit Price", "Subtotal", "Sub Total"],
  discount: ["Discount", "Discount Amount", "Less Discount", "Total Discount"],
  revenue: ["Total Payment", "Net Amount", "Amount Paid", "Net Payment", "Payment", "Net"],
};
const SALES_REQUIRED = ["date", "patient", "revenue"];

// Matches the THSC scheduling tracker ("New or Returning Patient", "Channel / Source", "Booked (Date of Booking)" …) and simpler logs.
const CONCIERGE_FIELDS: FieldSpec = {
  date: ["Date", "Inquiry Date", "Date of Inquiry", "Date Received", "Timestamp"],
  time: ["Time", "Inquiry Time", "Time of Inquiry", "Time Received"],
  patient: ["Name", "Patient Name", "Client Name", "Inquirer", "Patient", "Client"],
  contact: ["Contact Number", "Contact No.", "Contact", "Mobile Number", "Mobile", "Phone", "Phone Number"],
  patientStatus: ["New or Returning Patient", "New or Returning", "New/Returning", "Patient Status", "Patient Type"],
  channel: ["Channel / Source", "Channel/Source", "Channel", "Inquiry Channel", "Platform", "Mode of Inquiry", "Medium", "Contact Channel", "Source"],
  branch: ["Branch", "Clinic", "Location", "Site"],
  procedure: ["Procedure / Test", "Procedure/Test", "Procedure", "Service", "Inquired Procedure", "Procedure Inquired", "Service Inquired", "Test", "Inquiry About"],
  payment: ["Mode of Payment", "Payment Mode", "Payment Method", "Payment"],
  inquired: ["Inquired", "Inquiry", "Inquiry Details", "Concern", "Question"],
  status: ["Status", "Booking Status", "Outcome", "Result", "Inquiry Status"],
  booked: ["Booked (Date of Booking)", "Date of Booking", "Booking Date", "Booked", "Booked?", "Booking", "Converted", "Converted to Booking"],
  appointment: ["Appointment Date", "Date of Appointment", "Scheduled Date", "Schedule Date", "Procedure Date"],
  noShow: ["No Show", "No-show", "Noshow", "No Show?"],
  served: ["Served", "Attended", "Showed", "Show", "Completed", "Showed Up"],
  followUp: ["If not booked, schedule of follow-up", "Schedule of Follow-up", "Follow-up Date", "Follow up Date", "Follow-up", "Follow Up", "Follow-up By", "Next Follow-up"],
  reminder: ["If booked, send a reminder", "Reminder", "Reminder Sent", "Reminder Date"],
  revenue: ["Revenue (Cost of Procedure)", "Revenue", "Cost of Procedure", "Amount", "Total Payment"],
  action: ["Other Applicable Actions (Follow-up)", "Other Applicable Actions", "Actions Taken", "Action Taken", "Action", "Next Step"],
  remarks: ["Remarks", "Notes", "Reason", "Reason for Not Booking", "Comments", "Lost Reason"],
  staff: ["Staff", "Handled By", "Concierge", "Agent", "Staff Name", "Encoded By", "Assigned To"],
  referredBy: ["Referred By", "Referring Physician", "Referring Doctor", "Referral Partner", "Referrer", "Referring Clinic", "Partner"],
  campaign: ["Campaign", "Ad Campaign", "Promo", "Campaign Name"],
  respondedAt: ["Date Responded", "Responded At", "Response Date", "Date/Time Responded", "Date & Time Responded"],
  respondedTime: ["Time Responded", "Response Time"],
};
const CONCIERGE_REQUIRED = ["channel"];

/** Maps each field to a column, taking aliases in priority order and never using one column twice. */
function mapColumns(headers: unknown[], spec: FieldSpec) {
  const keys = headers.map(headerKey);
  const used = new Set<number>();
  const map: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(spec)) {
    map[field] = -1;
    for (const alias of aliases) {
      const index = keys.findIndex((key, i) => key === headerKey(alias) && !used.has(i));
      if (index >= 0) { map[field] = index; used.add(index); break; }
    }
  }
  return { map, keys };
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Minutes after midnight from an Excel time cell, a day fraction, or text like "8:02 AM". */
export function parseTime(value: unknown): number | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getHours() * 60 + value.getMinutes();
  if (typeof value === "number" && value >= 0 && value < 1) return Math.round(value * 24 * 60);
  const match = clean(value).match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const marker = (match[3] || "").toUpperCase();
  if (marker === "PM" && hour < 12) hour += 12;
  if (marker === "AM" && hour === 12) hour = 0;
  return hour < 24 ? hour * 60 + Number(match[2]) : null;
}

export function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && value > 0) {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S)) : null;
  }
  const text = clean(value);
  const us = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (us) {
    let hour = Number(us[4] || 0);
    const marker = (us[7] || "").toUpperCase();
    if (marker === "PM" && hour < 12) hour += 12;
    if (marker === "AM" && hour === 12) hour = 0;
    const year = Number(us[3]) < 100 ? 2000 + Number(us[3]) : Number(us[3]);
    const date = new Date(year, Number(us[1]) - 1, Number(us[2]), hour, Number(us[5] || 0), Number(us[6] || 0));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  // "Jul 6, 2026", "July 6 2026", "Jul 7, 2026 – SMS Reminder", "6 Jul 2026"
  const named = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/) || text.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/);
  if (named) {
    const [monthText, dayText] = /^\d/.test(named[1]) ? [named[2], named[1]] : [named[1], named[2]];
    const month = MONTHS.indexOf(monthText.slice(0, 3).toUpperCase());
    if (month >= 0) {
      const minutes = parseTime(text.slice((named.index || 0) + named[0].length).trim().split(/\s+(?![AP]M\b)/i)[0] || "");
      return new Date(Number(named[3]), month, Number(dayText), minutes !== null ? Math.floor(minutes / 60) : 0, minutes !== null ? minutes % 60 : 0);
    }
  }
  if (/[A-Za-z]{3,}/.test(text) && /\d/.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

const toNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = clean(value).replace(/[₱,\s]|PHP/gi, "");
  const negative = /^\(.*\)$/.test(text);
  const parsed = Number(text.replace(/[()]/g, ""));
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : 0;
};

const yes = (value: unknown) => /^(Y|YES|TRUE|1|BOOKED|SERVED|ATTENDED|SHOWED|DONE|COMPLETED?)$/.test(normalize(value));
const PATIENT_CATEGORY = /\b(REGULAR|SENIOR|PWD|SC|EMPLOYEE|STUDENT|VIP|HMO|CORPORATE|CHARITY|DEPENDENT)\b/;

/** A generic "Category" column is a patient category when its values look like REGULAR / SENIOR / PWD, otherwise a service line. */
function classifyCategoryColumn(grid: unknown[][], start: number, index: number) {
  const values = grid.slice(start, start + 400).map((row) => normalize(row?.[index])).filter(Boolean);
  if (!values.length) return "serviceLine";
  const hits = values.filter((value) => PATIENT_CATEGORY.test(value)).length;
  return hits / values.length > 0.5 ? "category" : "serviceLine";
}

function findHeader(grid: unknown[][], spec: FieldSpec, required: string[], extra?: (keys: string[]) => boolean) {
  for (let i = 0; i < Math.min(grid.length, 60); i += 1) {
    const { map, keys } = mapColumns(grid[i] || [], spec);
    if (required.every((field) => map[field] >= 0) && (!extra || extra(keys))) return { index: i, map, keys };
  }
  return null;
}

function parseSales(grid: unknown[][], header: { index: number; map: Record<string, number>; keys: string[] }, file: string, sheet: string) {
  const { map, keys } = header;
  const generic = keys.findIndex((key, i) => key === "CATEGORY" && !Object.values(map).includes(i));
  if (generic >= 0) {
    const kind = classifyCategoryColumn(grid, header.index + 1, generic);
    if (map[kind] < 0) map[kind] = generic;
  }
  const at = (row: unknown[], field: string) => (map[field] >= 0 ? row[map[field]] : "");
  const rows: SalesRow[] = [];
  grid.slice(header.index + 1).forEach((row, offset) => {
    if (!row) return;
    const patient = normalize(at(row, "patient"));
    const date = parseDate(at(row, "date"));
    // Skip blank lines, subtotal and grand-total lines, and repeated header rows.
    if (!patient || !date || /^(TOTAL|GRAND TOTAL|SUBTOTAL|PATIENT NAME)$/.test(patient)) return;
    const revenue = toNumber(at(row, "revenue"));
    const discount = Math.abs(toNumber(at(row, "discount")));
    const grossRaw = toNumber(at(row, "gross"));
    const gross = map.gross >= 0 && grossRaw > 0 ? grossRaw : revenue + discount;
    const transaction = clean(at(row, "transaction"));
    const service = clean(at(row, "service"));
    rows.push({
      date, transaction, patient, revenue, discount, gross, service,
      patientType: normalize(at(row, "patientType")),
      status: normalize(at(row, "status")),
      source: clean(at(row, "source")),
      serviceLine: normalize(at(row, "serviceLine")),
      category: normalize(at(row, "category")),
      physician: clean(at(row, "physician")),
      rowKey: [patient, normalize(transaction), normalize(service || `${file}|${sheet}|${offset}`), revenue.toFixed(2), date.getTime()].join("|"),
    });
  });
  return rows;
}

/** Identifies an inquiry by who, how, when and what, so re-uploads and app edits line up with the same row. */
export const inquiryKey = (patient: string, contact: string, channel: string, date: Date | null, procedure: string) =>
  [patient.trim().toUpperCase(), contact.replace(/\D/g, ""), channel.trim().toUpperCase(), date ? date.getTime() : "", procedure.trim().toUpperCase()].join("|");

const isBlank = (value: unknown) => /^(|—|–|-+|N\/?A|NONE)$/i.test(clean(value));

function parseConcierge(grid: unknown[][], header: { index: number; map: Record<string, number> }) {
  const { map } = header;
  const at = (row: unknown[], field: string) => (map[field] >= 0 ? row[map[field]] : "");
  const text = (row: unknown[], field: string) => (isBlank(at(row, field)) ? "" : clean(at(row, field)));
  const rows: InquiryRow[] = [];
  grid.slice(header.index + 1).forEach((row) => {
    if (!row) return;
    const channel = text(row, "channel");
    const patient = text(row, "patient");
    if (!channel && !patient) return;
    const status = text(row, "status");
    const s = normalize(status);
    const noShowByStatus = /NO[\s-]?SHOW|DID NOT (ATTEND|SHOW|COME)|DIDN'?T (ATTEND|SHOW|COME)/.test(s);
    const noShow = map.noShow >= 0 ? yes(at(row, "noShow")) : noShowByStatus;
    const notBooked = /NO[\s-]?BOOK|NOT BOOK|UNBOOK|UNCONVERTED|NOT CONVERTED|LOST|DECLINED|NO RESPONSE|INQUIRY ONLY/.test(s);
    const servedByStatus = !noShow && /SERVED|COMPLETED?|ATTENDED|DONE|SHOWED|PAID/.test(s);
    const served = map.served >= 0 ? yes(at(row, "served")) : servedByStatus;
    // The tracker's Booked column holds the booking date, so any date there means booked.
    const bookedDate = map.booked >= 0 ? parseDate(at(row, "booked")) : null;
    const booked = map.booked >= 0
      ? yes(at(row, "booked")) || Boolean(bookedDate) || served || noShow
      : !notBooked && (served || noShow || /BOOK|CONFIRM|SCHEDUL|RESCHED|APPOINT/.test(s));
    let date = parseDate(at(row, "date"));
    const minutes = map.time >= 0 ? parseTime(at(row, "time")) : null;
    if (date && minutes !== null) date = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(minutes / 60), minutes % 60);
    const followUp = text(row, "followUp");
    const followUpDate = parseDate(followUp);
    const reminder = text(row, "reminder");
    const statusText = normalize(at(row, "patientStatus"));
    rows.push({
      date, hasTime: minutes !== null,
      patient, contact: text(row, "contact"),
      patientStatus: /RETURN|OLD|FOLLOW|SCHED|WALK|^HMO$/.test(statusText) ? "Returning" : /NEW/.test(statusText) ? "New" : "",
      channel: channel || "Not recorded", status,
      branch: text(row, "branch") || "Not recorded",
      procedure: text(row, "procedure"),
      payment: text(row, "payment"),
      inquired: text(row, "inquired"),
      booked, bookedDate, served, noShow, appointmentDate: parseDate(at(row, "appointment")),
      followUp: followUpDate ? followUpDate.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : followUp,
      followUpDate, reminder, reminderDate: parseDate(reminder),
      revenue: Math.max(0, toNumber(isBlank(at(row, "revenue")) ? 0 : at(row, "revenue"))),
      action: text(row, "action"),
      remarks: text(row, "remarks") || text(row, "action"),
      staff: text(row, "staff"), referredBy: text(row, "referredBy"), campaign: text(row, "campaign"),
      respondedAt: (() => {
        const day = parseDate(at(row, "respondedAt"));
        const minutes = map.respondedTime >= 0 ? parseTime(at(row, "respondedTime")) : null;
        return day && minutes !== null ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60) : day;
      })(),
      rowKey: inquiryKey(patient, text(row, "contact"), channel || "Not recorded", date, text(row, "procedure")),
    });
  });
  return rows;
}

/** Reads every sheet of every workbook and sorts each into a sales report or a concierge log by its headers. */
export async function parseWorkbooks(files: File[]): Promise<ParseResult> {
  const result: ParseResult = { sales: [], inquiries: [], sheets: [], problems: [] };
  for (const file of files) {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    } catch {
      result.problems.push(`${file.name} could not be opened as an Excel workbook.`);
      continue;
    }
    let matched = 0;
    for (const sheetName of workbook.SheetNames) {
      const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: true });
      const sales = findHeader(grid, SALES_FIELDS, SALES_REQUIRED);
      const concierge = findHeader(grid, CONCIERGE_FIELDS, CONCIERGE_REQUIRED, (keys) => keys.some((key) => /STATUS|OUTCOME|BOOKED|RESULT|SERVED|NOSHOW|INQUIRED/.test(key)));
      // A concierge log has a Channel column; a sales report has Total Payment. Prefer whichever header row appears first.
      if (sales && (!concierge || sales.index <= concierge.index)) {
        const rows = parseSales(grid, sales, file.name, sheetName);
        const columns = Object.entries(sales.map).filter(([, i]) => i >= 0).map(([field]) => field);
        result.sales.push(...rows);
        result.sheets.push({ file: file.name, sheet: sheetName, kind: "sales", rows: rows.length, columns });
        matched += 1;
      } else if (concierge) {
        const rows = parseConcierge(grid, concierge);
        const columns = Object.entries(concierge.map).filter(([, i]) => i >= 0).map(([field]) => field);
        result.inquiries.push(...rows);
        result.sheets.push({ file: file.name, sheet: sheetName, kind: "concierge", rows: rows.length, columns });
        matched += 1;
      }
    }
    if (!matched) result.problems.push(`${file.name}: no sheet had the expected headers (Date, Patient Name and Total Payment for sales; Channel and Status for the concierge log).`);
  }
  return result;
}

/** Builds a blank two-sheet template showing the columns the dashboard understands. */
export function downloadTemplate() {
  const sales = [
    ["Date", "Transaction No.", "Patient Name", "Patient Type", "Status", "Source", "Referring Physician", "Department", "Test Examination", "Patient Category", "Gross Amount", "Discount", "Total Payment"],
    ["09/01/2026 9:15 AM", "TRX-0001", "Juan Dela Cruz", "NEW", "PAID", "Doctor's Referral", "Dr. Maria Santos", "ECHO", "2D Echo with Doppler", "SENIOR", 3500, 700, 2800],
    ["09/01/2026 9:15 AM", "TRX-0001", "Juan Dela Cruz", "NEW", "PAID", "Doctor's Referral", "Dr. Maria Santos", "LABORATORY", "Lipid Profile", "SENIOR", 900, 180, 720],
    ["09/01/2026 10:40 AM", "TRX-0002", "Ana Reyes", "HMO/NEW", "PAID", "Facebook", "", "ECG", "12-Lead ECG", "REGULAR", 450, 0, 450],
    ["09/01/2026 11:05 AM", "TRX-0003", "Pedro Garcia", "SCHEDULED", "PAID", "Family/Relatives", "", "CARDIOVASCULAR", "Treadmill Stress Test", "REGULAR", 2800, 0, 2800],
    ["09/01/2026 1:20 PM", "TRX-0004", "Rosa Mendoza", "WALK-IN", "PAID", "Passed By", "", "LABORATORY", "CBC", "PWD", 350, 70, 280],
    ["09/01/2026 2:00 PM", "TRX-0005", "Carlos Ramos", "HMO", "PAID", "Doctor's Referral", "Dr. Maria Santos", "ECHO", "2D Echo with Doppler", "REGULAR", 3500, 0, 3500],
    ["09/01/2026 3:10 PM", "TRX-0006", "Lita Navarro", "HOME SERVICE", "PAID", "Family/Relatives", "", "LABORATORY", "Lipid Profile", "SENIOR", 900, 180, 720],
    ["09/01/2026 3:30 PM", "TRX-0007", "Partner Clinic Sample 1", "SEND-IN", "PAID", "", "", "LABORATORY", "FBS", "REGULAR", 200, 0, 200],
    ["09/01/2026 4:00 PM", "TRX-0008", "Trial Participant 014", "CLINICAL TRIAL", "PAID", "", "", "ECG", "12-Lead ECG", "REGULAR", 450, 0, 450],
  ];
  // Same layout as the concierge scheduling tracker, plus the optional CRM columns.
  const concierge = [
    ["#", "New or Returning Patient", "Date", "Time", "Channel / Source", "Name", "Contact Number", "Procedure / Test", "Branch", "Mode of Payment", "Inquired", "If not booked, schedule of follow-up", "If booked, send a reminder", "Booked (Date of Booking)", "No Show", "Served", "Revenue (Cost of Procedure)", "Other Applicable Actions (Follow-up)", "Appointment Date", "Staff", "Date Responded", "Referred By", "Campaign"],
    [1, "New", "Sep 14, 2026", "8:02 AM", "Viber", "Mark Dizon", "0917-000-0001", "24 Hrs Holter Monitoring", "Angeles", "—", "Asked about price and duration", "Sep 17, 2026", "—", "—", "No", "No", "—", "Follow up regarding preferred schedule", "—", "Ana", "Sep 14, 2026 8:15 AM", "", ""],
    [2, "Returning", "Sep 14, 2026", "9:30 AM", "Doctor's Referral", "Liza Cruz", "0917-000-0002", "2D Echo", "Angeles", "Cash", "Requested earliest available slot", "—", "Sep 15, 2026 – SMS Reminder", "Sep 14, 2026", "No", "Yes", "₱3,500", "Results released to patient", "Sep 16, 2026", "Ana", "Sep 14, 2026 9:34 AM", "Dr. Maria Santos", ""],
    [3, "New", "Sep 15, 2026", "1:10 PM", "Facebook Messenger", "Joshua Lim", "0917-000-0003", "Treadmill Stress Test", "Malolos", "—", "Asked whether HMO is accepted", "—", "Sep 17, 2026 – SMS Reminder", "Sep 15, 2026", "Yes", "No", "—", "Contacted patient to offer rescheduling", "Sep 18, 2026", "Ben", "Sep 15, 2026 2:05 PM", "", "Heart Month FB ad"],
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sales), "Sales Report");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(concierge), "Scheduling Tracker");
  XLSX.writeFile(book, "THSC CEO Dashboard template.xlsx");
}
