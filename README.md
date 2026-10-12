# THSC CEO Dashboard

The one-screen summary dashboard for The Heart Specialists Clinic & Diagnostic. Upload the Excel export and it generates the CEO Summary Dashboard:

- **Patients by type**: NEW, Returning (Scheduled, Walk-in, HMO), Home service, Send-in and Clinical trial, with patients, visits, revenue and share for each
- **KPIs**: patients, total revenue, average and median revenue per patient, items per visit, discounts given
- **CEO briefing**: where revenue came from (by source group), findings computed from the data, and suggested decisions for the next leadership meeting
- **Full funnel** from the Central Concierge log (when uploaded): inquiries → booked → served, conversion by channel, branch split, leads needing follow-up
- **Daily volume**: patients and revenue per day
- **Where new patients come from**: revenue, patients and average per patient by source (NEW and HMO/NEW only, since returning patients have no source)
- **Revenue mix**: by service line (department) and by patient category (Regular, Senior, PWD)
- **Top referring physicians**
- **Patient CRM tab** (from the scheduling tracker), organised by the eight CRM functions: inquiry management (what patients ask, weekly trend, next step recorded), appointment management (bookings, no-shows, cancellations), follow-up reminders (a follow-up queue of overdue and upcoming call-backs, reminder coverage), patient retention (recall list, new vs. returning), referral management, marketing analysis (booking rate and revenue per channel or campaign), concierge monitoring (when inquiries arrive, branches, staff and response time) and business analytics (demand by procedure)

**Everything is clickable.** Click a KPI card, chart bar, bar segment, legend item, finding or table row to open a details panel with the records behind that number: patients, visits, revenue, breakdowns by patient type and service, and the billed line items, which can be downloaded as Excel. Patient names are not shown for sales data.

Marketing spend and acquisition cost are **not** part of this app. They live in the separate THSC Patient Acquisition Dashboard.

Workbooks are processed in the browser and never uploaded to a server. There is no database, and no environment variables are needed.

## Data stays saved on the device

The latest uploads and every inquiry logged or updated in the app are saved on the device (in the browser's IndexedDB), so the dashboard is still there after a refresh or closing the app. The bar under the header shows when it was last saved. Untick **Keep on this device** on shared computers, and **Start over** clears everything.

This storage belongs to that one browser on that one device. To see the same data on every phone and computer, the app needs accounts and a cloud database (for example Supabase), with Data Privacy Act safeguards for patient information.

## Working CRM

The Patient CRM tab is not only a report. Staff can:

- **Log a new inquiry** (New inquiry button) with the same fields as the scheduling tracker.
- **Update an inquiry after a call:** click a patient in the follow-up queue, or **Update** on any inquiry in a details panel, and set the outcome (booked, served, no-show, cancelled, lost with a reason, or still open with a new follow-up date), reminder, revenue and next step.
- **Export tracker (.xlsx):** download every inquiry in the tracker's own column layout, to keep the Excel file and the app in step.

Edits made in the app win over older copies of the same row when the Excel file is uploaded again, and re-uploads never duplicate rows.

## Install on a PC, phone or tablet

The dashboard is a Progressive Web App. Once installed, it opens in its own window (or full screen on a phone) and keeps working without a connection.

- **Windows / Mac (Chrome or Edge):** open the site and click **Install app** in the header, or the install icon in the address bar. On a computer, Excel files can also be opened with the installed app ("Open with → CEO Dashboard").
- **Android (Chrome):** tap **Install app**, or browser menu → **Install app** / **Add to Home screen**.
- **iPhone and iPad:** open the site in Safari, tap **Share**, then **Add to Home Screen**. The **Install app** button shows these steps.

Installing requires HTTPS, so use the Vercel address. The service worker (`public/sw.js`) caches only the app's own files, never workbooks or patient data.

## Excel format

Upload one or more `.xlsx` / `.xls` files. Every sheet is checked, and the header row is found automatically (title rows above it are fine). Header names are matched without regard to case, spaces or punctuation.

**Detailed Sales Report** (one row per billed item). Required: `Date`, `Patient Name`, `Total Payment`. Used when present:

| Field | Accepted headers (examples) |
| --- | --- |
| Visit | `Transaction No.`, `OR No.`, `Invoice No.` |
| Patient type | `Patient Type` (see below) |
| Status | `Status`, `Payment Status` (PAID, UNPAID, …) |
| Source | `Source`, `Referral Source` |
| Referring physician | `Referring Physician`, `Referred By`, `Physician`, `Doctor`, `Source Details` |
| Service line | `Department`, `Section`, `Service Line`, or `Category` holding ECHO / LABORATORY … |
| Test | `Test Examination`, `Procedure`, `Service`, `Description` |
| Patient category | `Patient Category`, `Discount Type`, or `Category` holding REGULAR / SENIOR / PWD |
| Gross / discount | `Gross Amount`, `Amount`; `Discount` |

**Scheduling tracker (Patient CRM)**: the concierge sheet staff fill in for every inquiry, as a separate file or another sheet. The app recognises its columns: `New or Returning Patient`, `Date`, `Time`, `Channel / Source`, `Name`, `Contact Number`, `Procedure / Test`, `Branch`, `Mode of Payment`, `Inquired`, `If not booked, schedule of follow-up`, `If booked, send a reminder`, `Booked (Date of Booking)`, `No Show`, `Served`, `Revenue (Cost of Procedure)` and `Other Applicable Actions (Follow-up)`. Optional columns unlock more of the CRM: `Staff` (staff performance), `Date Responded` (response time), `Referred By` (referral partners), `Campaign` (marketing) and `Appointment Date` (reminder timing, recalls). Simpler logs with `Channel` and `Status` (Booked, Served, No-show, No booking) still work.

**Download template** on the start screen produces a workbook with both sheets and example rows.

### Patient types

The `Patient Type` column is grouped into the types the dashboard filters by:

| Dashboard type | Patient Type values |
| --- | --- |
| NEW | `NEW`, `HMO/NEW` |
| Returning patients | Scheduled + Walk-in + `HMO` |
| ↳ Scheduled | `SCHEDULED` (returning scheduled patients) |
| ↳ Walk-in | `WALK-IN` (returning walk-in patients) |
| Home service | `HOME SERVICE` |
| Send-in | `SEND-IN` |
| Clinical trial | `CLINICAL TRIAL` |

Spelling variants such as `WALK IN`, `SEND IN` or `Home Service` are recognized. The filter shows how many patients each type has; **All patient types** is the default.

### Counting rules

- One unique normalized `Patient Name` = one patient. Sales-report names are only used for counting and are never displayed.
- Visits = unique `Transaction No.`
- Source is only recorded for NEW patients (NEW and HMO/NEW). Source charts use new patients only, and blank or `N/A` values are ignored. Each new patient is credited to the first source recorded for them, with all their revenue in the period.
- Default filters: all patient types and Status = PAID (when a Status column exists). Both can be changed, along with a date range.
- Discounts on SENIOR / PWD rows are reported as statutory; any other discount is reported as discretionary.
- Uploading more files adds to what is loaded. Identical rows are counted once. **Start over** clears everything.

## Run locally

Requirements: Node.js 20.9 or newer and pnpm.

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`. The service worker only registers in production builds (`pnpm build && pnpm start`).

## Deploy to Vercel

1. In Vercel, choose **Add New → Project** and import `thscangeles-ph/ceo-dashboard`.
2. Vercel detects **Next.js** automatically. Keep the default build command (`next build`) and deploy.

No environment variables are required.
