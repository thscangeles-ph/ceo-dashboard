"use client";

import { useEffect, useState } from "react";
import { Check, KeyRound, LogIn, Mail, Pencil, ShieldCheck, UserPlus, X } from "lucide-react";
import { InstallAppButton } from "@/components/pwa";
import type { NewMember, Profile, Role } from "@/lib/cloud";
import { configProblem, createMember, friendly, getCloud, isFullAccess, listProfiles, ROLE_DETAIL, ROLE_LABEL, setMemberPassword, setProfileName, setProfileRole } from "@/lib/cloud";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <div className="appbar">
        <div className="appbar-inner">
          <div className="appbar-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/theheartspecialists.png" alt="" width={36} height={48} />
            <div style={{ minWidth: 0 }}><div className="clinic">THE HEART SPECIALISTS CLINIC</div><div className="app">Summary Dashboard</div></div>
          </div>
          <div className="appbar-actions"><InstallAppButton /></div>
        </div>
      </div>
      <div className="wrap">
        <div className="auth-card panel">{children}</div>
        <p className="install-hint no-print"><InstallAppButton variant="outline" label="Install the app on this device" /></p>
      </div>
    </main>
  );
}

export function LoadingScreen({ label = "Loading…" }: { label?: string }) {
  return <Shell><p className="empty-note" role="status">{label}</p></Shell>;
}

/** Plain-language text for a broken invite or reset link (Supabase sends error_code in the URL). */
export function linkErrorText(code: string, description = "") {
  if (/otp_expired|expired|invalid/i.test(`${code} ${description}`)) {
    return "This link has expired or was already used. Email apps sometimes open links automatically to scan them, which uses them up. Enter your email below to get a new link, or ask an Admin, ManCom or Doctors account to set a password for you in Team.";
  }
  return `That link didn't work (${description || code}). Enter your email below to get a new one.`;
}

