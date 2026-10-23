"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AuthShell from "@/components/AuthShell";
import { CoBadge, switchTo, type Co } from "@/components/CompanySwitcher";
import { BASE, api } from "@/lib/api";

/* Shown right after login when you run more than one company: pick which one to open. A single
   company skips this entirely (login goes straight in). Reuses the company-switch cookie, so your
   choice sticks and every open tab follows. You can always switch again from the top-left menu. */

/** A notification deep-link carried through login (?next=…). Same-origin only, BASE-relative, "/" by default. */
function safeNext(): string {
  const raw = new URLSearchParams(location.search).get("next");
  if (!raw) return "/";
  try {
    const u = new URL(raw, location.href);
    if (u.origin !== location.origin) return "/";
    const path = u.pathname.startsWith(BASE) ? u.pathname.slice(BASE.length) : u.pathname;
    return (path || "/") + u.search + u.hash;
  } catch { return "/"; }
}

export default function SelectCompany() {
  const router = useRouter();
  const [list, setList] = useState<Co[] | null>(null);
  const [current, setCurrent] = useState<string>("main");
  const [going, setGoing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ current: string; companies: Co[] }>("/companies").then((r) => {
      const active = r.companies.filter((c) => !c.archived);
      // Nothing to choose: one (or zero) company → go straight in, so this page is never a dead end.
      if (active.length <= 1) { location.href = BASE + safeNext(); return; }
      setList(active);
      setCurrent(r.current);
    }).catch((e: any) => {
      if (e.status === 401) router.replace("/login/");
      else setErr(e.message);
    });
  }, [router]);

  const pick = (id: string) => {
    setGoing(id); setErr(null);
    switchTo(id, safeNext()).catch((e: any) => { setErr(e.message); setGoing(null); });
  };

  return (
    <AuthShell headline={<>Which team<br />today?</>} body="You run more than one company. Pick the one you want to open — you can switch any time from the menu, top left.">
      <div className="au-card">
        <h1>Choose a company</h1>
        <p className="au-sub">Each one is fully separate: its own helpers, inbox and setup.</p>
        {err && <div className="au-err" role="alert"><i className="ri-error-warning-line" />{err}</div>}
        {!list ? (
          <p className="small" style={{ padding: "8px 2px" }}>Loading your companies…</p>
        ) : (
          <div className="sc-list">
            {list.map((c) => (
              <button key={c.id} type="button" className={`sc-co ${c.id === current ? "on" : ""}`} disabled={!!going} onClick={() => pick(c.id)}>
                <CoBadge co={c} size={34} />
                <span className="sc-t">
                  <b>{c.name}</b>
                  <span className="small">{!c.onboarded ? "Setting up" : c.running ? `${c.running} working` : "Quiet"}{c.inbox ? ` · ${c.inbox} waiting` : ""}</span>
                </span>
                {going === c.id ? <i className="ri-loader-4-line sc-spin" /> : c.inbox ? <span className="count">{c.inbox}</span> : <i className="ri-arrow-right-line sc-go" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </AuthShell>
  );
}
