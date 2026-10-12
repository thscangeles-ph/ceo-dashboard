# THSC Summary Dashboard

The one-screen summary dashboard for The Heart Specialists Clinic & Diagnostic. Upload the Excel export and it generates the Summary Dashboard:

- **Patients by type**: NEW, Returning (Scheduled, Walk-in, HMO), Home service, Send-in and Clinical trial, with patients, visits, revenue and share for each
- **KPIs**: patients, total revenue, average and median revenue per patient, items per visit, discounts given
- **CEO briefing**: where revenue came from (by source group), findings computed from the data, and suggested decisions for the next leadership meeting
- **Full funnel** from the Central Concierge log (when uploaded): inquiries → booked → served, conversion by channel, branch split, leads needing follow-up
- **Daily volume**: patients and revenue per day
- **Where new patients come from**: revenue, patients and average per patient by source (NEW and HMO/NEW only, since returning patients have no source)
- **Revenue mix**: by service line (department) and by patient category (Regular, Senior, PWD)
- **Top referring physicians**
- **Inquiry Tracker tab**: the scheduling tracker as a working sheet, with a Next Step box for every inquiry (see **Inquiry Tracker** below)
- **CRM Dashboard tab** (built from the Inquiry Tracker), organised by the eight CRM functions: inquiry management (what patients ask, weekly trend, next step recorded), appointment management (bookings, no-shows, cancellations), follow-up reminders (a follow-up queue of overdue and upcoming call-backs, reminder coverage), patient retention (recall list, new vs. returning), referral management, marketing analysis (booking rate and revenue per channel or campaign), concierge monitoring (when inquiries arrive, branches, staff and response time) and business analytics (demand by procedure)

**Everything is clickable.** Click a KPI card, chart bar, bar segment, legend item, finding or table row to open a details panel with the records behind that number: patients, visits, revenue, breakdowns by patient type and service, and the billed line items, which can be downloaded as Excel. Patient names are not shown for sales data.

Marketing spend and acquisition cost are **not** part of this app. They live in the separate THSC Patient Acquisition Dashboard.

Out of the box, workbooks are processed in the browser and never uploaded to a server, and no environment variables are needed. Connect Supabase (see **Accounts and shared data**) to add logins and share the data across the team.

## Data stays saved on the device