export function LoginScreen({ linkError }: { linkError?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "forgot">(linkError ? "forgot" : "login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(linkError ? { tone: "error", text: linkError } : null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const sb = getCloud();
    if (!sb) return;
    setBusy(true); setMessage(null);
    if (mode === "login") {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setMessage({ tone: "error", text: friendly(error.message) });
    } else {
      const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
      setMessage(error ? { tone: "error", text: friendly(error.message) } : { tone: "ok", text: "If that email has an account, a link to set a new password is on its way." });
    }
    setBusy(false);
  };

  return (
    <Shell>
      <span className="tag">THSC team sign-in</span>
      <h1>{mode === "login" ? "Sign in" : "Reset your password"}</h1>
      <p className="sub">{mode === "login" ? "Use the email and password the clinic gave you." : "Enter your email and we'll send a link to set a new password."}</p>
      {configProblem && <div className="alert" role="alert"><div>{configProblem}</div></div>}
      <form className="auth-form" onSubmit={submit}>
        <label>Email<div className="input-icon"><Mail size={16} aria-hidden /><input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div></label>
        {mode === "login" && <label>Password<div className="input-icon"><KeyRound size={16} aria-hidden /><input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div></label>}
        {message && <div className={message.tone === "error" ? "alert" : "notice"} role="status"><div>{message.text}</div></div>}
        <button type="submit" className="btn btn-primary" disabled={busy}><LogIn size={16} />{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Send reset link"}</button>
        <button type="button" className="link-btn" onClick={() => { setMode(mode === "login" ? "forgot" : "login"); setMessage(null); }}>{mode === "login" ? "Forgot your password?" : "Back to sign in"}</button>
      </form>
      <p className="privacy"><ShieldCheck size={17} /><span>Patient information is only shown to signed-in clinic staff. Sign out on shared computers.</span></p>
    </Shell>
  );
}

/** Landing page for invite and reset emails: the one-time code is only used when the person clicks Continue. */
export function VerifyLinkScreen({ tokenHash, type, onVerified, onFailed }: {
  tokenHash: string; type: "invite" | "recovery"; onVerified: (email: string, type: "invite" | "recovery") => void; onFailed: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const { data, error } = await getCloud()!.auth.verifyOtp({ token_hash: tokenHash, type });
    setBusy(false);
    if (error || !data.user) onFailed(linkErrorText(error?.code || "otp_expired", error?.message));
    else onVerified(data.user.email || "", type);
  };
  return (
    <Shell>
      <span className="tag">{type === "invite" ? "Welcome" : "Password reset"}</span>
      <h1>{type === "invite" ? "You're invited" : "Set a new password"}</h1>
      <p className="sub">{type === "invite" ? "You've been given an account on the THSC Summary Dashboard. Continue to choose your password." : "Continue to choose a new password for your account."}</p>
      <div className="auth-form"><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void go()}><KeyRound size={16} />{busy ? "Checking the link…" : "Continue"}</button></div>
    </Shell>
  );
}

/** After an invite or password-reset link: choose a password. */
export function SetPasswordScreen({ email, onDone }: { email: string; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    if (password !== confirm) { setError("The two passwords don't match."); return; }
    setBusy(true); setError("");
    const { error: e } = await getCloud()!.auth.updateUser({ password });
    setBusy(false);
    if (e) setError(friendly(e.message)); else onDone();
  };
  return (
    <Shell>
      <span className="tag">Welcome</span>
      <h1>Set your password</h1>
      <p className="sub">For {email}. You&apos;ll use it to sign in from any computer or phone.</p>
      <form className="auth-form" onSubmit={submit}>
        <label>New password<input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <label>Type it again<input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
        {error && <div className="alert" role="alert"><div>{error}</div></div>}
        <button type="submit" className="btn btn-primary" disabled={busy}><KeyRound size={16} />{busy ? "Saving…" : "Save password"}</button>
      </form>
    </Shell>
  );
}

export function NoAccessScreen({ email, error, onSignOut }: { email: string; error?: string; onSignOut: () => void }) {
  return (
    <Shell>
      <span className="tag">Almost there</span>
      <h1>Waiting for access</h1>
      <p className="sub">You&apos;re signed in as <strong>{email}</strong>, but an admin hasn&apos;t given this account access yet. Ask them to open <strong>Team</strong> in the app and set your role.</p>
      {error && <div className="alert" role="alert"><div>{error}</div></div>}
      <div className="auth-form"><button type="button" className="btn btn-outline" onClick={onSignOut}>Sign out</button></div>
    </Shell>
  );
}

/** Easy-to-read temporary password, e.g. "Amber-4827-Pulse". */
function generatePassword() {
  const words = ["Heart", "Gold", "Pulse", "Cedar", "River", "Maple", "Coral", "Amber", "Delta", "Nova", "Summit", "Harbor"];
  const n = new Uint32Array(3);
  crypto.getRandomValues(n);
  return `${words[n[0] % words.length]}-${1000 + (n[1] % 9000)}-${words[n[2] % words.length]}`;
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="btn btn-outline btn-sm" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setDone(true)); }}>{done ? "Copied" : "Copy"}</button>;
}

const ACCESS_OPTIONS: { value: Role | "none"; label: string }[] = [
  { value: "admin", label: `${ROLE_LABEL.admin}: everything` },
  { value: "mancom", label: `${ROLE_LABEL.mancom}: everything` },
  { value: "doctor", label: `${ROLE_LABEL.doctor}: everything` },
  { value: "concierge", label: `${ROLE_LABEL.concierge}: Inquiry Tracker and CRM` },
  { value: "marketing", label: `${ROLE_LABEL.marketing}: read-only, no patient details` },
  { value: "none", label: "No access" },
];

