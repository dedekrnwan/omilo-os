"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError, Overview, api } from "@/lib/api";

const TABS = [
  ["/", "Inbox"], ["/chat/", "Chat"], ["/work/", "Work"], ["/staff/", "Staff"], ["/company/", "Company"], ["/settings/", "Settings"],
] as const;

type Ctx = { overview: Overview | null; refresh: () => void };
const OverviewCtx = createContext<Ctx>({ overview: null, refresh: () => {} });
export const useOverview = () => useContext(OverviewCtx);

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname() || "/";
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [ready, setReady] = useState(false);
  const bare = ["/login/", "/setup/"].includes(path);

  const refresh = useCallback(async () => {
    try {
      setOverview(await api<Overview>("/overview"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) router.replace("/login/");
    }
  }, [router]);

  useEffect(() => {
    if (bare) { setReady(true); return; }
    (async () => {
      const s = await api<{ needs_owner: boolean; onboarded: boolean }>("/setup");
      if (s.needs_owner) return router.replace("/setup/");
      try { await api("/auth/me"); } catch { return router.replace("/login/"); }
      if (!s.onboarded && path !== "/onboarding/") return router.replace("/onboarding/");
      setReady(true);
      refresh();
    })();
  }, [bare, path, refresh, router]);

  useEffect(() => {
    if (bare || !ready) return;
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [bare, ready, refresh]);

  useEffect(() => {
    const n = overview?.inbox.open || 0;
    document.title = n ? `(${n}) Saga OS` : "Saga OS";
  }, [overview]);

  if (bare) return <>{children}</>;
  if (!ready) return null;

  const togglePause = async () => {
    if (!overview) return;
    if (!overview.paused && !confirm("Pause all agents? Running tasks finish; nothing new starts.")) return;
    await api("/system", { body: { paused: !overview.paused } });
    refresh();
  };
  const logout = async () => { await api("/auth/logout", { body: {} }); router.replace("/login/"); };

  if (path === "/onboarding/") {  // focused setup: no tabs, nothing to get lost in
    return (
      <OverviewCtx.Provider value={{ overview, refresh }}>
        <header className="top">
          <div className="focusbar">
            <div className="brand">
              <div className="mark" aria-hidden><i /><i /><i /><i /><i /><i /></div>
              <div><b>Saga OS</b><small>Setting up your company</small></div>
            </div>
            <span className="sp" />
            <button className="btn quiet" onClick={logout}>Log out</button>
          </div>
        </header>
        <main className="page">{children}</main>
      </OverviewCtx.Provider>
    );
  }

  return (
    <OverviewCtx.Provider value={{ overview, refresh }}>
      <header className="top">
        <div className="bar">
          <div className="brand">
            <div className="mark" aria-hidden><i /><i /><i /><i /><i /><i /></div>
            <div><b>Saga OS</b><small>{overview?.company_name || "Your company"} · Control Center</small></div>
          </div>
          <span className="sp" />
          {overview && (overview.paused
            ? <span className="chip warn">❚❚ Paused</span>
            : <span className="chip up">✓ Live{overview.tasks.running ? ` · ${overview.tasks.running} working` : ""}</span>)}
          <button className={`btn ${overview?.paused ? "primary" : "danger"}`} onClick={togglePause}>{overview?.paused ? "Resume" : "Pause all"}</button>
          <button className="btn quiet hide-sm" onClick={logout}>Log out</button>
        </div>
        <nav className="tabs">
          {TABS.map(([href, label]) => {
            const on = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link key={href} href={href} className={on ? "on" : ""}>
                {label}{label === "Inbox" && overview?.inbox.open ? <span className="badge">{overview.inbox.open}</span> : null}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="page">{children}</main>
    </OverviewCtx.Provider>
  );
}
