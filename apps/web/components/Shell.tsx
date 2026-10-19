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
import { PageActionsBar, PageActionsCtx, PageActionsSpec } from "./PageActions";
import ChatLauncher from "./ChatLauncher";

/* Five sections in the sidebar; each section's pages are tabs along the top. New pages join a section, so the
   sidebar stays short however much Omilo grows. */
type Page = [string, string, string]; // href, label, icon
export const SECTIONS: { id: string; label: string; icon: string; pages: Page[] }[] = [
  { id: "home", label: "Home", icon: "ri-home-5-line", pages: [["/", "Inbox", "ri-inbox-2-line"], ["/monitor/", "Monitor", "ri-dashboard-3-line"]] },
  { id: "work", label: "Work", icon: "ri-briefcase-4-line", pages: [["/chat/", "Workspace", "ri-chat-3-line"], ["/plan/", "Plan", "ri-node-tree"],
    ["/calendar/", "Calendar", "ri-calendar-line"], ["/workflows/", "Workflows", "ri-flow-chart"], ["/docs/", "Docs", "ri-book-2-line"]] },
  { id: "team", label: "Team", icon: "ri-team-line", pages: [["/staff/", "Helpers", "ri-team-line"], ["/talent/", "Hire", "ri-user-add-line"],
    ["/company/", "Company", "ri-building-2-line"]] },
  { id: "tools", label: "Tools", icon: "ri-tools-line", pages: [["/connectors/", "Connectors", "ri-plug-line"], ["/skills/", "Skills", "ri-magic-line"],
    ["/computer/", "Computer", "ri-computer-line"], ["/harness/", "AI accounts", "ri-stack-line"]] },
  { id: "settings", label: "Settings", icon: "ri-settings-3-line", pages: [["/settings/", "Settings", "ri-settings-3-line"]] },
];
const PAGES = SECTIONS.flatMap((sec) => sec.pages.map(([h, l, i]) => ({ href: h, label: l, icon: i, section: sec })));
const pageFor = (path: string) =>
  PAGES.filter((p) => (p.href === "/" ? path === "/" : path.startsWith(p.href))).sort((a, b) => b.href.length - a.href.length)[0] || PAGES[0];
const LAST = "omilo.nav.last"; // the page you last opened in each section, so a section opens where you left it
const lastIn = (id: string) => { try { return (JSON.parse(localStorage.getItem(LAST) || "{}") as Record<string, string>)[id]; } catch { return undefined; } };
const remember = (id: string, href: string) => { try { localStorage.setItem(LAST, JSON.stringify({ ...JSON.parse(localStorage.getItem(LAST) || "{}"), [id]: href })); } catch { /* ignore */ } };

function SectionTabs({ page }: { page: (typeof PAGES)[number] }) {
  const sec = page.section;
  if (sec.pages.length < 2) return <span className="crumb"><i className={page.icon} />{page.label}</span>;
  return (
    <nav className="tabs" aria-label={sec.label}>
      {sec.pages.map(([h, l, ic]) => (
        <Link key={h} href={h} className={`tab ${h === page.href ? "on" : ""}`} aria-current={h === page.href ? "page" : undefined}><i className={ic} />{l}</Link>
      ))}
    </nav>
  );
}

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
  const [actions, setActions] = useState<PageActionsSpec | null>(null);
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
  useEffect(() => { remember(pageFor(path).section.id, path); }, [path]);

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

  const page = pageFor(path);
  const own = path === "/chat/" || path.startsWith("/chat/") || path.startsWith("/docs/");  // pages with their own top bar
  const global = [
    { label: overview?.paused ? "Resume all helpers" : "Pause all helpers", icon: overview?.paused ? "ri-play-circle-line" : "ri-pause-circle-line", onSelect: togglePause },
  ];

  return (
    <OverviewCtx.Provider value={{ overview, refresh }}>
      <PageActionsCtx.Provider value={{ set: setActions }}>
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
          <nav className="sections">
            {SECTIONS.map((sec) => {
              const on = sec.id === page.section.id;
              const last = lastIn(sec.id);
              const go = last && pageFor(last.split("?")[0]).section.id === sec.id ? last : sec.pages[0][0];
              const count = sec.id === "home" ? overview?.inbox.open || 0 : 0;
              return (
                <div key={sec.id} className={`secblock ${on ? "on" : ""}`}>
                  <Link href={go} className={`navlink ${on ? "on" : ""}`} onContextMenu={ctxMenu(() => [{ heading: sec.label },
                    ...sec.pages.map(([h, l, ic]) => ({ label: l, icon: ic, href: h }))])}>
                    <i className={sec.icon} />{sec.label}
                    {count ? <span className="count">{count}</span> : null}
                  </Link>
                  {on && sec.pages.length > 1 && (
                    <div className="subnav">{sec.pages.map(([h, l]) => (
                      <Link key={h} href={h} className={`sublink ${h === page.href ? "on" : ""}`}>{l}
                        {h === "/" && overview?.inbox.open ? <span className="count sm">{overview.inbox.open}</span> : null}</Link>
                    ))}</div>
                  )}
                </div>
              );
            })}
            <div className="secblock" style={{ marginTop: "auto" }}>
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
            {own ? (
              <>
                {page.section.pages.length > 1 && <div className="topbar slim"><SectionTabs page={page} /></div>}
                {children}
              </>
            ) : (
              <>
                <div className="topbar">
                  <SectionTabs page={page} />
                  <span className="sp" />
                  {overview?.paused && <span className="chip warn"><i className="ri-pause-line" />Paused</span>}
                  <PageActionsBar spec={actions} extra={global} />
                </div>
                <div className="scroll"><main className="page">{children}</main></div>
              </>
            )}
          </div>
        </div>
      </div>
      </PageActionsCtx.Provider>
    </OverviewCtx.Provider>
  );
}
