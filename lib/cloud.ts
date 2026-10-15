import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import type { AcquisitionSpend } from "./acquisition";
import { spendKey } from "./acquisition";
import type { InquiryRow, SalesRow, SheetSummary } from "./parse";
import { sheetKey } from "./parse";

/**
 * Shared cloud storage and logins (Supabase). Turned on by setting NEXT_PUBLIC_SUPABASE_URL and
 * NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) in Vercel. Without them
 * the app keeps working on the device only. The key is public by design; Row Level Security in
 * supabase/schema.sql decides what each signed-in person can read or change.
 */
// Pasted values often carry spaces, line breaks or quotes, which Supabase rejects as "Invalid API key".
const tidy = (value?: string) => value?.trim().replace(/^["']+|["']+$/g, "").trim() || undefined;
const URL = tidy(process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/(rest|auth)\/v1\/?$/, "").replace(/\/+$/, "");
const KEY = tidy(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) || tidy(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

/** A secret / service_role key must never be used in the browser: it bypasses every access rule. */
function isSecretKey(key?: string) {
  if (!key) return false;
  if (key.startsWith("sb_secret_")) return true;
  try { return JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role === "service_role"; } catch { return false; }
}
/** Set when the Vercel settings are wrong in a way the app can tell before calling Supabase. */
export const configProblem = !URL || !KEY ? "" : isSecretKey(KEY)
  ? "Setup problem: NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel holds the SECRET key. Replace it with the publishable (anon) key, redeploy, and then rotate the secret key in Supabase because it was exposed."
  : !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(URL) && !/^http:\/\/localhost:\d+$/.test(URL)
    ? `Setup problem: NEXT_PUBLIC_SUPABASE_URL in Vercel should look like https://abcdefgh.supabase.co (it is "${URL}"). Fix it and redeploy.`
    : "";

let client: SupabaseClient | null = null;
export function getCloud() {
  if (!URL || !KEY || configProblem || typeof window === "undefined") return null;
  client ??= createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}
export const cloudConfigured = Boolean(URL && KEY);

/**
 * admin = Admin, mancom = ManCom, doctor = Doctors: all three get everything. concierge = Inquiry Tracker
 * and CRM Dashboard, marketing = read-only analytics without patient details. Listed in Team in this order.
 */
export type Role = "admin" | "mancom" | "doctor" | "concierge" | "marketing";
export const ROLE_LABEL: Record<Role, string> = { admin: "Admin", mancom: "ManCom", doctor: "Doctors", concierge: "Concierge", marketing: "Marketing" };
/** Roles with full access: every tab, sales reports and Team. */
export const FULL_ACCESS: Role[] = ["admin", "mancom", "doctor"];
export const isFullAccess = (role: Role | null | undefined) => Boolean(role && FULL_ACCESS.includes(role));
export const ROLE_DETAIL: Record<Role, string> = {
  admin: "Everything: own Sales Dashboard, Patient Acquisition Cost, CRM, Inquiry Tracker and Team",
  mancom: "Everything, same as Admin",
  doctor: "Everything, same as Admin",
  concierge: "Inquiry Tracker (add and update inquiries) and CRM Dashboard, with names and numbers",
  marketing: "Own Sales Dashboard; read-only Patient Acquisition Cost and CRM, patient details hidden",
};
export type Profile = { id: string; email: string; full_name: string; role: Role | null };
// Earlier versions called concierge accounts "staff".
const normalizeRole = (role: string | null): Role | null => (role === "staff" ? "concierge" : (role as Role | null));

export async function loadProfile(sb: SupabaseClient, userId: string): Promise<Profile | null> {
  const { data, error } = await sb.from("profiles").select("id, email, full_name, role").eq("id", userId).maybeSingle();
  if (error) throw new Error(friendly(error.message));
  return data ? { ...(data as Profile), role: normalizeRole((data as Profile).role) } : null;
}

export async function listProfiles(sb: SupabaseClient): Promise<Profile[]> {
  const { data, error } = await sb.from("profiles").select("id, email, full_name, role").order("email");
  if (error) throw new Error(friendly(error.message));
  return ((data || []) as Profile[]).map((p) => ({ ...p, role: normalizeRole(p.role) }));
}

/** Changes the name shown for a person (Team list, step history). */
export async function setProfileName(sb: SupabaseClient, id: string, fullName: string) {
  const { error } = await sb.from("profiles").update({ full_name: fullName }).eq("id", id);
  if (error) throw new Error(friendly(error.message));
}

export async function setProfileRole(sb: SupabaseClient, id: string, role: Role | null) {
  const { error } = await sb.from("profiles").update({ role }).eq("id", id);
  if (error) throw new Error(friendly(error.message));
}

// Dates travel as ISO strings inside jsonb; turn them back into Date objects.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export function revive<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map(revive) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === "string" && ISO.test(v) ? new Date(v) : revive(v)])) as T;
  }
  return value as T;
}

const PAGE = 1000;
async function fetchAll<T>(sb: SupabaseClient, table: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select("data").order("key").range(from, from + PAGE - 1);
    if (error) throw new Error(friendly(error.message));
    out.push(...(data || []).map((r: { data: unknown }) => revive<T>(r.data)));
    if (!data || data.length < PAGE) return out;
  }
}

