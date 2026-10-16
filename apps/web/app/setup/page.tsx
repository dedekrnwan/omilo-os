"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AuthShell, { Field } from "@/components/AuthShell";
import { api } from "@/lib/api";

/* First run: your account, then your business name. Then Saga guides the onboarding. */
function strength(pw: string): [number, string] {
  if (!pw) return [0, ""];
  let n = 0;
  if (pw.length >= 10) n++;
  if (pw.length >= 14) n++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) n++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) n++;
  return pw.length < 10 ? [1, "Too short: at least 10 characters"] : [Math.max(2, n), ["", "", "Okay", "Good", "Strong"][Math.max(2, n)]];
}

export default function Setup() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ email: "", name: "", password: "", company_name: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const emailOk = /\S+@\S+\.\S+/.test(f.email);
  const accountOk = emailOk && f.password.length >= 10 && f.name.trim().length > 0;
  const [lvl, lbl] = strength(f.password);
  const first = f.name.trim().split(/\s+/)[0];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 0) { if (accountOk) setStep(1); return; }
    setBusy(true); setErr(null);
    try { await api("/setup/owner", { body: f }); router.replace("/onboarding/"); } catch (x: any) { setErr(x.message); setBusy(false); }
  };
  const dots = <div className="au-steps" aria-label={`Step ${step + 1} of 2`}><i className={step >= 0 ? "on" : ""} /><i className={step >= 1 ? "on" : ""} /><span>Step {step + 1} of 2</span></div>;
  return (
    <AuthShell
      headline={step === 0 ? <>Meet your<br />new team.</> : <>Hi {first || "there"},<br />what&apos;s it called?</>}
      body={step === 0 ? "A Chief of Staff and specialists that write, sell and answer customers. They suggest, you decide." : "Your helpers use the name in everything they write. You can run more companies later."}>
      <form onSubmit={submit} className="au-card" noValidate>
        {dots}
        {step === 0 ? (
          <>
            <h1>Create your account</h1>
            <p className="au-sub">The only account that can approve your helpers&apos; work.</p>
            <Field icon="ri-user-smile-line" autoFocus autoComplete="name" value={f.name} placeholder="Your name" aria-label="Your name" onChange={(e) => setF({ ...f, name: e.target.value })} />
            <Field icon="ri-mail-line" type="email" autoComplete="email" value={f.email} placeholder="Email" aria-label="Email" onChange={(e) => setF({ ...f, email: e.target.value })} />
            <Field icon="ri-lock-2-line" type={show ? "text" : "password"} autoComplete="new-password" value={f.password} placeholder="Password (at least 10 characters)" aria-label="Password"
              onChange={(e) => setF({ ...f, password: e.target.value })}
              right={<button type="button" className="au-eye" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}><i className={show ? "ri-eye-off-line" : "ri-eye-line"} /></button>} />
            {f.password && <div className={`au-meter l${lvl}`}><span><i /><i /><i /><i /></span>{lbl}</div>}
            <button className="au-btn" type="submit" disabled={!accountOk}>Continue <i className="ri-arrow-right-line" /></button>
          </>
        ) : (
          <>
            <h1>Your business</h1>
            <p className="au-sub">Saga will ask a few more questions next, so your team knows what you do.</p>
            <Field icon="ri-store-2-line" autoFocus value={f.company_name} placeholder="e.g. Warung Kopi Bandung" aria-label="Business name" onChange={(e) => setF({ ...f, company_name: e.target.value })} />
            {err && <div className="au-err" role="alert"><i className="ri-error-warning-line" />{err}</div>}
            <button className="au-btn" type="submit" disabled={!f.company_name.trim() || busy}>{busy ? "Creating…" : <>Create my account <i className="ri-arrow-right-line" /></>}</button>
            <p className="au-alt"><button type="button" className="au-link" onClick={() => setStep(0)}><i className="ri-arrow-left-s-line" />Back</button></p>
          </>
        )}
      </form>
    </AuthShell>
  );
}
