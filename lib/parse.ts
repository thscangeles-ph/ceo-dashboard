import * as XLSX from "xlsx";

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

/** One inquiry from the Central Concierge log. */
export type InquiryRow = {
  date: Date | null;
  patient: string; // display name, shown in the follow-up list
  channel: string;
  branch: string;
  procedure: string;
  status: string;
  booked: boolean;
  served: boolean;
  noShow: boolean;
  followUp: string;
  remarks: string;
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

const CONCIERGE_FIELDS: FieldSpec = {
  date: ["Date", "Inquiry Date", "Date of Inquiry", "Date Received", "Timestamp"],
  patient: ["Patient Name", "Client Name", "Inquirer", "Name", "Patient", "Client"],
  channel: ["Channel", "Inquiry Channel", "Platform", "Mode of Inquiry", "Medium", "Contact Channel"],
  branch: ["Branch", "Clinic", "Location", "Site"],
  procedure: ["Procedure", "Service", "Inquired Procedure", "Procedure Inquired", "Service Inquired", "Test", "Inquiry About", "Concern"],
  status: ["Status", "Booking Status", "Outcome", "Result", "Inquiry Status"],
  booked: ["Booked", "Booked?", "Booking", "Converted", "Converted to Booking"],
  served: ["Served", "Attended", "Showed", "Show", "Completed", "Showed Up"],
  followUp: ["Follow-up Date", "Follow up Date", "Follow-up", "Follow Up", "Follow-up By", "Next Follow-up"],
  remarks: ["Remarks", "Notes", "Reason", "Reason for Not Booking", "Comments", "Lost Reason"],
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

function parseConcierge(grid: unknown[][], header: { index: number; map: Record<string, number> }) {
  const { map } = header;
  const at = (row: unknown[], field: string) => (map[field] >= 0 ? row[map[field]] : "");
  const rows: InquiryRow[] = [];
  grid.slice(header.index + 1).forEach((row) => {
    if (!row) return;
    const channel = clean(at(row, "channel"));
    const patient = clean(at(row, "patient"));
    if (!channel && !patient) return;
    const status = clean(at(row, "status"));
    const s = normalize(status);
    const noShow = /NO[\s-]?SHOW|DID NOT (ATTEND|SHOW|COME)|DIDN'?T (ATTEND|SHOW|COME)/.test(s);
    const notBooked = /NO[\s-]?BOOK|NOT BOOK|UNBOOK|UNCONVERTED|NOT CONVERTED|LOST|DECLINED|NO RESPONSE|INQUIRY ONLY/.test(s);
    const servedByStatus = !noShow && /SERVED|COMPLETED?|ATTENDED|DONE|SHOWED|PAID/.test(s);
    const served = map.served >= 0 ? yes(at(row, "served")) : servedByStatus;
    const booked = map.booked >= 0 ? yes(at(row, "booked")) || served || noShow : !notBooked && (served || noShow || /BOOK|CONFIRM|SCHEDUL|RESCHED|APPOINT/.test(s));
    const followRaw = at(row, "followUp");
    const followDate = parseDate(followRaw);
    rows.push({
      date: parseDate(at(row, "date")),
      patient, channel: channel || "Not recorded", status,
      branch: clean(at(row, "branch")) || "Not recorded",
      procedure: clean(at(row, "procedure")),
      booked, served, noShow,
      followUp: followDate ? followDate.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : clean(followRaw),
      remarks: clean(at(row, "remarks")),
      rowKey: [normalize(patient), normalize(channel), clean(at(row, "date")), normalize(at(row, "procedure"))].join("|"),
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
      const concierge = findHeader(grid, CONCIERGE_FIELDS, CONCIERGE_REQUIRED, (keys) => keys.some((key) => /STATUS|OUTCOME|BOOKED|RESULT/.test(key)));
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
  const concierge = [
    ["Date", "Patient Name", "Channel", "Branch", "Procedure", "Status", "Follow-up Date", "Remarks"],
    ["09/14/2026", "Mark Dizon", "Viber", "Angeles", "Holter Monitoring", "No booking", "09/17/2026", "Asked about price and duration"],
    ["09/14/2026", "Liza Cruz", "Call", "Malolos", "2D Echo", "Served", "", ""],
    ["09/15/2026", "Joshua Lim", "Facebook Messenger", "Malolos", "Treadmill Stress Test", "No-show", "", "Rescheduling offered"],
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sales), "Sales Report");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(concierge), "Concierge Log");
  XLSX.writeFile(book, "THSC CEO Dashboard template.xlsx");
}