The latest uploads and every inquiry logged or updated in the app are saved on the device (in the browser's IndexedDB), so the dashboard is still there after a refresh or closing the app. The bar under the header shows when it was last saved. Untick **Keep on this device** on shared computers, and **Start over** clears everything.

This storage belongs to that one browser on that one device. To see the same data on every phone and computer, the app needs accounts and a cloud database (for example Supabase), with Data Privacy Act safeguards for patient information.

## Accounts and shared data (Supabase)

With Supabase connected, everyone signs in and the whole team shares one set of data on every computer and phone. Without it, the app keeps working on each device only (above).

**Account types**

| Account | Sees and does |
| --- | --- |
| **CEO / Doctor** | Everything: Sales Dashboard, CRM Dashboard, Inquiry Tracker, and **Team** to create accounts and change access |
| **Concierge** | Inquiry Tracker (add and update inquiries, export the Excel file) and CRM Dashboard, with patient names and numbers |
| **Marketing** | Read-only Sales Dashboard and CRM Dashboard (no Inquiry Tracker). Patient names become codes (e.g. "Patient 091CEC") and contact numbers are removed; no uploads or edits |

The database enforces this (Row Level Security and de-identified views), not only the screens.

**One-time setup**

1. **Supabase → SQL Editor → New query:** paste all of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. Run it again whenever this file changes; it is safe to re-run.
2. **Authentication → Sign In / Providers:** turn off **Allow new users to sign up**.
3. **Authentication → URL Configuration:** set **Site URL** to the app's Vercel address and add it under **Redirect URLs** (invite and password-reset emails link there).
4. **Email templates** (optional; only if you want email invitations). On the free plan Supabase only lets you edit templates after connecting your own email sender (Authentication → Emails → **Set up SMTP**). Without it, create accounts with a password instead (the default in Team → Add person). With SMTP set up, change these two templates so email apps that pre-open links to scan them can't use them up: in **Authentication → Emails → Templates**, replace the link in two templates:
   - **Invite user:** `<a href="{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=invite">Accept the invite and set your password</a>`
   - **Reset password:** `<a href="{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=recovery">Set a new password</a>`

   The link then opens a page with a **Continue** button, and the one-time code is only used when the person clicks it.
5. **Find the keys:**
   - **Project URL:** Project Settings → **Data API** (also shown under the **Connect** button at the top of the dashboard).
   - **Public key:** Project Settings → **API Keys** → the **Publishable** key (`sb_publishable_…`), or under **Legacy API Keys** the **anon** key.
   - **Server key** (only for creating accounts in the app): same page → **Secret** key (`sb_secret_…`), or the legacy **service_role** key.
6. **Vercel → your project → Settings → Environment Variables:** add, for Production and Preview:
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = publishable / anon key
   - `SUPABASE_SERVICE_ROLE_KEY` = secret / service_role key. Server-only: never add a `NEXT_PUBLIC_` prefix to it and never share it.

   Then **Deployments → ⋯ on the latest → Redeploy**. Variables only apply to new deployments.
7. **Create your own login:** Authentication → Users → **Add user → Create new user**, with **Auto confirm user** ticked.
8. **Make it CEO / Doctor:** in the SQL Editor run `update public.profiles set role = 'admin' where email = 'you@example.com';` with your email.
9. Sign in to the app. If the device still has data from before, click **Move to shared**.

**Adding people:** open **Team → Add person**, enter name and email, pick **CEO / Doctor**, **Concierge** or **Marketing**, and either email them an invitation (they choose their password) or set a temporary password to share yourself. Change anyone's access, or set **No access**, from the same list. If an invite link expired or someone is locked out, click **Set password** next to them and give them the new password privately; they can change it later with **Forgot your password?**. Without the server key, add people in Supabase → Authentication → Users and set their access in Team.

Patient names, contact numbers and procedures are sensitive personal information under the Data Privacy Act of 2012; agree on who gets which account with the clinic's Data Protection Officer, and sign out on shared computers.

## Inquiry Tracker

The Inquiry Tracker tab is where inquiries are logged and kept up to date. The CRM Dashboard is built from it and is read-only: it has no add or edit buttons, and its follow-up queue opens the patient in the tracker.

- **Same layout as the Excel file:** one row per inquiry in the scheduling tracker's columns and order (New or Returning Patient, Date, Time, Channel / Source, Name, Contact Number, Procedure / Test, Branch, Mode of Payment, Inquired, **Responded**, follow-up, reminder, Booked, No Show, Served, Revenue, Other Applicable Actions), numbered like the sheet.
- **Edit like Excel:** click a cell (or select it and press Enter), type, then press Enter to save or Esc to cancel. Yes/No columns are drop-downs.
- **Responded (YES/NO):** whether staff replied to the inquiry. Unanswered inquiries are flagged, and price questions without a reply have their own filter. Sheets without this column count an inquiry as answered once a booking, follow-up date, reminder or action is recorded.
- **Next step / status box** on every row: *Reply with the price* or *Reply to the inquiry* (no reply yet), *Follow up* (with the date, overdue or due today), *Set a follow-up date*, *Send a reminder*, *Wait for the appointment*, *Mark Served or No-show* (appointment date passed), *Call to reschedule* (no-show), or **Complete** (served, cancelled, or closed as lost). Click it to open the full form, where the outcome, lost reason and other details are set.
- **Filters:** Needs action, Overdue, Not responded, Price question with no reply, Scheduled, Complete; plus search, branch and sort (newest, oldest as in Excel, or most urgent).
- **Add inquiry** opens the form for a new inquiry.
- **Export Excel** downloads the tracker in the original sheet's layout (the OUTCOME (REMARKS) heading over No Show and Served, the same column widths, filters on the header row) with Responded and Next Step / Status added. The file can be uploaded again. Rows are matched, not duplicated, and edits made in the app win over older copies of the same row.

## Install on a PC, phone or tablet

The dashboard is a Progressive Web App. Once installed, it opens in its own window (or full screen on a phone) and keeps working without a connection.

- **Windows / Mac (Chrome or Edge):** open the site and click **Install app** in the header, or the install icon in the address bar. On a computer, Excel files can also be opened with the installed app ("Open with → Summary Dashboard").
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

**Scheduling tracker (CRM Dashboard)**: the concierge sheet staff fill in for every inquiry, as a separate file or another sheet. The app recognises its columns: `New or Returning Patient`, `Date`, `Time`, `Channel / Source`, `Name`, `Contact Number`, `Procedure / Test`, `Branch`, `Mode of Payment`, `Inquired`, `If not booked, schedule of follow-up`, `If booked, send a reminder`, `Booked (Date of Booking)`, `No Show`, `Served`, `Revenue (Cost of Procedure)` and `Other Applicable Actions (Follow-up)`. Optional columns unlock more of the CRM: `Responded (YES/NO)` (replies, unanswered price questions), `Staff` (staff performance), `Date Responded` (response time), `Referred By` (referral partners), `Campaign` (marketing) and `Appointment Date` (reminder timing, recalls). Simpler logs with `Channel` and `Status` (Booked, Served, No-show, No booking) still work.

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

No environment variables are required for device-only use. For accounts, add the two Supabase variables from `.env.example` (see **Accounts and shared data**).
