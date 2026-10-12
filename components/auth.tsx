"use client";

import { useEffect, useState } from "react";
import { KeyRound, LogIn, Mail, ShieldCheck, UserPlus, X } from "lucide-react";
import type { NewMember, Profile, Role } from "@/lib/cloud";
import { createMember, friendly, getCloud, listProfiles, ROLE_DETAIL, ROLE_LABEL, setProfileRole } from "@/lib/cloud";

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

const ACCESS_OPTIONS: { value: Role | "none"; label: string }[] = [
  { value: "admin", label: `${ROLE_LABEL.admin}: everything` },
  { value: "concierge", label: `${ROLE_LABEL.concierge}: Patient CRM` },
  { value: "marketing", label: `${ROLE_LABEL.marketing}: read-only, no patient details` },
  { value: "none", label: "No access" },
];

/** CEO / Doctor accounts add people and set what each account can do. */
export function TeamPanel({ me, onClose }: { me: string; onClose: () => void }) {
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const [form, setForm] = useState<NewMember>({ email: "", fullName: "", role: "concierge", method: "invite", password: "" });
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState("");

  const reload = () => listProfiles(getCloud()!).then(setPeople).catch((e: Error) => setError(e.message));
  useEffect(() => {
    let live = true;
    listProfiles(getCloud()!).then((list) => { if (live) setPeople(list); }).catch((e: Error) => { if (live) setError(e.message); });
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { live = false; document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const change = async (person: Profile, value: string) => {
    const role = value === "none" ? null : (value as Role);
    if (person.id === me && role !== "admin" && !window.confirm("This removes your own CEO / Doctor access. Continue?")) return;
    setSaving(person.id); setError("");
    try {
      await setProfileRole(getCloud()!, person.id, role);
      setPeople((list) => list?.map((p) => (p.id === person.id ? { ...p, role } : p)) || null);
    } catch (e) { setError((e as Error).message); }
    setSaving("");
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setAdding(true); setError(""); setAdded("");
    try {
      const result = await createMember(getCloud()!, form);
      setAdded(result.invited
        ? `Invitation sent to ${result.email}. They set their own password from the email, then sign in as ${ROLE_LABEL[result.role]}.`
        : `${result.email} can sign in now as ${ROLE_LABEL[result.role]} with the temporary password. Ask them to change it (Forgot your password? on the sign-in screen).`);
      setForm((f) => ({ ...f, email: "", fullName: "", password: "" }));
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
                  <option value="invite">Email them an invitation (they choose their own password)</option>
                  <option value="password">Set a temporary password now (share it with them yourself)</option>
                </select>
              </label>
              {form.method === "password" && <label className="wide">Temporary password<input type="text" minLength={8} required value={form.password} autoComplete="off" onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>}
            </div>
            {added && <div className="notice" role="status"><div>{added}</div></div>}
            <button type="submit" className="btn btn-primary" disabled={adding} style={{ marginTop: 14 }}><UserPlus size={15} />{adding ? "Creating…" : "Create account"}</button>
          </form>

          {error && <div className="alert" role="alert"><div>{error}</div></div>}
          <h4>Everyone with a login</h4>
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
                          {ACCESS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="drill-meta" style={{ marginTop: 12 }}>To remove someone, set them to <em>No access</em>. To delete a login completely, use Supabase → Authentication → Users.</p>
        </div>
      </aside>
    </div>
  );
}
