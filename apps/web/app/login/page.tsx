"use client";
import { useRouter } from "next/navigation";
import { Mark } from "@/components/Logo";
import { useEffect, useState } from "react";
import { Err } from "@/components/ui";
import { api } from "@/lib/api";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {  // a fresh (or reset) install has no account yet: go to setup instead
    api<{ needs_owner: boolean }>("/setup").then((s) => { if (s.needs_owner) router.replace("/setup/"); }).catch(() => {});
  }, [router]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/auth/login", { body: { email, password } });
      router.replace("/");
    } catch (x: any) { setErr(x.message); }
  };
  return (
    <div className="centered">
      <Mark size={44} />
      <h1 className="display" style={{ fontSize: 32 }}>Welcome back</h1>
      <p className="sub">Sign in to run your company with your AI helpers.</p>
      <form className="paper" onSubmit={submit}>
        <label>Email</label><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <label>Password</label><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn primary lg" type="submit" style={{ width: "100%", marginTop: 18 }}>Sign in</button>
        <Err error={err} />
      </form>
    </div>
  );
}
