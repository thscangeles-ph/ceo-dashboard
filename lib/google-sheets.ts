// Server only: reads the patient feedback Google Sheet with a Google service account (a "robot" account
// the sheet is shared with, view-only). The account's key comes from GOOGLE_SERVICE_ACCOUNT_JSON in Vercel
// and never reaches the browser.
import { createSign } from "node:crypto";
import type { FeedbackSheet } from "@/lib/feedback";

// The clinic's feedback responses sheet (its ID is in the sheet's link; it is not a secret).
const DEFAULT_SHEET_ID = "1Hxyp-FWC3M___dVTR_wuZRI3L22MBWClj4ncPD-YUU4";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

type ServiceAccount = { client_email: string; private_key: string };

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim().replace(/^'+|'+$/g, "");
  if (!raw) return null;
  let parsed: Partial<ServiceAccount>;
  try { parsed = JSON.parse(raw); } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON in Vercel isn't the key file's contents. Open the downloaded .json key in Notepad or TextEdit, copy all of it, paste it as the value, then redeploy.");
  }
  if (!parsed.client_email || !parsed.private_key) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key. Paste the whole .json key file, then redeploy.");
  // Keys pasted through some tools arrive with "\n" written out instead of line breaks.
  return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, "\n") };
}

let token: { value: string; expires: number; email: string } | null = null;
async function accessToken(account: ServiceAccount) {
  if (token && token.email === account.client_email && token.expires > Date.now() + 60_000) return token.value;
  const now = Math.floor(Date.now() / 1000);
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })}`;
  let signature: string;
  try { signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key, "base64url"); } catch {
    throw new Error("The private key in GOOGLE_SERVICE_ACCOUNT_JSON can't be read. Paste the whole .json key file again, then redeploy.");
  }
  const response = await fetch(TOKEN_URL, {
    method: "POST", cache: "no-store",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`Google refused the robot account's key (${body.error_description || body.error || `HTTP ${response.status}`}). If the key was deleted in Google Cloud, create a new one and replace GOOGLE_SERVICE_ACCOUNT_JSON in Vercel.`);
  }
  token = { value: body.access_token, expires: Date.now() + (Number(body.expires_in) || 3600) * 1000, email: account.client_email };
  return token.value;
}

async function google<T>(url: string, bearer: string, robot: string): Promise<T> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${bearer}` }, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (response.ok) return body as T;
  const message: string = body?.error?.message || `HTTP ${response.status}`;
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(message) || body?.error?.status === "PERMISSION_DENIED" && /API/i.test(message)) {
    throw new Error("The Google Sheets API is switched off in the Google Cloud project. Go to Google Cloud → APIs & Services → Library → Google Sheets API → Enable, wait a minute, then click Refresh.");
  }
  if (response.status === 403) throw new Error(`The robot account can't open the feedback sheet yet. In Google Sheets click Share, add ${robot} as a Viewer, then click Refresh.`);
  if (response.status === 404) throw new Error("The feedback sheet wasn't found. Check FEEDBACK_SHEET_ID in Vercel (the long code in the sheet's link).");
  throw new Error(`Google Sheets: ${message}`);
}

// Dates come from Google as serial numbers (days since 30 Dec 1899), so they never depend on the sheet's locale.
const pad = (n: number) => String(n).padStart(2, "0");
function serialToText(serial: number) {
  const time = Math.round((serial % 1) * 1440);
  const clock = `${pad(Math.floor(time / 60) % 24)}:${pad(time % 60)}`;
  if (serial < 1) return clock;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return time ? `${day}T${clock}` : day;
}
const looksLikeDate = (shown: string) => /\d\s*[/-]\s*\d|\d:\d\d|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(shown);

let cache: { at: number; body: FeedbackSheet } | null = null;

/** The feedback sheet's response tab (RAW DATA, or the first tab) as a header row and text rows. */
export async function readFeedbackSheet(fresh = false): Promise<FeedbackSheet> {
  const fetchedAt = new Date().toISOString();
  const empty: FeedbackSheet = { status: "ok", title: "", tab: "", headers: [], rows: [], firstRow: 2, message: "", robot: "", fetchedAt };
  let account: ServiceAccount | null;
  try { account = serviceAccount(); } catch (e) { return { ...empty, status: "error", message: (e as Error).message }; }
  if (!account) return { ...empty, status: "not-configured", message: "The dashboard can't read the feedback sheet yet: GOOGLE_SERVICE_ACCOUNT_JSON isn't set in Vercel. See the README (Patient Feedback) for the steps, then redeploy." };
  // A short server cache so a busy morning doesn't use up Google's read limit.
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.body;
  const robot = account.client_email;
  try {
    const bearer = await accessToken(account);
    const id = encodeURIComponent(process.env.FEEDBACK_SHEET_ID?.trim() || DEFAULT_SHEET_ID);
    const meta = await google<{ properties?: { title?: string }; sheets?: { properties: { title: string; index: number } }[] }>(`${SHEETS}/${id}?fields=properties.title,sheets.properties(title,index)`, bearer, robot);
    const tabs = (meta.sheets || []).map((s) => s.properties).sort((a, b) => a.index - b.index);
    const wanted = process.env.FEEDBACK_SHEET_TAB?.trim();
    const tab = (wanted && tabs.find((t) => t.title.toLowerCase() === wanted.toLowerCase())) || tabs.find((t) => /raw\s*data/i.test(t.title)) || tabs[0];
    if (!tab) throw new Error("The feedback sheet has no tabs.");
    const range = encodeURIComponent(`'${tab.title.replace(/'/g, "''")}'`);
    // The shown text (what people see in the sheet) and the raw values (to recognise dates reliably).
    const [shown, raw] = await Promise.all([
      google<{ values?: string[][] }>(`${SHEETS}/${id}/values/${range}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`, bearer, robot),
      google<{ values?: unknown[][] }>(`${SHEETS}/${id}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS`, bearer, robot),
    ]);
    const grid = (shown.values || []).map((row, r) => row.map((cell, c) => {
      const value = raw.values?.[r]?.[c];
      const text = String(cell ?? "").trim();
      return typeof value === "number" && looksLikeDate(text) ? serialToText(value) : text;
    }));
    const headerAt = grid.findIndex((row) => row.filter(Boolean).length >= 2);
    const headers = headerAt >= 0 ? grid[headerAt].map((h, i) => h || `Column ${i + 1}`) : [];
    // Blank rows stay in place (and trailing ones are dropped) so each response keeps its row number in the sheet.
    const rows = headerAt >= 0 ? grid.slice(headerAt + 1) : [];
    while (rows.length && !rows.at(-1)!.some(Boolean)) rows.pop();
    const body: FeedbackSheet = { ...empty, title: meta.properties?.title || "", tab: tab.title, headers, rows, firstRow: headerAt + 2, robot };
    cache = { at: Date.now(), body };
    return body;
  } catch (e) {
    return { ...empty, status: "error", robot, message: (e as Error).message };
  }
}
