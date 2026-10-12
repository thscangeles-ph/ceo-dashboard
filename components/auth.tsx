"use client";

import { useEffect, useState } from "react";
import { KeyRound, LogIn, Mail, ShieldCheck, Users, X } from "lucide-react";
import type { Profile, Role } from "@/lib/cloud";
import { friendly, getCloud, listProfiles, setProfileRole } from "@/lib/cloud";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <div className="appbar">
        <div className="appbar-inner">
          <div className="appbar-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/theheartspecialists.png" alt="" width={36} height={48} />
            <div style={{ minWidth: 0 }}><div className="clinic">THE HEART SPECIALISTS CLINIC</div><div className="app">CEO Dashboard</div></div>
          </div>
        </div>
      </div>
      <div className="wrap"><div className="auth-card panel">{children}</div></div>
    </main>
  );
}

export function LoadingScreen({ label = "Loading…" }: { label?: string }) {
  return <Shell><p className="empty-note" role="status">{label}</p></Shell>;
}

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

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

const ROLE_LABEL: Record<string, string> = { admin: "Admin: everything", staff: "Staff: Patient CRM only", none: "No access" };

/** Admins give people access. New people are added in Supabase first (see the note in the panel). */
export function TeamPanel({ me, onClose }: { me: string; onClose: () => void }) {
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");

  useEffect(() => {
    let live = true;
    listProfiles(getCloud()!).then((list) => { if (live) setPeople(list); }).catch((e: Error) => { if (live) setError(e.message); });
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { live = false; document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const change = async (person: Profile, value: string) => {
    const role = value === "none" ? null : (value as Role);
    if (person.id === me && role !== "admin" && !window.confirm("This removes your own admin access. Continue?")) return;
    setSaving(person.id); setError("");
    try {
      await setProfileRole(getCloud()!, person.id, role);
      setPeople((list) => list?.map((p) => (p.id === person.id ? { ...p, role } : p)) || null);
    } catch (e) { setError((e as Error).message); }
    setSaving("");
  };

  return (
    <div className="drill-overlay no-print" onClick={onClose}>
      <aside className="drill" role="dialog" aria-modal="true" aria-labelledby="team-title" onClick={(e) => e.stopPropagation()}>
        <div className="drill-head">
          <div><span className="tag">Team</span><h2 id="team-title">Who can use the dashboard</h2><p className="drill-meta">Changes apply the next time the person opens the app.</p></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="drill-body">
          {error && <div className="alert" role="alert"><div>{error}</div></div>}
          {!people ? <p className="empty-note">Loading…</p> : (
            <div className="table-scroll">
              <table>
                <tbody>
                  <tr><th>Person</th><th>Access</th></tr>
                  {people.map((p) => (
                    <tr key={p.id}>
                      <td className="name">{p.full_name || p.email}{p.full_name && <small className="muted"><br />{p.email}</small>}{p.id === me && <small className="muted"> (you)</small>}</td>
                      <td>
                        <select className="role-select" value={p.role || "none"} disabled={saving === p.id} onChange={(e) => void change(p, e.target.value)}>
                          {Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h4><Users size={14} style={{ verticalAlign: -2 }} /> Adding someone new</h4>
          <ol className="steps">
            <li>In Supabase, open <strong>Authentication → Users → Add user</strong>.</li>
            <li>Choose <strong>Send invitation</strong> (they set their own password from the email), or <strong>Create new user</strong> with a temporary password and tick <em>Auto confirm</em>.</li>
            <li>They appear here as <em>No access</em>. Set them to Staff or Admin.</li>
          </ol>
        </div>
      </aside>
    </div>
  );
}
