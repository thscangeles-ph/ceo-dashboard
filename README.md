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

**Everything is clickable.** Click a KPI card, chart bar, bar segment, legend item, finding or table row to open a details panel with the records behind that number: patients, visits, revenue, breakdowns by patient type and service, and the billed line items, which can be downloaded as Excel. Patient names are not shown for sales data.

Marketing spend and acquisition cost are **not** part of this app. They live in the separate THSC Patient Acquisition Dashboard.

Workbooks are processed in the browser. Nothing is uploaded to a server, there is no database, and no environment variables are needed.

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

**Central Concierge log** (one row per inquiry, as a separate file or another sheet). Required: `Channel` and `Status`. Status values such as *Booked*, *Served/Completed*, *No-show* and *No booking* drive the funnel. Also used: `Date`, `Patient Name`, `Branch`, `Procedure`, `Follow-up Date`, `Remarks`.

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
