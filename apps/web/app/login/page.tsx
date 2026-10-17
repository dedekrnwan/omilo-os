"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AuthShell, { Field } from "@/components/AuthShell";
import { api } from "@/lib/api";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {  // a fresh (or reset) install has no account yet: go to setup instead
    api<{ needs_owner: boolean }>("/setup").then((s) => { if (s.needs_owner) router.replace("/setup/"); }).catch(() => {});
  }, [router]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await api("/auth/login", { body: { email, password } }); router.replace("/"); }
    catch (x: any) { setErr(x.status === 401 || /invalid|wrong|password/i.test(x.message) ? "That email and password don't match." : x.message); setBusy(false); }
  };
  return (
    <AuthShell headline={<>Your team<br />kept working.</>} body="Sign in and see what your helpers did while you were away.">
      <form onSubmit={submit} className="au-card" noValidate>
        <h1>Welcome back</h1>
        <p className="au-sub">Sign in to your Omilo.</p>
        <Field icon="ri-mail-line" type="email" autoComplete="email" autoFocus value={email} placeholder="Email" aria-label="Email" onChange={(e) => setEmail(e.target.value)} />
        <Field icon="ri-lock-2-line" type={show ? "text" : "password"} autoComplete="current-password" value={password} placeholder="Password" aria-label="Password"
          onChange={(e) => setPassword(e.target.value)}
          right={<button type="button" className="au-eye" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}><i className={show ? "ri-eye-off-line" : "ri-eye-line"} /></button>} />
        <div className="au-row"><button type="button" className="au-link" onClick={() => setForgot(!forgot)}>Forgot your password?</button></div>
        {forgot && (
          <div className="au-note">
            Omilo runs on your own computer and sends no email, so the reset happens there. In the Omilo folder run
            <code>make reset-password</code> and choose a new one.
          </div>
        )}
        {err && <div className="au-err" role="alert"><i className="ri-error-warning-line" />{err}</div>}
        <button className="au-btn" type="submit" disabled={!email || !password || busy}>{busy ? "Signing in…" : <>Sign in <i className="ri-arrow-right-line" /></>}</button>
        <p className="au-alt">One account per Omilo: the owner&apos;s. Your helpers never sign in here.</p>
      </form>
    </AuthShell>
  );
}
