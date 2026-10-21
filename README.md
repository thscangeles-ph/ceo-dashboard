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
- **Inquiry Tracker tab**: the concierge inquiry tracker as a working sheet, with a Next Step box for every inquiry (see **Inquiry Tracker** below)
- **CRM Dashboard tab** (built from the Inquiry Tracker), organised by the eight CRM functions: inquiry management (what patients ask, weekly trend, next step recorded), appointment management (bookings, no-shows, cancellations), follow-up reminders (a follow-up queue of overdue and upcoming call-backs, reminder coverage), patient retention (recall list, new vs. returning), referral management, marketing analysis (booking rate and revenue per channel or campaign), concierge monitoring (when inquiries arrive, branches, staff and response time) and business analytics (demand by procedure)

**PDF reports.** Every tab has a **Download PDF** button that writes a report of exactly what the tab shows, for the period and filters chosen there:

- **Sales Report:** the cards, patients by type, CEO briefing findings and suggested decisions, new patients by source, revenue by service line and patient category, top referring physicians and daily volume
- **Patient Acquisition Cost Report:** the cards (with cost per new patient), patients by type, new patients by source and cost by source with the spend entered
- **CRM Report:** the cards, inquiry outcomes, findings and the eight CRM areas, including the follow-up queue (not in Marketing accounts' reports)
- **Inquiry Tracker report:** the inquiries in the current view (use From / To for a period), with each one's next step
- **Patient Feedback Report:** the cards, interpretation & analysis, the trend by month of visit, results by service, every question's answer counts per service, who answered, the responses that need follow-up and the comments (marked confidential)
- **Podcast Report (YouTube):** subscribers and views, episodes vs clips, top videos, latest uploads, and the schedule (what is not yet published, and how the published ones are doing)

Reports that list patients are marked confidential in the footer of every page. The PDF is made in the browser; nothing is sent to a server.

**Everything is clickable.** Click a KPI card, chart bar, bar segment, legend item, finding or table row to open a details panel with the records behind that number: patients, visits, revenue, breakdowns by patient type and service, and the billed line items, which can be downloaded as Excel. Patient names are not shown for sales data.

**Patient Acquisition Cost tab** (formerly the separate THSC Patient Acquisition Dashboard), from the same uploaded sales reports:

- Patient type filter (NEW by default), status, a date range, and the **total marketing spend** for that range
- Unique patients, transactions and revenue for the chosen type, and **acquisition cost per new patient** (spend ÷ NEW and HMO/NEW patients in the range)
- **Patients by type** table (click a row to switch the cards), new patients by acquisition source (each new patient counted once, under the first source they gave), and **cost by source** with a spend box per source
- Spend is saved per date range: pick the month first, then enter that month's spend. With accounts it is shared with the team; Admin, ManCom and Doctors can change it, Marketing can view it, Concierge doesn't see this tab.

**Patient Feedback** (its own sidebar group) has two tabs that work the same way, each live from its own Google Sheet: **In-Person Survey** (the paper survey typed into the feedback form; the sheet's **RAW DATA** tab) and **QR Survey** (the survey patients answer themselves by scanning the QR code; its RAW DATA tab, or the form's responses tab). Both sheets are shared, view-only, with the same robot account. In a sheet without a date-of-visit question, the period is the day the patient answered.

- **The period is the date of visit** (the day the patient answered the paper survey), never the day the answers were typed into the form. Choose a month, the last 30 or 90 days, this year, or any dates; a month is compared with the month before it.
- **Cards:** responses, **Satisfied** (Very Satisfied + Satisfied, out of the answers that weren't N/A), Very Satisfied with the average out of 5, **Would recommend** (yes / maybe / no), and how many responses need follow-up.
- **Interpretation & analysis**, worked out with every new response: overall results, the change from the previous period, the lowest-rated questions, the best and lowest-rated services, follow-ups and comments.
- **By service:** one column per service showing its share of ratings (Very Satisfied at the bottom), with % satisfied and responses under it; click a column to see only that service.
- **Monthly results by service**, like the CHARTS & TABLE tab: choose a month and it shows a "JULY 2026 = 29 TOTAL RESPONSES" banner, then for every service its answer counts per question (Very Satisfied, Satisfied, Neutral, Dissatisfied, N/A), a grouped column chart, and an **Interpretation & analysis** written from the numbers and compared with the month before.
- **Who answered:** gender, age, how they learned about THSC and how they reached THSC (patients who chose several ways count under each).
- **Needs follow-up:** every response with a Dissatisfied rating or worse, with what the patient wrote and its row number in the sheet.
- **Patients' comments & experiences**, like the COMMENTS tab: a column per month with every comment as a colored card: **Positive** (green), **Negative** (red), **Suggestion** (yellow) or **Experience** (orange). The type is a first guess from the words (English and Tagalog); change it with the menu on the card and it's saved for the whole team (needs the updated `supabase/schema.sql`). Click a type in the legend to hide or show it, or search.
- The sheet's questions aren't hard-coded: new questions, services or answer choices added to the form are picked up automatically. Columns with names, contact numbers or email addresses would be recognised and never shown.
- New responses appear within about two minutes while the tab is open (or click **Refresh**). Admin, ManCom, Doctors and Marketing can open it; Concierge can't. It needs accounts, and the sheet is read on the server with a Google service account (see **Deploy to Vercel**), so it stays private.

**Podcast Tracker & Scheduler** (formerly the separate THSC Podcast Tracker; YouTube only), in its own **Podcast** section of the sidebar:

- **YouTube tracker:** The Heart Speaks channel's subscribers, views and uploads straight from YouTube; full episodes (8 minutes or longer) vs clips & shorts; views per episode (latest 20); views by publish month; top videos; channel views and subscribers over time (one reading a day, saved whenever the tab is opened); and every upload with likes, comments and engagement rate. Filter by format and publish period, or click a row of the Episodes vs clips table. **Import export** adds watch time from a YouTube Studio export (Analytics → Advanced mode → Export → CSV, the Table data.csv file), which the public YouTube figures don't include.
- **Scheduler:** plan each episode, clip or YouTube Short from idea to published: title, guest doctor, host, recording date, time and location, YouTube publish date and time, status (Idea, Scheduled, Recorded, Editing, Published), the YouTube link and notes. A month calendar shows recording days and publish dates (click a day to plan on it); the schedule list flags anything whose recording or publish date has passed. Link a published entry to its video (paste the link or pick a recent upload) to see its live views.
- Admin, ManCom, Doctors and Marketing can use and change it; Concierge doesn't see it. With accounts the schedule, growth readings and imported exports are shared with the team; without accounts they stay in this browser.
- The figures need a **YouTube Data API key** in Vercel (see **Deploy to Vercel**). The key stays on the server and can only read public figures.

The app always uses the light look on a white page, even when the device is set to dark mode.

**Who sees what (with accounts).** Each account has **its own Sales Dashboard**: the sales files a person adds there are seen only by them, and other people's uploads never change it (an empty Sales Dashboard can start from a copy of the team's reports). **Patient Acquisition Cost is shared**: its sales report files (added on that tab by Admin, ManCom or Doctors) and the marketing spend are the same for everyone. The **Inquiry Tracker and CRM are shared and live**: when anyone adds or changes an inquiry, everyone's screen updates within seconds (every 30 seconds where live updates aren't available).

