import { createClient } from "@supabase/supabase-js";
import { readFeedbackSheet } from "@/lib/google-sheets";

/**
 * Patient Feedback: the responses from the in-person or QR survey Google Sheet, for signed-in Admin, ManCom, Doctors and
 * Marketing accounts only. Patient feedback is private, so it is never cached by the browser or Vercel,
 * and it isn't available without accounts.
 */
export const dynamic = "force-dynamic";

const ALLOWED = ["admin", "mancom", "doctor", "marketing"];
const reply = (status: number, body: object) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

export async function GET(request: Request) {
  const tidy = (value?: string) => value?.trim().replace(/^["']+|["']+$/g, "").trim() || undefined;
  const url = tidy(process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/(rest|auth)\/v1\/?$/, "").replace(/\/+$/, "");
  const key = tidy(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) || tidy(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  if (!url || !key) return reply(501, { error: "Patient Feedback needs accounts (Supabase), so that only signed-in staff can read the responses." });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return reply(401, { error: "Please sign in again." });
  // Check the sign-in and the person's access with their own session; Row Level Security lets them read their own profile.
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: user, error } = await sb.auth.getUser(token);
  if (error || !user.user) return reply(401, { error: "Your sign-in has expired. Sign out and sign in again." });
  const { data: me } = await sb.from("profiles").select("role").eq("id", user.user.id).maybeSingle();
  if (!ALLOWED.includes(me?.role)) return reply(403, { error: "Patient Feedback is for Admin, ManCom, Doctors and Marketing accounts." });
  const params = new URL(request.url).searchParams;
  // ?source=qr is the QR survey; anything else the in-person survey.
  return reply(200, await readFeedbackSheet(params.get("source") === "qr" ? "qr" : "inperson", params.has("fresh")));
}
