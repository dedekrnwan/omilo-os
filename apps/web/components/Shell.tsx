"use client";
import { usePoll } from "@/lib/poll";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError, BASE, Overview, api } from "@/lib/api";
import PreviewHost from "./PreviewLazy";
import NotifyHost from "./Notify";
import TaskDrawerLazy from "./TaskDrawerLazy";
import ContextMenuHost from "./ContextMenu";
import { copy, menu as ctxMenu } from "@/lib/menu";
import CompanySwitcher from "./CompanySwitcher";
import { StepPage } from "./StepCard";
import ChatLauncher from "./ChatLauncher";

const NAV: { group: string; items: [string, string, string][] }[] = [
  { group: "Work", items: [["/", "Inbox", "ri-inbox-2-line"], ["/chat/", "Workspace", "ri-chat-3-line"], ["/plan/", "Plan", "ri-node-tree"], ["/calendar/", "Calendar", "ri-calendar-line"], ["/workflows/", "Workflows", "ri-flow-chart"], ["/docs/", "Docs", "ri-book-2-line"], ["/monitor/", "Monitor", "ri-dashboard-3-line"]] },
  { group: "Company", items: [["/staff/", "Team", "ri-team-line"], ["/talent/", "Hire", "ri-user-add-line"], ["/company/", "Company", "ri-building-2-line"], ["/settings/", "Settings", "ri-settings-3-line"]] },
  { group: "Capabilities", items: [["/harness/", "Harness", "ri-stack-line"], ["/connectors/", "Connectors", "ri-plug-line"], ["/skills/", "Skills", "ri-magic-line"], ["/computer/", "Computer", "ri-computer-line"]] },
];
const TITLES: Record<string, [string, string]> = Object.fromEntries(NAV.flatMap((g) => g.items.map(([h, l, i]) => [h, [l, i]])));

type Ctx = { overview: Overview | null; refresh: () => void };
const OverviewCtx = createContext<Ctx>({ overview: null, refresh: () => {} });
export const useOverview = () => useContext(OverviewCtx);

/* A dot on the tab's icon while something waits in the Inbox (red when it is critical). */
let plainIcons: { el: HTMLLinkElement; href: string }[] | null = null;
function setFaviconDot(color: string | null) {
  if (typeof document === "undefined") return;
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
  if (!plainIcons) plainIcons = links.map((el) => ({ el, href: el.href }));
  if (!color) { plainIcons.forEach(({ el, href }) => { el.href = href; }); return; }
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    if (!g) return;
    g.drawImage(img, 0, 0, 64, 64);
    g.beginPath(); g.arc(48, 16, 14, 0, 2 * Math.PI); g.fillStyle = "#fff"; g.fill();
    g.beginPath(); g.arc(48, 16, 11, 0, 2 * Math.PI); g.fillStyle = color; g.fill();
    const url = c.toDataURL("image/png");
    plainIcons!.forEach(({ el }) => { el.href = url; });
  };
  img.src = `${BASE}/icon-192.png`;
}

