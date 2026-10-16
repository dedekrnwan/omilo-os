"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Mark } from "@/components/Logo";
import StepCard, { StepPage } from "@/components/StepCard";
import { Err } from "@/components/ui";
import { api } from "@/lib/api";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {  // a fresh (or reset) install has no account yet: go to setup instead
    api<{ needs_owner: boolean }>("/setup").then((s) => { if (s.needs_owner) router.replace("/setup/"); }).catch(() => {});
  }, [router]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await api("/auth/login", { body: { email, password } }); router.replace("/"); } catch (x: any) { setErr(x.message); setBusy(false); }
  };
  return (
    <StepPage top={<><Mark /><b style={{ fontWeight: 600 }}>Saga OS</b></>}>
      <form onSubmit={submit} style={{ width: "100%", display: "grid", placeItems: "center" }}>
        <StepCard icon="ri-login-circle-line" title="Sign in" tone="ink" seed={3} mascot next={{ icon: "ri-inbox-line", title: "Your Inbox", tone: "green" }}
          caption="Welcome back. Your helpers kept working while you were away."
          footer={<button className="btn primary sc-next" type="submit" disabled={!email || !password || busy}>{busy ? "Signing in…" : "Sign in"}</button>}>
          <label>Email</label>
          <input type="email" autoFocus value={email} placeholder="you@company.com" onChange={(e) => setEmail(e.target.value)} />
          <label>Password</label>
          <input type="password" value={password} placeholder="Your password" onChange={(e) => setPassword(e.target.value)} />
          <Err error={err} />
        </StepCard>
      </form>
    </StepPage>
  );
}
