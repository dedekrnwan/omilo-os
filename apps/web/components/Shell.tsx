"use client";
import { usePoll } from "@/lib/poll";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ApiError, BASE, Overview, api } from "@/lib/api";
import PreviewHost from "./PreviewLazy";
import NotifyHost from "./Notify";
import TaskDrawerLazy from "./TaskDrawerLazy";
import ContextMenuHost from "./ContextMenu";
import CompanySwitcher from "./CompanySwitcher";
import { PageActionsCtx, PageActionsSpec } from "./PageActions";
import ChatLauncher from "./ChatLauncher";
import { NAV, NavItem, navItemFor } from "./nav";
import { CommandProvider, useCommand } from "./command";
import CommandPalette from "./CommandPalette";
import { MenuItem, openMenu } from "@/lib/menu";

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

  if (path === "/onboarding/") {  // v2 onboarding: full-screen layout; the page owns all chrome
    return (
      <OverviewCtx.Provider value={{ overview, refresh }}>
        {children}
        <PreviewHost />
      </OverviewCtx.Provider>
    );
  }

  const navItem = navItemFor(path);
  const own = path === "/chat/" || path.startsWith("/chat/") || path.startsWith("/docs/");  // pages with their own top bar

  return (
    <OverviewCtx.Provider value={{ overview, refresh }}>
      <PageActionsCtx.Provider value={{ set: setActions }}>
      <CommandProvider>
      <div className="frame">
        <PreviewHost />
        {ready && !bare && <NotifyHost onNotice={refresh} />}
        {ready && !bare && <TaskDrawerLazy />}
        {ready && !bare && <ContextMenuHost />}
        {ready && !bare && <ChatLauncher />}
        {ready && !bare && <CommandPalette />}
        <div className="mobilebar">
          <Mark /><b style={{ fontWeight: 600 }}>{overview?.company_name || "Omilo"}</b>
          <span className="sp" />
          {overview?.inbox.open ? <Link href="/" className="chip down">{overview.inbox.open} waiting</Link> : null}
          <button className="iconbtn" aria-label="Menu" onClick={() => setMenu(!menu)}><i className={menu ? "ri-close-line" : "ri-menu-line"} /></button>
        </div>
        <aside className={`side ${menu ? "open" : ""}`}>
          <div className="head brand">
            <Mark />
            <div>
              <b>Omilo</b>
              <small>Saga OS</small>
            </div>
          </div>
          <CompanySwitcher overview={overview} />
          <nav aria-label="Main navigation">
            {NAV.map((group) => (
              <div key={group.id} className="group">
                <p>{group.label}</p>
                {group.items.map((item) => {
                  if (item.soon) {
                    return (
                      <span
                        key={item.label}
                        className="navlink soon"
                        aria-disabled="true"
                        tabIndex={-1}
                      >
                        <i className={item.icon} />{item.label}
                        <span className="soon-tag">Soon</span>
                      </span>
                    );
                  }
                  const active = navItemFor(path).href === item.href;
                  const inboxCount = item.count === "inbox" ? (overview?.inbox.open || 0) : 0;
                  return (
                    <Link
                      key={item.href}
                      href={item.href!}
                      className={`navlink${active ? " on" : ""}`}
                      aria-current={active ? "page" : undefined}
                    >
                      <i className={item.icon} />{item.label}
                      {inboxCount > 0 && <span className="count">{inboxCount}</span>}
                    </Link>
                  );
                })}
              </div>
            ))}
            <div className="nav-footer">
              <Link
                href="/settings/"
                className={`navlink${navItemFor(path).href === "/settings/" ? " on" : ""}`}
                aria-current={navItemFor(path).href === "/settings/" ? "page" : undefined}
              >
                <i className="ri-settings-3-line" />Settings
              </Link>
              <button className="navlink" onClick={togglePause}>
                <i className={overview?.paused ? "ri-play-circle-line" : "ri-pause-circle-line"} />
                {overview?.paused ? "Resume all helpers" : "Pause all helpers"}
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
                {children}
              </>
            ) : (
              <>
                <TopbarV2
                  navItem={navItem}
                  path={path}
                  overview={overview}
                  togglePause={togglePause}
                  actions={actions}
                />
                <div className="scroll"><main className="page">{children}</main></div>
              </>
            )}
          </div>
        </div>
      </div>
      </CommandProvider>
      </PageActionsCtx.Provider>
    </OverviewCtx.Provider>
  );
}

/* ---- Topbar v2: crumb + Ask bar + More menu ---- */
function TopbarV2({
  navItem,
  path,
  overview,
  togglePause,
  actions,
}: {
  navItem: NavItem;
  path: string;
  overview: Overview | null;
  togglePause: () => void;
  actions: PageActionsSpec | null;
}) {
  const { open: openCommand } = useCommand();
  const moreRef = useRef<HTMLButtonElement>(null);

  const inboxCount = overview?.inbox.open || 0;
  const meta = path === "/" && inboxCount > 0 ? `${inboxCount} needs you` : null;

  const moreItems: MenuItem[] = [
    {
      label: overview?.paused ? "Resume all helpers" : "Pause all helpers",
      icon: overview?.paused ? "ri-play-circle-line" : "ri-pause-circle-line",
      onSelect: togglePause,
    },
    ...((actions?.more || []).filter(Boolean) as MenuItem[]).flatMap<MenuItem>((item, i) =>
      i === 0 ? [{ sep: true }, item] : [item]
    ),
  ];

  const handleMore = () => {
    const el = moreRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    openMenu(Math.max(8, r.right - 220), r.bottom + 6, moreItems);
  };

  return (
    <div className="topbar topbar-v2">
      <div className="crumb">
        <i className={navItem.icon} aria-hidden />
        <span className="crumb-title">{navItem.label}</span>
        {meta && <span className="meta">{meta}</span>}
      </div>
      {overview?.paused && <span className="chip warn tb-paused"><i className="ri-pause-line" />Paused</span>}
      <span className="sp" />
      {actions?.primary && (
        actions.primary.href
          ? <Link className={`btn primary sm${actions.primary.danger ? " danger" : ""}`} href={actions.primary.href}>
              {actions.primary.icon && <i className={actions.primary.icon} />}{actions.primary.label}
            </Link>
          : <button className={`btn primary sm${actions.primary.danger ? " danger" : ""}`} disabled={actions.primary.disabled} onClick={() => actions.primary?.onSelect?.()}>
              {actions.primary.icon && <i className={actions.primary.icon} />}{actions.primary.label}
            </button>
      )}
      <AskBar onOpen={openCommand} />
      <button
        ref={moreRef}
        className="iconbtn topbar-more"
        aria-label="More actions"
        title="More actions"
        aria-haspopup="menu"
        onClick={handleMore}
      >
        <i className="ri-more-2-fill" />
      </button>
    </div>
  );
}

function AskBar({ onOpen }: { onOpen: () => void }) {
  return (
    <button className="ask" onClick={onOpen} aria-label="Ask Chief of Staff or search" type="button">
      <i className="ri-search-line ask-icon" aria-hidden />
      <span className="ask-placeholder">Ask Chief of Staff or search…</span>
      <kbd className="ask-kbd">⌘K</kbd>
    </button>
  );
}
