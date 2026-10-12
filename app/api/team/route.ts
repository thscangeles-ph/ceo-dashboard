import { createClient } from "@supabase/supabase-js";

/**
 * Creates a login for a new team member. Only a signed-in CEO / Doctor (role 'admin') may call it.
 * Needs SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) in Vercel. That key never reaches the
 * browser: it is only read here on the server.
 */
export const dynamic = "force-dynamic";

const ROLES = ["admin", "concierge", "marketing"] as const;
type Role = (typeof ROLES)[number];
type Body = { email?: string; fullName?: string; role?: Role; method?: "invite" | "password"; password?: string };

const reply = (status: number, body: object) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** Returns an admin Supabase client when the caller is a signed-in CEO / Doctor, or the error reply. */
async function asCeo(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    return { error: reply(501, { error: "Managing logins from the app isn't switched on yet. Add SUPABASE_SERVICE_ROLE_KEY in Vercel and redeploy, or use Supabase → Authentication → Users." }) };
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: reply(401, { error: "Please sign in again." }) };
  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller.user) return { error: reply(401, { error: "Please sign in again." }) };
  const { data: me } = await admin.from("profiles").select("role").eq("id", caller.user.id).maybeSingle();
  if (me?.role !== "admin") return { error: reply(403, { error: "Only a CEO / Doctor account can manage logins." }) };
  return { admin };
}

/** Sets a new (temporary) password for an existing login, e.g. when an invite link expired. */
export async function PATCH(request: Request) {
  const auth = await asCeo(request);
  if (auth.error) return auth.error;
  let body: { id?: string; password?: string };
  try { body = await request.json(); } catch { return reply(400, { error: "Invalid request." }); }
  if (!body.id || !/^[0-9a-f-]{36}$/i.test(body.id)) return reply(400, { error: "Choose a person." });
  if ((body.password || "").length < 8) return reply(400, { error: "The password needs at least 8 characters." });
  const { error } = await auth.admin.auth.admin.updateUserById(body.id, { password: body.password, email_confirm: true });
  if (error) return reply(400, { error: error.message });
  return reply(200, { id: body.id, ok: true });
}

export async function POST(request: Request) {
  const auth = await asCeo(request);
  if (auth.error) return auth.error;
  const admin = auth.admin;

  let body: Body;
  try { body = (await request.json()) as Body; } catch { return reply(400, { error: "Invalid request." }); }
  const email = (body.email || "").trim().toLowerCase();
  const fullName = (body.fullName || "").trim().slice(0, 120);
  const role = body.role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: "Enter a valid email address." });
  if (!role || !ROLES.includes(role)) return reply(400, { error: "Choose the account type." });
  if (body.method === "password" && (body.password || "").length < 8) return reply(400, { error: "The temporary password needs at least 8 characters." });

  const origin = request.headers.get("origin") || new URL(request.url).origin;
  const created = body.method === "password"
    ? await admin.auth.admin.createUser({ email, password: body.password, email_confirm: true, user_metadata: { full_name: fullName } })
    : await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName }, redirectTo: origin });
  if (created.error || !created.data.user) {
    const message = created.error?.message || "Could not create the account.";
    return reply(/already|registered|exists/i.test(message) ? 409 : 400, { error: /already|registered|exists/i.test(message) ? "That email already has an account. Set its access in the list instead." : message });
  }

  // The database trigger makes the profile; give it the chosen access and name.
  const id = created.data.user.id;
  const { error: profileError } = await admin.from("profiles").upsert({ id, email, full_name: fullName, role }, { onConflict: "id" });
  if (profileError) return reply(500, { error: `The login was created but its access could not be set: ${profileError.message}` });
  return reply(200, { id, email, fullName, role, invited: body.method !== "password" });
}
