"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Err } from "@/components/ui";
import { api } from "@/lib/api";

export default function Setup() {
  const router = useRouter();
  const [f, setF] = useState({ email: "", name: "", password: "", company_name: "" });
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/setup/owner", { body: f });
      router.replace("/onboarding/");
    } catch (x: any) { setErr(x.message); }
  };
  return (
    <div className="centered">
      <div className="eyebrow">Welcome to Saga OS</div>
      <h1>Create your account</h1>
      <p className="sub">You are the boss here: your AI helpers suggest, you decide. This account is the only one that can approve their work.</p>
      <form className="paper" onSubmit={submit}>
        <label>Business name</label><input required value={f.company_name} onChange={(e) => setF({ ...f, company_name: e.target.value })} />
        <label>Your name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <label>Email</label><input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <label>Password (at least 10 characters)</label><input type="password" minLength={10} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <div className="acts" style={{ marginTop: 16 }}><button className="btn primary" type="submit">Create my account</button></div>
        <Err error={err} />
      </form>
    </div>
  );
}
