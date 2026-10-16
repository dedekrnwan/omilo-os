"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Mark } from "@/components/Logo";
import StepCard, { StepPage } from "@/components/StepCard";
import { Err } from "@/components/ui";
import { api } from "@/lib/api";

/* First run: your account, then your business name. Then onboarding takes over. */
export default function Setup() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ email: "", name: "", password: "", company_name: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const accountOk = /\S+@\S+\.\S+/.test(f.email) && f.password.length >= 10 && f.name.trim().length > 0;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 0) { if (accountOk) setStep(1); return; }
    setBusy(true); setErr(null);
    try { await api("/setup/owner", { body: f }); router.replace("/onboarding/"); } catch (x: any) { setErr(x.message); setBusy(false); }
  };
  return (
    <StepPage top={<><Mark /><b style={{ fontWeight: 600 }}>Saga OS</b></>}>
      <form onSubmit={submit} style={{ width: "100%", display: "grid", placeItems: "center" }}>
        {step === 0 ? (
          <StepCard icon="ri-user-3-line" title="Your account" tone="green" seed={1} next={{ icon: "ri-building-line", title: "Your business", tone: "orange" }}
            caption="You are the boss here. Your helpers suggest, you decide."
            meta={<span className="small">1 of 2</span>}
            footer={<button className="btn primary sc-next" type="submit" disabled={!accountOk}>Next</button>}>
            <label>Full name</label>
            <input autoFocus value={f.name} placeholder="Enter your name" onChange={(e) => setF({ ...f, name: e.target.value })} />
            <label>Email</label>
            <input type="email" value={f.email} placeholder="you@company.com" onChange={(e) => setF({ ...f, email: e.target.value })} />
            <label>Password</label>
            <input type="password" value={f.password} placeholder="At least 10 characters" onChange={(e) => setF({ ...f, password: e.target.value })} />
            <p className="small" style={{ marginTop: 10 }}>This is the only account that can approve your helpers&apos; work.</p>
          </StepCard>
        ) : (
          <StepCard icon="ri-building-line" title="Your business" tone="orange" seed={2} next={{ icon: "ri-sparkling-2-line", title: "Set up your AI team", tone: "violet" }}
            caption="Next, a few questions so your helpers know your business."
            meta={<span className="small">2 of 2</span>}
            footer={<>
              <button className="btn primary sc-next" type="submit" disabled={!f.company_name.trim() || busy}>{busy ? "Creating…" : "Create my account"}</button>
              <button type="button" className="sc-skip" onClick={() => setStep(0)}>Back</button></>}>
            <label>Business name</label>
            <input autoFocus value={f.company_name} placeholder="e.g. Warung Kopi Bandung" onChange={(e) => setF({ ...f, company_name: e.target.value })} />
            <p className="small" style={{ marginTop: 10 }}>You can run more companies later from the same account.</p>
            <Err error={err} />
          </StepCard>
        )}
      </form>
    </StepPage>
  );
}