Out of the box, workbooks are processed in the browser and never uploaded to a server, and no environment variables are needed. Connect Supabase (see **Accounts and shared data**) to add logins and share the data across the team.

## Data stays saved on the device

The latest uploads and every inquiry logged or updated in the app are saved on the device (in the browser's IndexedDB), so the dashboard is still there after a refresh or closing the app. The bar under the header shows when it was last saved. Untick **Keep on this device** on shared computers, and **Start over** clears everything.

This storage belongs to that one browser on that one device. To see the same data on every phone and computer, the app needs accounts and a cloud database (for example Supabase), with Data Privacy Act safeguards for patient information.

## Accounts and shared data (Supabase)

With Supabase connected, everyone signs in and the whole team shares one set of data on every computer and phone. Without it, the app keeps working on each device only (above).

**Account types**

| Account | Sees and does |
| --- | --- |
| **Admin** | Everything: Sales Dashboard, Patient Acquisition Cost, CRM Dashboard, Inquiry Tracker, Patient Feedback, Podcast Tracker & Scheduler, and **Team** to create accounts and change access |
| **ManCom** | Everything, same as Admin |
| **Doctors** | Everything, same as Admin |
| **Concierge** | Inquiry Tracker (add and update inquiries, export the Excel file) and CRM Dashboard, with patient names and numbers |
| **Marketing** | Their own Sales Dashboard, Patient Feedback, and the Podcast Tracker & Scheduler (can change the schedule). Read-only Patient Acquisition Cost and CRM Dashboard (no Inquiry Tracker), where patient names become codes (e.g. "Patient 091CEC") and contact numbers are removed |

The database enforces this (Row Level Security and de-identified views), not only the screens. In the database the roles are stored as `admin`, `mancom`, `doctor`, `concierge` and `marketing`; accounts created as "CEO / Doctor" before these roles existed are `admin` and show as **Admin**.

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
8. **Make it Admin:** in the SQL Editor run `update public.profiles set role = 'admin' where email = 'you@example.com';` with your email.
9. Sign in to the app. If the device still has data from before, click **Move to shared**.

**"stack depth limit exceeded":** the database's access rules are calling each other in a loop. This happens if the `app_role` / `full_access` functions were switched to SECURITY INVOKER (for example by a Supabase Security Advisor "fix"). Run [`supabase/schema.sql`](supabase/schema.sql) again in the SQL Editor: it keeps the real checks in a private schema the API can't reach, so the Security Advisor has nothing to flag, and repairs the functions.

**"Error sending recovery email" / invite emails not arriving:** Supabase's built-in email sender only sends a few emails an hour, and only to addresses on the Supabase organization's team. Use **Team → Set password** instead, or connect your own sender in Supabase → Authentication → Emails → **SMTP Settings** (for example a Gmail account with an app password: host `smtp.gmail.com`, port `465`, username = the Gmail address, password = the app password).

**Adding people:** open **Team → Add person**, enter name and email, pick **Admin**, **ManCom**, **Doctors**, **Concierge** or **Marketing**, and set their password (Generate makes one), which you give them yourself. There are no email invitations or self-service resets: people can only use the app once an Admin, ManCom or Doctors account has added them. Change anyone's access, or set **No access**, from the same list. If an invite link expired or someone is locked out, click **Set password** next to them and give them the new password privately; there is no "forgot password" on the sign-in screen, so passwords are only given and reset this way. Without the server key, add people in Supabase → Authentication → Users and set their access in Team.

Patient names, contact numbers and procedures are sensitive personal information under the Data Privacy Act of 2012; agree on who gets which account with the clinic's Data Protection Officer, and sign out on shared computers.

## Inquiry Tracker

The Inquiry Tracker tab is where inquiries are logged and kept up to date. The CRM Dashboard is built from it and is read-only: it has no add or edit buttons, and its follow-up queue opens the patient in the tracker.

- **Same layout as the Excel file:** one row per inquiry in the concierge inquiry tracker's columns and order (New or Returning Patient, Date, Time, Channel / Source, Name, Contact Number, Procedure / Test, Branch, Mode of Payment, Inquired, **Responded**, follow-up, reminder, Booked, No Show, Served, Revenue, Other Applicable Actions), numbered like the sheet.
- **Edit like Excel:** click a cell (or select it and press Enter), type, then press Enter to save or Esc to cancel. Yes/No columns are drop-downs.
- **Responded (YES/NO):** whether staff replied to the inquiry. Unanswered inquiries are flagged, and price questions without a reply have their own filter. Sheets without this column count an inquiry as answered once a booking, follow-up date, reminder or action is recorded.
- **Next step / status box** on every row: *Reply with the price* or *Reply to the inquiry* (no reply yet), *Follow up* (with the date, overdue or due today), *Set a follow-up date*, *Send a reminder*, *Wait for the appointment*, *Mark Served or No-show* (appointment date passed), *Call to reschedule* (no-show), or **Complete** (served, cancelled, or closed as lost). Click it to open the full form, where the outcome, lost reason and other details are set.
- **Filters:** Needs action, Overdue, Not responded, Price question with no reply, Scheduled, Complete; plus search, branch and sort (newest, oldest as in Excel, or most urgent).
- **Tracker files** at the top of the tab: **Upload tracker file** adds the concierge inquiry tracker (.xlsx), and the list shows each tracker file uploaded, with its number of inquiries and upload date. Uploading adds new inquiries and updates existing ones without duplicating them, and changes made in the app are kept. The upload button is also on the CRM Dashboard. It only accepts a scheduling tracker; sales reports go in through **Add sales report** on the Sales Dashboard.
- **Add inquiry** opens the inquiry form, a large pop-up in two halves. Left: **1. Tracking** (handled by; responded, NO by default; first reply date and time once it is YES) and **2. Inquiry** (new or returning, date, time, **Channel**, name, contact, branch, procedure, what was asked). Right: **3. Outcome** in this order: Open lead (selected by default; follow-up date set to tomorrow unless changed), Booked (not yet served), Served, Cancelled, Lost, No-show. Everything typed is kept in CAPITALS. Every box shown is required: empty boxes show a red asterisk, and the inquiry can't be saved until all are filled (including at least one step for outcomes past Open lead).
- **Channel** is one of FB CALL, FB MESSENGER, SMS TEXT, CELLULAR CALL, VIBER CALL, VIBER MESSAGE, or **Others** with the channel typed in.
- **Actions / steps taken** (for every outcome except Open lead): each action is its own entry, stamped with the date, time, who added it and the outcome then. Concierge accounts can add steps (also by typing in the tracker's action cell) but can't delete them or delete an inquiry; only Admin, ManCom and Doctors can. The database enforces this too.
- **Export Excel** downloads the tracker in the original sheet's layout (the OUTCOME (REMARKS) heading over No Show and Served, the same column widths, filters on the header row) with Responded and Next Step / Status added. The file can be uploaded again. Rows are matched, not duplicated, and edits made in the app win over older copies of the same row.

## Install on a PC, phone or tablet

The dashboard is a Progressive Web App. Once installed it opens in its own window (or full screen on a phone), gets a home-screen / Dock / Start-menu icon, stays signed in, and opens even without a connection.

An **Install app** button is in the header on every screen, including the sign-in page, and is hidden inside the installed app:

- **Windows / Mac in Chrome or Edge, and Android in Chrome:** the button opens the browser's install prompt; click **Install**. (Also: the install icon in the address bar, or the browser menu → Install.)
- **iPhone and iPad:** the button shows the steps: Safari → **Share** → **Add to Home Screen** → **Add**.
- **Mac Safari:** **File → Add to Dock**. **Firefox** can't install web apps; the button says to use Chrome or Edge.

Installing requires HTTPS, so use the Vercel address. On a computer, Excel files can also be opened with the installed app ("Open with → Summary Dashboard"). The service worker (`public/sw.js`) caches only the app's own files, never workbooks or patient data.

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

The app opens with all its tabs even before any file is added; each tab says what is missing. **Download template** (Sales Dashboard tab, before a sales report is added) produces a workbook with both sheets and example rows.

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
- **Sales report files** (on the Sales Dashboard tab; Admin, ManCom and Doctors only) lists every uploaded sales report with its rows and dates. **Add sales report** uploads another one; **Remove** takes a file back out, deleting only the rows no other uploaded file contains. Files uploaded before this list existed are not tracked one by one, so they can only be removed together.

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

**Patient Feedback (the feedback Google Sheet):** the sheet stays private and is shared, view-only, with a Google service account (a robot account) that only this app's server uses.

1. **Google Cloud** (the same project as the YouTube key): APIs & Services → Library → **Google Sheets API** → Enable.
2. IAM & Admin → **Service Accounts** → Create service account (any name, no roles) → open it → **Keys** → Add key → Create new key → **JSON**. A .json file downloads: treat it like a password.
3. Copy the service account's email (…@….iam.gserviceaccount.com). In the feedback Google Sheet click **Share**, add that email as **Viewer**, untick Notify people, Share.
4. **Vercel → this project → Settings → Environment Variables:** `GOOGLE_SERVICE_ACCOUNT_JSON` = the whole contents of the .json file (open it in Notepad or TextEdit, copy all), for Production and Preview, then redeploy. Delete the downloaded file afterwards.

Share **both** feedback sheets (the in-person survey and the QR survey) with the robot account in step 3. The app reads each sheet's tab named RAW DATA (then Form Responses, then the first tab). Optional: `FEEDBACK_SHEET_ID` / `FEEDBACK_SHEET_TAB` for the in-person sheet and `FEEDBACK_QR_SHEET_ID` / `FEEDBACK_QR_SHEET_TAB` for the QR sheet (the long code in a sheet's link, and a tab's name). If the tab says the robot account can't open the sheet, step 3 is missing; if it says the Sheets API is switched off, step 1 is.

**Podcast Tracker (YouTube figures):** add `YOUTUBE_API_KEY` in Vercel → this project → Settings → Environment Variables (Production and Preview), then redeploy. It is a Google Cloud API key with the **YouTube Data API v3** enabled; if the old THSC Podcast Tracker project on Vercel already has one, copy that value. It is read on the server only: never add a `NEXT_PUBLIC_` prefix. Optional: `YOUTUBE_CHANNEL_ID` or `YOUTUBE_HANDLE` to track another channel (the default is The Heart Speaks), and `YOUTUBE_MAX_VIDEOS` (default 500).
