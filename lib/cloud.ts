import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import type { InquiryRow, SalesRow, SheetSummary } from "./parse";

/**
 * Shared cloud storage and logins (Supabase). Turned on by setting NEXT_PUBLIC_SUPABASE_URL and
 * NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) in Vercel. Without them
 * the app keeps working on the device only. The key is public by design; Row Level Security in
 * supabase/schema.sql decides what each signed-in person can read or change.
 */
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let client: SupabaseClient | null = null;
export function getCloud() {
  if (!URL || !KEY || typeof window === "undefined") return null;
  client ??= createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}
export const cloudConfigured = Boolean(URL && KEY);

export type Role = "admin" | "staff";
export type Profile = { id: string; email: string; full_name: string; role: Role | null };

export async function loadProfile(sb: SupabaseClient, userId: string): Promise<Profile | null> {
  const { data, error } = await sb.from("profiles").select("id, email, full_name, role").eq("id", userId).maybeSingle();
  if (error) throw new Error(friendly(error.message));
  return data as Profile | null;
}

export async function listProfiles(sb: SupabaseClient): Promise<Profile[]> {
  const { data, error } = await sb.from("profiles").select("id, email, full_name, role").order("email");
  if (error) throw new Error(friendly(error.message));
  return (data || []) as Profile[];
}

export async function setProfileRole(sb: SupabaseClient, id: string, role: Role | null) {
  const { error } = await sb.from("profiles").update({ role }).eq("id", id);
  if (error) throw new Error(friendly(error.message));
}

// Dates travel as ISO strings inside jsonb; turn them back into Date objects.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
function revive<T>(value: unknown): T {
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

/** Everything the signed-in person is allowed to see. Staff get only the CRM. */
export async function loadCloud(sb: SupabaseClient, role: Role) {
  const [inquiries, sales, sheets] = await Promise.all([
    fetchAll<InquiryRow>(sb, "inquiries"),
    role === "admin" ? fetchAll<SalesRow>(sb, "sales_rows") : Promise.resolve([] as SalesRow[]),
    fetchAll<SheetSummary>(sb, "sheets"),
  ]);
  return { inquiries, sales, sheets };
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
export const saveSales = (sb: SupabaseClient, rows: SalesRow[]) => upsert(sb, "sales_rows", rows.map((r) => ({ key: r.rowKey, data: r })));
export const saveSheets = (sb: SupabaseClient, rows: SheetSummary[]) => upsert(sb, "sheets", rows.map((s) => ({ key: `${s.file}|${s.sheet}`, kind: s.kind, data: s })));

export async function deleteInquiry(sb: SupabaseClient, key: string) {
  const { error } = await sb.from("inquiries").delete().eq("key", key);
  if (error) throw new Error(friendly(error.message));
}

/** Plain-language versions of the errors staff are most likely to hit. */
export function friendly(message: string) {
  if (/invalid login credentials/i.test(message)) return "Wrong email or password.";
  if (/email not confirmed/i.test(message)) return "This email is not confirmed yet. Ask the admin to confirm the user in Supabase.";
  if (/row-level security|permission denied/i.test(message)) return "Your account doesn't have access to this. Ask an admin to give you access in Team.";
  if (/relation .* does not exist|could not find the table/i.test(message)) return "The database isn't set up yet. Run supabase/schema.sql in the Supabase SQL Editor.";
  if (/failed to fetch|network/i.test(message)) return "Can't reach the server. Check the internet connection and try again.";
  return message;
}