/** The shared inquiries (Inquiry Tracker and CRM), for the live refresh. */
export const loadInquiries = (sb: SupabaseClient, role: Role) => fetchAll<InquiryRow>(sb, role === "marketing" ? "inquiries_marketing" : "inquiries");

/** This account's own Sales Dashboard files (personal_sales; nobody else can read them). */
async function loadPersonal(sb: SupabaseClient, userId: string) {
  const rows: SalesRow[] = [], sheets: SheetSummary[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("personal_sales").select("kind, data").eq("owner", userId).order("key").range(from, from + PAGE - 1);
    if (error) {
      // The table arrives with the updated supabase/schema.sql; until then the Sales Dashboard just starts empty.
      if (/does not exist|could not find the table/i.test(error.message)) return { rows, sheets, missing: true };
      throw new Error(friendly(error.message));
    }
    (data || []).forEach((r: { kind: string; data: unknown }) => { if (r.kind === "sheet") sheets.push(revive<SheetSummary>(r.data)); else rows.push(revive<SalesRow>(r.data)); });
    if (!data || data.length < PAGE) return { rows, sheets, missing: false };
  }
}

/**
 * Everything the signed-in person can see: the shared inquiries, the team's shared sales reports and
 * marketing spend (Patient Acquisition Cost), and their own Sales Dashboard files. Concierge get the CRM
 * only; Marketing get de-identified views of the shared data.
 */
export async function loadCloud(sb: SupabaseClient, role: Role, userId: string) {
  const marketing = role === "marketing";
  const [inquiries, teamSales, sheetRows, personal] = await Promise.all([
    loadInquiries(sb, role),
    role === "concierge" ? Promise.resolve([] as SalesRow[]) : fetchAll<SalesRow>(sb, marketing ? "sales_marketing" : "sales_rows"),
    fetchAll<SheetSummary | SpendRecord>(sb, "sheets"),
    role === "concierge" ? Promise.resolve({ rows: [] as SalesRow[], sheets: [] as SheetSummary[], missing: false }) : loadPersonal(sb, userId),
  ]);
  const isSpend = (r: SheetSummary | SpendRecord): r is SpendRecord => "setting" in r && r.setting === "acquisition-spend";
  const sheets = sheetRows.filter((r): r is SheetSummary => !isSpend(r));
  const spends: AcquisitionSpend[] = sheetRows.filter(isSpend).map((r) => ({ from: r.from, to: r.to, total: r.total, bySource: r.bySource, updatedAt: r.updatedAt }));
  return { inquiries, teamSales, sheets, spends, mySales: personal.rows, mySheets: personal.sheets, personalMissing: personal.missing };
}

/** Saves this account's own Sales Dashboard rows and file list. */
export async function savePersonal(sb: SupabaseClient, userId: string, input: { rows?: SalesRow[]; sheets?: SheetSummary[] }) {
  const all = [
    ...(input.rows || []).map((r) => ({ owner: userId, key: `row|${r.rowKey}`, kind: "row", data: r })),
    ...(input.sheets || []).map((s) => ({ owner: userId, key: `sheet|${sheetKey(s)}`, kind: "sheet", data: s })),
  ];
  const rows = Array.from(new Map(all.map((r) => [r.key, r])).values());
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("personal_sales").upsert(rows.slice(i, i + 500), { onConflict: "owner,key" });
    if (error) throw new Error(/does not exist|could not find the table/i.test(error.message) ? "Personal Sales Dashboards need the updated database setup: run supabase/schema.sql in the Supabase SQL Editor, then try again." : friendly(error.message));
  }
}
export async function deletePersonal(sb: SupabaseClient, userId: string, input: { rowKeys?: string[]; sheets?: SheetSummary[] }) {
  const keys = [...(input.rowKeys || []).map((k) => `row|${k}`), ...(input.sheets || []).map((s) => `sheet|${sheetKey(s)}`)];
  for (let i = 0; i < keys.length; i += 100) {
    const { error } = await sb.from("personal_sales").delete().eq("owner", userId).in("key", keys.slice(i, i + 100));
    if (error) throw new Error(friendly(error.message));
  }
}

async function upsert(sb: SupabaseClient, table: string, input: { key: string; data: unknown; kind?: string }[]) {
  // Postgres refuses an upsert that names the same key twice, so identical rows from a sheet are sent once.
  const rows = Array.from(new Map(input.map((r) => [r.key, r])).values());
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict: "key" });
    if (error) throw new Error(friendly(error.message));
  }
}