/** Admin, ManCom and Doctors accounts add people and set what each account can do. */
export function TeamPanel({ me, onClose }: { me: string; onClose: () => void }) {
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  // Temporary passwords are the default: Supabase's free email sender can't use scanner-proof invite links.
  const [form, setForm] = useState<NewMember>(() => ({ email: "", fullName: "", role: "concierge", method: "password", password: generatePassword() }));
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<{ text: string; password?: string } | null>(null);
  const [pwFor, setPwFor] = useState<string | null>(null);
  // The person whose name is being edited, and the name typed so far.
  const [naming, setNaming] = useState<{ id: string; value: string } | null>(null);
  const saveName = async () => {
    if (!naming) return;
    const name = naming.value.trim().replace(/\s+/g, " ").slice(0, 120);
    setSaving(naming.id); setError("");
    try {
      await setProfileName(getCloud()!, naming.id, name);
      setPeople((list) => list?.map((p) => (p.id === naming.id ? { ...p, full_name: name } : p)) || null);
      setNaming(null);
    } catch (e) { setError((e as Error).message); }
    setSaving("");
  };
  const [newPw, setNewPw] = useState("");
  const [pwDone, setPwDone] = useState<{ text: string; password: string } | null>(null);

  const savePassword = async (person: Profile) => {
    setSaving(person.id); setError(""); setPwDone(null);
    try {
      await setMemberPassword(getCloud()!, person.id, newPw);
      setPwDone({ text: `${person.email} can now sign in with this password. Give it to them privately; they can change it later with Forgot your password?`, password: newPw });
      setPwFor(null); setNewPw("");
    } catch (e) { setError((e as Error).message); }
    setSaving("");
  };

  const reload = () => listProfiles(getCloud()!).then(setPeople).catch((e: Error) => setError(e.message));
  useEffect(() => {
    let live = true;
    listProfiles(getCloud()!).then((list) => { if (live) setPeople(list); }).catch((e: Error) => { if (live) setError(e.message); });
    // Esc closes the panel, unless it was used to cancel a name edit.
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { live = false; document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const change = async (person: Profile, value: string) => {
    const role = value === "none" ? null : (value as Role);
    if (person.id === me && !isFullAccess(role) && !window.confirm("This removes your own full access (Team, sales reports). Continue?")) return;
    setSaving(person.id); setError("");
    try {
      await setProfileRole(getCloud()!, person.id, role);
      setPeople((list) => list?.map((p) => (p.id === person.id ? { ...p, role } : p)) || null);
    } catch (e) { setError((e as Error).message); }
    setSaving("");
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setAdding(true); setError(""); setAdded(null);
    try {
      const result = await createMember(getCloud()!, form);
      setAdded(result.invited
        ? { text: `Invitation sent to ${result.email}. They set their own password from the email, then sign in as ${ROLE_LABEL[result.role]}.` }
        : { text: `${result.email} can sign in now as ${ROLE_LABEL[result.role]}. Give them this password privately (not in a group chat):`, password: form.password });
      setForm((f) => ({ ...f, email: "", fullName: "", password: generatePassword() }));
      await reload();
    } catch (e) { setError((e as Error).message); }
    setAdding(false);
  };

  return (
    <div className="drill-overlay no-print" onClick={onClose}>
      <aside className="drill" role="dialog" aria-modal="true" aria-labelledby="team-title" onClick={(e) => e.stopPropagation()}>
        <div className="drill-head">
          <div><span className="tag">Team</span><h2 id="team-title">Accounts and access</h2><p className="drill-meta">Changes apply the next time the person opens the app.</p></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="drill-body">
          <form className="add-person" onSubmit={add}>
            <h4 style={{ marginTop: 0 }}><UserPlus size={14} style={{ verticalAlign: -2 }} /> Add person</h4>
            <div className="field-grid">
              <label className="wide">Name<input value={form.fullName} placeholder="e.g. Ana Reyes" onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></label>
              <label className="wide">Email<input type="email" required value={form.email} placeholder="name@email.com" onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label className="full">Account type
                <div className="role-cards" role="radiogroup" aria-label="Account type">
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                    <label key={r} className={form.role === r ? "on" : ""}>
                      <input type="radio" name="new-role" checked={form.role === r} onChange={() => setForm({ ...form, role: r })} />
                      <strong>{ROLE_LABEL[r]}</strong><span>{ROLE_DETAIL[r]}</span>
                    </label>
                  ))}
                </div>
              </label>
              <label className="full">How they get in
                <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as NewMember["method"] })}>
                  <option value="password">Set a password now (you give it to them yourself)</option>
                  <option value="invite">Email an invitation (works best with your own email sender set up in Supabase)</option>
                </select>
              </label>
              {form.method === "password" && (
                <label className="full">Password
                  <div className="pw-row" style={{ marginTop: 0 }}>
                    <input type="text" minLength={8} required value={form.password} autoComplete="off" onChange={(e) => setForm({ ...form, password: e.target.value })} />
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setForm({ ...form, password: generatePassword() })}>Generate</button>
                  </div>
                </label>
              )}
            </div>
            {added && <div className="notice" role="status"><div>{added.text}{added.password && <div className="pw-show"><code>{added.password}</code><Copy text={added.password} /></div>}</div></div>}
            <button type="submit" className="btn btn-primary" disabled={adding} style={{ marginTop: 14 }}><UserPlus size={15} />{adding ? "Creating…" : "Create account"}</button>
          </form>

          {error && <div className="alert" role="alert"><div>{error}</div></div>}
          {pwDone && <div className="notice" role="status"><div>{pwDone.text}<div className="pw-show"><code>{pwDone.password}</code><Copy text={pwDone.password} /></div></div></div>}
          <h4>Everyone with a login</h4>
          {!people ? <p className="empty-note">Loading…</p> : (
            <div className="table-scroll">
              <table>
                <tbody>
                  <tr><th>Person</th><th>Access</th><th></th></tr>
                  {people.map((p) => (
                    <tr key={p.id}>
                      <td className="name">
                        {naming?.id === p.id ? (
                          <span className="name-edit">
                            <input autoFocus value={naming.value} placeholder="FULL NAME" aria-label={`Name for ${p.email}`} maxLength={120}
                              onChange={(e) => setNaming({ id: p.id, value: e.target.value })}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveName(); } if (e.key === "Escape") { e.preventDefault(); setNaming(null); } }} />
                            <button type="button" className="icon-btn" onClick={() => void saveName()} disabled={saving === p.id} aria-label="Save name"><Check size={16} /></button>
                            <button type="button" className="icon-btn" onClick={() => setNaming(null)} aria-label="Cancel"><X size={16} /></button>
                          </span>
                        ) : (
                          <>
                            {p.full_name || <span className="muted">No name yet</span>}
                            <button type="button" className="icon-btn name-btn" onClick={() => setNaming({ id: p.id, value: p.full_name || "" })} aria-label={`Edit the name of ${p.email}`} title="Edit name"><Pencil size={14} /></button>
                          </>
                        )}
                        <small className="muted"><br />{p.email}</small>{p.id === me && <small className="muted"> (you)</small>}
                      </td>
                      <td>
                        <select className="role-select" value={p.role || "none"} disabled={saving === p.id} onChange={(e) => void change(p, e.target.value)}>
                          {ACCESS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        {pwFor === p.id && (
                          <form className="pw-row" onSubmit={(e) => { e.preventDefault(); void savePassword(p); }}>
                            <input type="text" minLength={8} required autoFocus placeholder="New password (8+ characters)" value={newPw} autoComplete="off" onChange={(e) => setNewPw(e.target.value)} />
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => setNewPw(generatePassword())}>Generate</button>
                            <button type="submit" className="btn btn-primary btn-sm" disabled={saving === p.id}>Save</button>
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => { setPwFor(null); setNewPw(""); }}>Cancel</button>
                          </form>
                        )}
                      </td>
                      <td>{pwFor !== p.id && <button type="button" className="btn btn-outline btn-sm" onClick={() => { setPwFor(p.id); setNewPw(generatePassword()); setPwDone(null); }}><KeyRound size={13} />Set password</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="drill-meta" style={{ marginTop: 12 }}>If an invite link expired or someone is locked out, use <strong>Set password</strong> and give them the new password privately. To remove someone, set them to <em>No access</em>. To delete a login completely, use Supabase → Authentication → Users.</p>
        </div>
      </aside>
    </div>
  );
}