export { Mark } from "./Logo";
import { Mark } from "./Logo";
import { confirmDialog } from "@/lib/dialog";

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname() || "/";
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [me, setMe] = useState<{ name?: string; email?: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(false);
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
      try { setMe(await api("/auth/me")); } catch { return router.replace("/login/"); }
      if (!s.onboarded && path !== "/onboarding/") return router.replace("/onboarding/");
      setReady(true);
      refresh();
    })();
  }, [bare, path, refresh, router]);

  usePoll(() => { if (!bare && ready) return refresh(); }, 30000, [bare, ready, refresh]); // live notices refresh it sooner

  useEffect(() => {
    const n = overview?.inbox.open || 0;
    const base = overview?.company_name ? `${overview.company_name} · Omilo` : "Omilo";
    document.title = n ? `(${n}) ${base}` : base;
    setFaviconDot(n ? (overview?.inbox.critical ? "#dc2626" : "#f59e0b") : null);
  }, [overview]);
  useEffect(() => setMenu(false), [path]);

  if (bare) return <>{children}</>;
  if (!ready) return null;

  const togglePause = async () => {
    if (!overview) return;
    if (!overview.paused && !(await confirmDialog({ title: "Pause all helpers?", body: "Running jobs finish their current step; nothing new starts until you resume.", confirm: "Pause everyone", mood: "worried" }))) return;
    await api("/system", { body: { paused: !overview.paused } });
    refresh();
  };
  const logout = async () => { await api("/auth/logout", { body: {} }); router.replace("/login/"); };
  const who = (me?.name || me?.email || "Owner").trim();

  if (path === "/onboarding/") {  // focused setup: a quiet page with the step card in the middle
    return (
      <OverviewCtx.Provider value={{ overview, refresh }}>
        <StepPage top={<>
          <Mark /><span className="crumb">Omilo<span className="small" style={{ fontWeight: 400 }}> · Setting up {overview?.company_name || "your company"}</span></span>
          <span className="sp" style={{ flex: 1 }} />
          <div className="cosw-top"><CompanySwitcher overview={overview} /></div>
          <button className="btn quiet sm" onClick={logout}><i className="ri-logout-box-r-line" />Log out</button>
        </>}>
          {children}
        </StepPage>
        <PreviewHost />
      </OverviewCtx.Provider>
    );
  }

  const key = Object.keys(TITLES).filter((h) => (h === "/" ? path === "/" : path.startsWith(h))).sort((a, b) => b.length - a.length)[0] || "/";
  const [title, icon] = TITLES[key] || ["Omilo", "ri-apps-line"];

  return (
    <OverviewCtx.Provider value={{ overview, refresh }}>
      <div className="frame">
        <PreviewHost />
        {ready && !bare && <NotifyHost onNotice={refresh} />}
        {ready && !bare && <TaskDrawerLazy />}
        {ready && !bare && <ContextMenuHost />}
        {ready && !bare && <ChatLauncher />}
        <div className="mobilebar">
          <Mark /><b style={{ fontWeight: 600 }}>{overview?.company_name || "Omilo"}</b>
          <span className="sp" />
          {overview?.inbox.open ? <Link href="/" className="chip down">{overview.inbox.open} waiting</Link> : null}
          <button className="iconbtn" aria-label="Menu" onClick={() => setMenu(!menu)}><i className={menu ? "ri-close-line" : "ri-menu-line"} /></button>
        </div>
        <aside className={`side ${menu ? "open" : ""}`}>
          <div className="head brand"><Mark /><div><b>Omilo</b></div></div>
          <CompanySwitcher overview={overview} />
          <nav>
            {NAV.map((g) => (
              <div className="group" key={g.group}>
                <p>{g.group}</p>
                {g.items.map(([href, label, ic]) => {
                  const on = href === key;
                  return (
                    <Link key={href} href={href} className={`navlink ${on ? "on" : ""}`} onContextMenu={ctxMenu(() => [{ heading: label },
                      { label: "Open", icon: ic, href }, { label: "Open in a new tab", icon: "ri-external-link-line", onSelect: () => window.open(href, "_blank", "noopener") },
                      { label: "Copy link", icon: "ri-link", onSelect: () => copy(location.origin + href) }])}>
                      <i className={ic} />{label}
                      {label === "Inbox" && overview?.inbox.open ? <span className="count">{overview.inbox.open}</span> : null}
                    </Link>
                  );
                })}
              </div>
            ))}
            <div className="group">
              <p>Control</p>
              <button className="navlink" style={{ border: 0, background: "transparent", width: "100%" }} onClick={togglePause}>
                <i className={overview?.paused ? "ri-play-circle-line" : "ri-pause-circle-line"} />{overview?.paused ? "Resume all helpers" : "Pause all helpers"}
              </button>
            </div>
          </nav>
          <div className="foot">
            <span className="avatar">{who.slice(0, 1).toUpperCase()}</span>
            <span className="grow">{who}</span>
            <button className="iconbtn" aria-label="Log out" title="Log out" onClick={logout}><i className="ri-logout-box-r-line" /></button>
          </div>
        </aside>
        <div className="workspace">
          <div className="inset">
            {key === "/chat/" || key === "/docs/" ? children : (
              <>
                <div className="topbar">
                  <span className="crumb"><i className={icon} />{title}</span>
                  <span className="sp" />
                  {overview?.paused && <span className="chip warn"><i className="ri-pause-line" />Paused</span>}
                </div>
                <div className="scroll"><main className="page">{children}</main></div>
              </>
            )}
          </div>
        </div>
      </div>
    </OverviewCtx.Provider>
  );
}
