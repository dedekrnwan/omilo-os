/* Shared nav model — single source of truth for the v2 flat sidebar.
   Later tasks (topbar, mobile breadcrumb) import NavItem / navItemFor from here. */

export type NavItem = {
  href?: string;
  label: string;
  icon: string;
  soon?: boolean;
  count?: "inbox";
};

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

export const NAV: NavGroup[] = [
  {
    id: "home",
    label: "HOME",
    items: [
      { href: "/", label: "Inbox", icon: "ri-inbox-2-line", count: "inbox" },
      { href: "/chat/", label: "Workspace", icon: "ri-chat-3-line" },
      { href: "/monitor/", label: "Monitor", icon: "ri-dashboard-3-line" },
    ],
  },
  {
    id: "work",
    label: "WORK",
    items: [
      { href: "/plan/", label: "Plan", icon: "ri-node-tree" },
      { href: "/calendar/", label: "Calendar", icon: "ri-calendar-line" },
      { href: "/workflows/", label: "Workflows", icon: "ri-flow-chart" },
      { href: "/docs/", label: "Docs", icon: "ri-book-2-line" },
    ],
  },
  {
    id: "team",
    label: "TEAM",
    items: [
      { href: "/staff/", label: "Team", icon: "ri-team-line" },
      { href: "/company/", label: "Company", icon: "ri-building-2-line" },
    ],
  },
  {
    id: "personas",
    label: "PERSONAS",
    items: [
      { label: "Marketplace", icon: "ri-store-2-line", soon: true },
      { label: "Hired", icon: "ri-user-star-line", soon: true },
    ],
  },
  {
    id: "setup",
    label: "SETUP",
    items: [
      { href: "/connectors/", label: "Connectors", icon: "ri-plug-line" },
      { href: "/skills/", label: "Skills", icon: "ri-magic-line" },
      { href: "/computer/", label: "Folders", icon: "ri-folder-3-line" },
      { href: "/harness/", label: "AI accounts", icon: "ri-stack-line" },
    ],
  },
];

/** All routable nav items (those with an href), flattened across all groups. */
const ALL_ITEMS: NavItem[] = NAV.flatMap((g) => g.items.filter((it) => it.href));

/**
 * Longest-prefix match over items that have an href.
 * Inbox ("/") matches only when path === "/" exactly.
 * Falls back to the Inbox item if nothing matches.
 */
export function navItemFor(path: string): NavItem {
  const inbox = ALL_ITEMS.find((it) => it.href === "/")!;
  const candidates = ALL_ITEMS.filter((it) =>
    it.href === "/"
      ? path === "/"
      : path.startsWith(it.href!)
  );
  if (candidates.length === 0) return inbox;
  return candidates.sort((a, b) => b.href!.length - a.href!.length)[0];
}