export const saveInquiries = (sb: SupabaseClient, rows: InquiryRow[]) => upsert(sb, "inquiries", rows.map((r) => ({ key: r.rowKey, data: r })));
/**
 * Marketing spend is kept in the sheets table next to the sales reports, so it needs no extra database
 * setup and follows the same access rules: full-access accounts change it, Marketing can read it,
 * Concierge can't see it. loadCloud separates these rows from the uploaded sheets.
 */
type SpendRecord = AcquisitionSpend & { setting: "acquisition-spend" };
export const saveSpend = (sb: SupabaseClient, spend: AcquisitionSpend) =>
  upsert(sb, "sheets", [{ key: `setting|acquisition-spend|${spendKey(spend.from, spend.to)}`, kind: "sales", data: { ...spend, setting: "acquisition-spend" } satisfies SpendRecord }]);

export const saveSales = (sb: SupabaseClient, rows: SalesRow[]) => upsert(sb, "sales_rows", rows.map((r) => ({ key: r.rowKey, data: r })));
export const saveSheets = (sb: SupabaseClient, rows: SheetSummary[]) => upsert(sb, "sheets", rows.map((s) => ({ key: sheetKey(s), kind: s.kind, data: s })));

async function removeKeys(sb: SupabaseClient, table: string, keys: string[]) {
  // Keys travel in the URL, so delete in small batches.
  for (let i = 0; i < keys.length; i += 100) {
    const { error } = await sb.from(table).delete().in("key", keys.slice(i, i + 100));
    if (error) throw new Error(friendly(error.message));
  }
}
export const deleteSales = (sb: SupabaseClient, keys: string[]) => removeKeys(sb, "sales_rows", keys);
export const deleteSheets = (sb: SupabaseClient, keys: string[]) => removeKeys(sb, "sheets", keys);

export type NewMember = { email: string; fullName: string; role: Role; method: "invite" | "password"; password?: string };
/** Creates a login through the app's server (app/api/team), which holds the Supabase admin key. */
export async function createMember(sb: SupabaseClient, member: NewMember) {
  const { data } = await sb.auth.getSession();
  const response = await fetch("/api/team", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token || ""}` },
    body: JSON.stringify(member),
  }).catch(() => null);
  if (!response) throw new Error(friendly("Failed to fetch"));
  const result = (await response.json().catch(() => ({}))) as { error?: string; id?: string };
  if (!response.ok || !result.id) throw new Error(result.error || "Could not create the account.");
  return result as { id: string; email: string; fullName: string; role: Role; invited: boolean };
}

/** An Admin, ManCom or Doctors account sets a temporary password for someone (their invite expired, or they're locked out). */
export async function setMemberPassword(sb: SupabaseClient, id: string, password: string) {
  const { data } = await sb.auth.getSession();
  const response = await fetch("/api/team", {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token || ""}` },
    body: JSON.stringify({ id, password }),
  }).catch(() => null);
  if (!response) throw new Error(friendly("Failed to fetch"));
  const result = (await response.json().catch(() => ({}))) as { error?: string; ok?: boolean };
  if (!response.ok || !result.ok) throw new Error(result.error || "Could not set the password.");
}

export async function deleteInquiry(sb: SupabaseClient, key: string) {
  const { error } = await sb.from("inquiries").delete().eq("key", key);
  if (error) throw new Error(friendly(error.message));
}

/** Plain-language versions of the errors staff are most likely to hit. */
export function friendly(message: string) {
  if (/invalid login credentials/i.test(message)) return "Wrong email or password. If you forgot your password, ask an Admin, ManCom or Doctors account to set a new one.";
  if (/invalid api key|no api key|apikey/i.test(message)) return "Setup problem: the app's Supabase key is wrong (Invalid API key). In Vercel → Settings → Environment Variables, set NEXT_PUBLIC_SUPABASE_ANON_KEY to the Publishable (anon) key from the same Supabase project as NEXT_PUBLIC_SUPABASE_URL, then redeploy.";
  // Supabase's built-in email sender only sends a few emails an hour, and only to the project team's addresses.
  if (/error sending .*email|email rate limit|over_email_send_rate_limit|email address not authorized/i.test(message)) return "The email couldn't be sent: the clinic's email sender is limited (a few emails an hour, only to approved addresses). Use Team → Set password instead.";
  if (/email not confirmed/i.test(message)) return "This email is not confirmed yet. Ask an Admin, ManCom or Doctors account to set a password for you in Team.";
  if (/row-level security|permission denied/i.test(message)) return "Your account doesn't have access to this. Ask an Admin, ManCom or Doctors account to change your access in Team.";
  if (/relation .* does not exist|could not find the table/i.test(message)) return "The database isn't set up yet. Run supabase/schema.sql in the Supabase SQL Editor.";
  if (/failed to fetch|network/i.test(message)) return "Can't reach the server. Check the internet connection and try again.";
  return message;
}
