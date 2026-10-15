"use client";
import { useRouter } from "next/navigation";
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
      <div className="mark" aria-hidden style={{ marginBottom: 14 }}><i /><i /><i /><i /><i /><i /></div>
      <h1>Saga OS</h1>
      <p className="sub">Sign in to your control center.</p>
      <form className="paper" onSubmit={submit}>
        <label>Email</label><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <label>Password</label><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="acts" style={{ marginTop: 16 }}><button className="btn primary" type="submit">Sign in</button></div>
        <Err error={err} />
      </form>
    </div>
  );
}
