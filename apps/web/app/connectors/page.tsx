"use client";
import { usePageActions } from "@/components/PageActions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Drawer from "@/components/Drawer";
import { Err } from "@/components/ui";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/poll";
import { copy, menu, sep } from "@/lib/menu";
import { confirmDialog } from "@/lib/dialog";

/*
 * Connectors page — two surfaces:
 *
 *  1. Marketplace grid (primary): category-grouped cards from GET /catalog.
 *     State-driven action per card: Connect / Connected (Disconnect) / Needs reconnect.
 *     No technical fields (no URLs, API keys, MCP wording).
 *
 *  2. Advanced section (collapsed by default): raw MCP connector form and
 *     restorable-connectors banner from the previous version.  Kept for power
 *     users who need to wire up arbitrary MCP servers.
 *
 * Decision: the raw form is not removed — it covers use cases the marketplace
 * cannot (custom MCP servers, Zapier, Playwright, local programs).  It is
 * collapsed behind an "Advanced" toggle so it is not the first thing a
 * non-IT business owner sees.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CatalogEntry = {
  slug: string;
  label: string;
  category: string;
  description?: string;
  logo_url: string;
  connected: boolean;
  needs_reconnect: boolean;
  actions?: { label: string; approval: string }[];
  provider?: string;
};

type Conn = {
  id: string; label: string; kind: "http" | "stdio" | "piece"; url: string; command: string;
  args: string[]; approval: "auto" | "ask"; default_on: boolean; enabled: boolean;
  header_names: string[]; env_names: string[];
};

type Pair = { k: string; v: string };
type Form = {
  id: string; label: string; kind: "http" | "stdio"; url: string; command: string;
  args: string; approval: "auto" | "ask"; default_on: boolean; enabled: boolean;
  secrets: Pair[]; editing: boolean; tpl: string;
};
type Test = { ok: boolean | null; detail: string; tools?: string[] };
type Tpl = {
  key: string; name: string; icon: string; blurb: string; form: Partial<Form>;
  help?: string; steps?: string[]; link?: [string, string]; urlHint?: string;
  group: "social" | "work" | "dev" | "any"; tools?: string[]; color?: string;
};

// ---------------------------------------------------------------------------
// Poll state for a single connect flow
// ---------------------------------------------------------------------------

type ConnectState = "idle" | "connecting" | "polling" | "expired";

// ---------------------------------------------------------------------------
// Templates (raw MCP connectors — advanced section)
// ---------------------------------------------------------------------------

const COMPOSIO_URL = "https://backend.composio.dev/v3/mcp/YOUR_SERVER_ID?user_id=YOUR_USER_ID";
const composio = (
  key: string, name: string, icon: string, blurb: string,
  account: string, tools: string[], color: string,
  group: Tpl["group"] = "social",
): Tpl => ({
  key, name, icon, blurb, group, tools, color, urlHint: COMPOSIO_URL,
  link: ["https://composio.dev", "Open Composio"],
  steps: [
    `Sign in at composio.dev and add the ${name} toolkit. Connect ${account} there (you log in on ${name}'s own page; Omilo never sees your password).`,
    "Create an MCP server with that toolkit and copy its address. It looks like the example in Address below, with your server id and user id.",
    "Copy your Composio API key into the x-api-key header below, then Add and test.",
  ],
  help: group === "social"
    ? "Helpers can read, plan and draft freely. Posting, replying or sending always comes to your Inbox first."
    : undefined,
  form: { label: name, kind: "http", approval: "ask", secrets: [{ k: "x-api-key", v: "" }] },
});

const TEMPLATES: Tpl[] = [
  composio("instagram", "Instagram", "ri-instagram-line", "Posts, comments, insights", "your Instagram Business or Creator account", ["instagram"], "#e1306c"),
  composio("facebook", "Facebook Pages", "ri-facebook-circle-line", "Page posts, comments, messages", "the Facebook Page you manage", ["facebook"], "#1877f2"),
  composio("whatsapp", "WhatsApp Business", "ri-whatsapp-line", "Messages and templates", "your WhatsApp Business account (Meta Business)", ["whatsapp"], "#25d366"),
  composio("tiktok", "TikTok", "ri-tiktok-line", "Videos and profile stats", "your TikTok account", ["tiktok"], "#111111"),
  composio("linkedin", "LinkedIn", "ri-linkedin-box-line", "Posts on your profile or page", "your LinkedIn account", ["linkedin"], "#0a66c2"),
  composio("x", "X (Twitter)", "ri-twitter-x-line", "Posts, replies, mentions", "your X account", [], "#111111"),
  composio("youtube", "YouTube", "ri-youtube-line", "Channel videos, comments, stats", "your YouTube channel", [], "#ff0000"),
  {
    key: "zapier", name: "Many apps via Zapier", icon: "ri-flashlight-line",
    blurb: "8,000+ apps through one connection", group: "social",
    link: ["https://mcp.zapier.com", "Open Zapier MCP"],
    steps: [
      "At mcp.zapier.com create an MCP server and add the actions you want, for example Instagram for Business, Facebook Pages or WhatsApp.",
      "Generate a connection token (it is shown once) and paste it after \"Bearer \" below.",
      "Every action runs through your Zapier account, with its own limits and pricing.",
    ],
    help: "Posting and sending still need your OK in the Inbox.",
    form: { label: "Zapier", kind: "http", url: "https://mcp.zapier.com/api/v1/connect", approval: "ask", secrets: [{ k: "Authorization", v: "Bearer " }] },
  },
  composio("gmail", "Gmail", "ri-mail-line", "Read and draft email", "your Google account", ["gmail"], "#ea4335", "work"),
  composio("calendar", "Google Calendar", "ri-calendar-line", "Events and free time", "your Google account", ["calendar"], "#1a73e8", "work"),
  composio("sheets", "Google Sheets", "ri-file-excel-2-line", "Read and update sheets", "your Google account", ["sheets", "drive"], "#0f9d58", "work"),
  composio("notion", "Notion", "ri-notion-line", "Pages and databases", "your Notion workspace", ["notion"], "#111111", "work"),
  composio("slack", "Slack", "ri-slack-line", "Channels and messages", "your Slack workspace", ["slack"], "#4a154b", "work"),
  {
    key: "github", name: "GitHub", icon: "ri-github-line", blurb: "Issues, pull requests, code",
    group: "dev", tools: ["github"],
    help: "Create a personal access token on GitHub (Settings → Developer settings) and paste it after “Bearer ”.",
    form: { label: "GitHub", kind: "http", url: "https://api.githubcopilot.com/mcp/", approval: "ask", secrets: [{ k: "Authorization", v: "Bearer " }] },
  },
  {
    key: "playwright", name: "Browser (Playwright)", icon: "ri-global-line",
    blurb: "Open and use websites", group: "dev", tools: ["website", "marketplace"],
    help: "Needs Node.js on this computer. The first run downloads the browser.",
    form: { label: "Browser", kind: "stdio", command: "npx", args: "-y @playwright/mcp@latest", approval: "ask" },
  },
  {
    key: "context7", name: "Library docs (Context7)", icon: "ri-book-open-line",
    blurb: "Up-to-date docs for code libraries", group: "dev",
    help: "Read-only, so it can be used directly. Needs Node.js.",
    form: { label: "Library docs", kind: "stdio", command: "npx", args: "-y @upstash/context7-mcp", approval: "auto" },
  },
  {
    key: "postgres", name: "Postgres database", icon: "ri-database-2-line",
    blurb: "Read your database", group: "dev",
    help: "Replace the address with your database's (a read-only user is safest). Needs Node.js.",
    form: { label: "Database", kind: "stdio", command: "npx", args: "-y @modelcontextprotocol/server-postgres postgresql://readonly:password@localhost:5432/app", approval: "ask" },
  },
  { key: "web", name: "Any web address", icon: "ri-links-line", blurb: "An MCP server URL from its maker", group: "any", form: { kind: "http" } },
  { key: "program", name: "Any program", icon: "ri-terminal-box-line", blurb: "An MCP server you run here", group: "any", form: { kind: "stdio" } },
];
const GROUPS: [Tpl["group"], string][] = [["social", "Social media"], ["work", "Work apps"], ["dev", "For building"], ["any", "Anything else"]];

const blank: Form = {
  id: "", label: "", kind: "http", url: "", command: "", args: "", approval: "ask",
  default_on: true, enabled: true, secrets: [{ k: "", v: "" }], editing: false, tpl: "",
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const withBlankRow = (p: Pair[]) => (p.length && !p[p.length - 1].k && !p[p.length - 1].v ? p : [...p, { k: "", v: "" }]);

// ---------------------------------------------------------------------------
// The app catalog: search, category picks and a card per app (the same look as hiring from The Agency)
// ---------------------------------------------------------------------------

const CAT_COLORS = ["#6366f1", "#ec4899", "#14b8a6", "#f97316", "#0ea5e9", "#8b5cf6", "#65a30d", "#f59e0b", "#ef4444", "#06b6d4"];
function catColor(cat: string) {
  let h = 0;
  for (const c of cat) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CAT_COLORS[h % CAT_COLORS.length];
}

function AppLogo({ entry, size = 32 }: { entry: CatalogEntry; size?: number }) {
  return entry.logo_url ? (
    <span className="emoji app-logo" style={{ width: size, height: size }}><img src={entry.logo_url} alt="" width={size * 0.62} height={size * 0.62} /></span>
  ) : (
    <span className="emoji app-logo" style={{ width: size, height: size }} aria-hidden="true"><i className="ri-plug-line" /></span>
  );
}

function actionsLine(e: CatalogEntry) {
  const acts = e.actions || [];
  if (!acts.length) return "";
  const ask = acts.filter((a) => a.approval !== "auto").length;
  return `${acts.length} action${acts.length > 1 ? "s" : ""}${ask ? ` · ${ask} need${ask > 1 ? "" : "s"} your OK` : ""}`;
}

function ConnectorCard({ entry, onOpen, onConnect, connectState }: {
  entry: CatalogEntry; onOpen: (e: CatalogEntry) => void; onConnect: (slug: string) => void; connectState: ConnectState;
}) {
  const busy = connectState === "connecting" || connectState === "polling";
  const on = entry.connected && !entry.needs_reconnect;
  return (
    <div className={`card talent app-card ${on ? "is-on" : ""}`} role="button" tabIndex={0} onClick={() => onOpen(entry)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(entry); } }} aria-label={`${entry.label}: details`}>
      <div className="acts" style={{ gap: 10, flexWrap: "nowrap" }}>
        <AppLogo entry={entry} />
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <b>{entry.label}</b>
          <span className="small"><span className="dot" style={{ background: catColor(entry.category || "Other") }} />{entry.category || "Other"}</span>
        </span>
        {entry.needs_reconnect ? <span className="chip warn" style={{ marginLeft: "auto" }}>Reconnect</span>
          : on ? <span className="chip up" style={{ marginLeft: "auto" }}><i className="ri-check-line" />Connected</span> : null}
      </div>
      <span className="clamp small" style={{ color: "var(--ink-2)" }}>{entry.description || "Let your helpers use " + entry.label + "."}</span>
      <div className="app-foot">
        <span className="small">{busy ? (connectState === "connecting" ? "Opening sign-in…" : "Waiting for sign-in…")
          : connectState === "expired" ? <span style={{ color: "var(--warn)" }}>Sign-in timed out. Try again.</span> : actionsLine(entry)}</span>
        <span className="sp" />
        {!on && (
          <button className="btn sm primary" disabled={busy} onClick={(e) => { e.stopPropagation(); onConnect(entry.slug); }}
            aria-label={entry.needs_reconnect ? `Reconnect ${entry.label}` : `Connect ${entry.label}`}>
            {busy ? <span className="spin" /> : <i className="ri-link" />}{entry.needs_reconnect ? "Reconnect" : "Connect"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Advanced section: raw MCP connector form (template picker button)
// ---------------------------------------------------------------------------

function TplButton({ t, onPick }: { t: Tpl; onPick: (t: Tpl) => void }) {
  return (
    <button type="button" className="tpl" onClick={() => onPick(t)}>
      <i className={t.icon} style={t.color ? { color: t.color } : undefined} />
      <span style={{ display: "flex", flexDirection: "column" }}>
        <b>{t.name}</b><span>{t.blurb}</span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function Connectors() {
  // Marketplace catalog
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  // Per-slug connect state: "idle" | "connecting" | "polling" | "expired"
  const [connectStates, setConnectStates] = useState<Record<string, ConnectState>>({});
  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // Advanced section: raw connectors list + form
  const [list, setList] = useState<Conn[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [tests, setTests] = useState<Record<string, Test>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [openApp, setOpenApp] = useState<string | null>(null);

  // Restorable connectors
  type Old = { dir: string; moved_at: string | null; connectors: { id: string; label: string; kind: string; here: boolean }[] };
  const [old, setOld] = useState<Old | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoredMsg, setRestoredMsg] = useState<string | null>(null);

  const [usesTools, setUsesTools] = useState<string[]>([]);

  // Load catalog (marketplace)
  const loadCatalog = useCallback(async () => {
    try { setCatalog(await api<CatalogEntry[]>("/catalog")); }
    catch { /* catalog not loaded yet — leave null */ }
  }, []);

  // Re-fetch the pieces repo and rebuild the catalog, then reload the grid.
  const [refreshing, setRefreshing] = useState(false);
  const refreshCatalog = useCallback(async () => {
    setRefreshing(true);
    try { await api("/catalog/refresh", { method: "POST" }); await loadCatalog(); }
    catch (e: any) { setErr(e.message); }
    finally { setRefreshing(false); }
  }, [loadCatalog]);

  // Load raw connectors list (advanced section)
  const loadList = useCallback(async () => {
    try { setList(await api<Conn[]>("/connectors")); }
    catch (e: any) { setErr(e.message); }
  }, []);

  const load = useCallback(async () => {
    await Promise.all([loadCatalog(), loadList()]);
  }, [loadCatalog, loadList]);

  usePoll(load, 60000, [load], (n) => n?.url === "/connectors" || n?.url === "/catalog");

  useEffect(() => {
    api<Old[]>("/connectors/restorable").then((r) => {
      let hidden: string[] = [];
      try { hidden = JSON.parse(localStorage.getItem("omilo.restore.hidden") || "[]"); } catch { /* private window */ }
      setOld(r.find((x) => x.connectors.some((c) => !c.here) && !hidden.includes(x.dir)) || null);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    api<{ answers: { tools?: string[] } }>("/onboarding")
      .then((o) => setUsesTools(o.answers?.tools || []))
      .catch(() => {});
  }, []);

  const bringBack = async () => {
    if (!old) return;
    setRestoring(true);
    try {
      const r = await api<{ restored: string[]; secrets_missing: string[] }>("/connectors/restore", { body: { dir: old.dir } });
      setRestoredMsg(`Brought back ${r.restored.length} connector${r.restored.length === 1 ? "" : "s"}.`
        + (r.secrets_missing.length ? ` Re-enter the secret for: ${r.secrets_missing.join(", ")}.` : ""));
      setOld(null);
      await load();
      r.restored.forEach((id) => test(id));
    } catch (e: any) { setErr(e.message); }
    finally { setRestoring(false); }
  };

  const hideOld = () => {
    if (!old) return;
    try {
      const h = JSON.parse(localStorage.getItem("omilo.restore.hidden") || "[]");
      localStorage.setItem("omilo.restore.hidden", JSON.stringify([...h, old.dir]));
    } catch { /* private window */ }
    setOld(null);
  };

  // ---------------------------------------------------------------------------
  // Marketplace connect/disconnect actions
  // ---------------------------------------------------------------------------

  const setConnectState = (s: string, state: ConnectState) =>
    setConnectStates((prev) => ({ ...prev, [s]: state }));

  const stopPoll = (s: string) => {
    if (pollTimers.current[s]) {
      clearInterval(pollTimers.current[s]);
      delete pollTimers.current[s];
    }
  };

  const startConnect = async (s: string) => {
    setConnectState(s, "connecting");
    setErr(null);
    try {
      const { auth_url, state } = await api<{ auth_url: string; state: string }>(
        `/connectors/pieces/${s}/connect`
      );
      // Open the OAuth window
      window.open(auth_url, "_blank", "noopener,noreferrer,width=600,height=700");
      setConnectState(s, "polling");

      // Poll every 1.5s for up to ~3 minutes (120 ticks)
      let ticks = 0;
      stopPoll(s);
      pollTimers.current[s] = setInterval(async () => {
        ticks++;
        try {
          const res = await api<{ status: string }>(`/connectors/pieces/connect/${state}`);
          if (res.status === "connected") {
            stopPoll(s);
            setConnectState(s, "idle");
            await load();
          } else if (res.status === "expired" || ticks >= 120) {
            stopPoll(s);
            setConnectState(s, "expired");
          }
        } catch {
          stopPoll(s);
          setConnectState(s, "expired");
        }
      }, 1500);
    } catch (e: any) {
      setConnectState(s, "idle");
      setErr(/not found|404/i.test(e?.message || "")
        ? "This connector isn’t available yet — it hasn’t been enabled on the server."
        : (e?.message || "Couldn’t start the connection. Try again."));
    }
  };

  const disconnect = async (s: string, label: string) => {
    if (!(await confirmDialog({
      title: `Disconnect ${label}?`,
      body: "Your helpers will lose access to this app. You can reconnect it any time.",
      confirm: "Disconnect",
      danger: true,
    }))) return;
    try {
      await api(`/connectors/${s}`, { method: "DELETE" });
      await load();
    } catch (e: any) { setErr(e.message); }
  };

  // Cleanup on unmount
  useEffect(() => {
    const timers = pollTimers.current;
    return () => { Object.values(timers).forEach(clearInterval); };
  }, []);

  // ---------------------------------------------------------------------------
  // Raw connector form actions (advanced section)
  // ---------------------------------------------------------------------------

  const close = useCallback(() => { setForm(null); setErr(null); }, []);

  const startNew = useCallback(() => { setErr(null); setForm({ ...blank }); setShowAdvanced(true); }, []);
  const pick = (t: Tpl) => setForm((f) => ({
    ...blank, ...t.form, tpl: t.key,
    secrets: withBlankRow(t.form.secrets || []),
    id: slug(t.form.label || ""), label: t.form.label || "",
    editing: f?.editing || false,
  }));
  const edit = (c: Conn) => {
    // Piece connectors are managed from the marketplace and never appear in rawList,
    // so c.kind is always "http" | "stdio" here — the cast is safe.
    const rawKind = c.kind === "piece" ? "http" : c.kind;
    setErr(null);
    setForm({
      id: c.id, label: c.label, kind: rawKind, url: c.url, command: c.command,
      args: c.args.join(" "), approval: c.approval, default_on: c.default_on,
      enabled: c.enabled, editing: true, tpl: "edit",
      secrets: withBlankRow((c.kind === "http" ? c.header_names : c.env_names).map((k) => ({ k, v: "" }))),
    });
  };

  const save = async () => {
    if (!form) return;
    setErr(null); setBusy(true);
    const pairs = form.secrets.filter((p) => p.k.trim());
    const secrets = form.editing && !pairs.some((p) => p.v) ? undefined
      : Object.fromEntries(pairs.map((p) => [p.k.trim(), p.v]));
    const body = {
      id: form.id || slug(form.label), label: form.label, kind: form.kind,
      url: form.url.trim(), command: form.command.trim(),
      args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
      approval: form.approval, default_on: form.default_on, enabled: form.enabled,
      ...(form.kind === "http" ? { headers: secrets } : { env: secrets }),
    };
    try {
      const c = await api<Conn>(
        form.editing ? `/connectors/${form.id}` : "/connectors",
        { method: form.editing ? "PUT" : "POST", body }
      );
      setForm(null); await load(); test(c.id);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: { ok: null, detail: "Testing..." } }));
    try {
      const r = await api<Test>(`/connectors/${id}/test`, { body: {} });
      setTests((t) => ({ ...t, [id]: r }));
    } catch (e: any) { setTests((t) => ({ ...t, [id]: { ok: false, detail: e.message } })); }
  };

  const remove = async (id: string, label: string) => {
    if (!(await confirmDialog({
      title: `Remove ${label}?`,
      body: "Helpers lose access to it. You can connect it again later.",
      confirm: "Remove",
      danger: true,
    }))) return;
    await api(`/connectors/${id}`, { method: "DELETE" }); setForm(null); load();
  };

  const toggle = async (c: Conn) => {
    await api(`/connectors/${c.id}`, { method: "PUT", body: { ...c, enabled: !c.enabled } });
    load();
  };

  const items = (c: Conn) => [
    { heading: c.label },
    { label: "Edit", icon: "ri-edit-line", onSelect: () => edit(c) },
    { label: "Test the connection", icon: "ri-pulse-line", onSelect: () => test(c.id) },
    { label: c.enabled ? "Turn off" : "Turn on", icon: c.enabled ? "ri-toggle-line" : "ri-toggle-fill", onSelect: () => toggle(c) },
    { label: "On in every chat", icon: "ri-chat-check-line", checked: c.default_on, onSelect: async () => { await api(`/connectors/${c.id}`, { method: "PUT", body: { ...c, default_on: !c.default_on } }); load(); } },
    { label: "Asks you before using a tool", icon: "ri-hand", checked: c.approval === "ask", onSelect: async () => { await api(`/connectors/${c.id}`, { method: "PUT", body: { ...c, approval: c.approval === "ask" ? "auto" : "ask" } }); load(); } },
    sep,
    { label: c.kind === "http" ? "Copy the address" : "Copy the command", icon: "ri-file-copy-line", onSelect: () => copy(c.kind === "http" ? c.url : `${c.command} ${c.args.join(" ")}`) },
    sep,
    { label: "Remove", icon: "ri-delete-bin-line", danger: true, onSelect: () => remove(c.id, c.label) },
  ];

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const tpl = TEMPLATES.find((t) => t.key === form?.tpl);
  const ready = !!form && !!form.label.trim()
    && (form.kind === "http" ? /^https?:\/\//.test(form.url.trim()) : !!form.command.trim());

  // Piece connectors are managed by the marketplace grid, not the raw Advanced list.
  const rawList = (list || []).filter((c) => c.kind !== "piece");
  const have = new Set((list || []).map((c) => c.label.toLowerCase()));
  const suggested = TEMPLATES.filter(
    (t) => t.tools?.some((x) => usesTools.includes(x)) && !have.has((t.form.label || t.name).toLowerCase())
  );

  const nConnected = (catalog || []).filter((e) => e.connected).length;
  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of catalog || []) m.set(e.category || "Other", (m.get(e.category || "Other") || 0) + 1);
    return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  }, [catalog]);
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    return (catalog || []).filter((e) => (cat === "" || (cat === "@connected" ? e.connected : (e.category || "Other") === cat))
      && (!words || `${e.label} ${e.category} ${e.description || ""} ${(e.actions || []).map((a) => a.label).join(" ")}`.toLowerCase().includes(words)))
      .sort((x, y) => Number(y.connected) - Number(x.connected) || x.label.localeCompare(y.label));
  }, [catalog, q, cat]);
  const appOpen = openApp ? (catalog || []).find((e) => e.slug === openApp) || null : null;
  usePageActions({
    primary: { label: "Custom integration", icon: "ri-code-s-slash-line", onSelect: startNew },
    more: [
      { label: refreshing ? "Updating the list of apps…" : "Update the list of apps", icon: "ri-refresh-line", disabled: refreshing, onSelect: refreshCatalog },
    ],
  }, [refreshing, startNew]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div>
      {/* Page Header v2 */}
      <div className="ph2">
        <div className="ph2-text">
          <h1 className="ph2-title">Connectors</h1>
          <p className="ph2-sub">Give helpers the apps you already use. Anything that posts, sends or spends still waits for your OK.</p>
        </div>
        <div className="ph2-actions">
          <button className="btn primary" onClick={startNew}><i className="ri-code-s-slash-line" />Custom integration</button>
        </div>
      </div>

      {/* Filters v2: search + category picks + connected counter */}
      <div className="cn2-filters">
        <div className="cn2-search">
          <i className="ri-search-line cn2-search-ic" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search apps"
            className="cn2-search-input" aria-label="Search apps" />
        </div>
        {catalog && catalog.length > 0 && (
          <div className="picks cn2-picks">
            <button className={`pick ${cat === "" ? "on" : ""}`} onClick={() => setCat("")}>All <span className="mono" style={{ opacity: .6 }}>{catalog.length}</span></button>
            {cats.map(([c, n]) => (
              <button key={c} className={`pick ${cat === c ? "on" : ""}`} onClick={() => setCat(cat === c ? "" : c)}>
                <span className="dot" style={{ background: catColor(c) }} />{c} <span className="mono" style={{ opacity: .6 }}>{n}</span>
              </button>
            ))}
          </div>
        )}
        <span className="sp" />
        {catalog && (
          <button
            className={`pick cn2-connected-pick ${cat === "@connected" ? "on" : ""}`}
            onClick={() => setCat(cat === "@connected" ? "" : "@connected")}
            title="Show only connected apps"
          >
            <span className="dot" style={{ background: nConnected > 0 ? "var(--ok)" : "var(--faint)" }} />
            {nConnected} of {catalog.length} connected
          </button>
        )}
      </div>

      {/* Restorable connectors banner */}
      {old && (
        <div className="restore-banner">
          <i className="ri-history-line" />
          <div>
            <b>Your earlier connections are still saved</b>
            <div className="small">
              A reset{old.moved_at ? ` on ${new Date(old.moved_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""} moved
              your old Omilo data aside, with {old.connectors.filter((c) => !c.here).map((c) => c.label).join(", ")}. Their secrets are kept too.
            </div>
          </div>
          <span className="sp" />
          <button className="btn quiet" onClick={hideOld}>Not now</button>
          <button className="btn primary" disabled={restoring} onClick={bringBack}>
            <i className="ri-arrow-go-back-line" />
            {restoring ? "Bringing back..." : `Bring back ${old.connectors.filter((c) => !c.here).length}`}
          </button>
        </div>
      )}
      {restoredMsg && <div className="callout ok" style={{ marginTop: 16 }}>{restoredMsg}</div>}

      {/* Global error */}
      {!form && err && <Err error={err} />}

      {/* --------------- Marketplace grid --------------- */}
      {catalog === null ? (
        <p className="small">Loading available apps…</p>
      ) : catalog.length === 0 ? (
        <div className="empty">
          <b>No apps in the list yet</b>
          <span>Update the list, or add a custom integration under Advanced below.</span>
          <div style={{ marginTop: 12 }}><button className="btn primary" onClick={refreshCatalog} disabled={refreshing}>Update list</button></div>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty"><b>No app matches</b><span>Try another word or category, or add it as a custom integration below.</span></div>
      ) : (
        <div className="cards app-cards">
          {shown.map((entry) => (
            <ConnectorCard key={entry.slug} entry={entry} onOpen={(e) => setOpenApp(e.slug)} onConnect={startConnect}
              connectState={connectStates[entry.slug] ?? "idle"} />
          ))}
        </div>
      )}

      {/* Callout (pen MY64n) */}
      {catalog !== null && (
        <div className="callout cn2-callout">
          <i className="ri-shield-check-line" />
          Need something else? Add an MCP server or a webhook under Custom integration. Helpers only act inside the tools you connect.
        </div>
      )}

      {/* --------------- App details --------------- */}
      {appOpen && (
        <Drawer open onClose={() => setOpenApp(null)} title={appOpen.label} icon={<AppLogo entry={appOpen} size={34} />}
          sub={<><span className="dot" style={{ background: catColor(appOpen.category || "Other") }} />{appOpen.category || "Other"}
            {appOpen.connected && !appOpen.needs_reconnect ? " · Connected" : appOpen.needs_reconnect ? " · Needs reconnecting" : ""}</>}
          footer={<>
            {appOpen.connected && !appOpen.needs_reconnect
              ? <button className="btn danger" onClick={() => { const e = appOpen; setOpenApp(null); disconnect(e.slug, e.label); }}><i className="ri-link-unlink" />Disconnect</button>
              : <button className="btn primary" disabled={["connecting", "polling"].includes(connectStates[appOpen.slug] ?? "idle")} onClick={() => startConnect(appOpen.slug)}>
                  <i className="ri-link" />{appOpen.needs_reconnect ? "Reconnect" : `Connect ${appOpen.label}`}</button>}
            <span className="sp" /><button className="btn" onClick={() => setOpenApp(null)}>Close</button>
          </>}>
          <div className="dw-sec">
            <p style={{ marginTop: 0 }}>{appOpen.description || `Let your helpers use ${appOpen.label}.`}</p>
            <div className="soft" style={{ margin: "14px 0" }}>
              <div className="small"><i className="ri-shield-check-line" /> You sign in with {appOpen.provider ? `your ${appOpen.provider[0].toUpperCase()}${appOpen.provider.slice(1)} account` : "your account"}; Omilo keeps the access encrypted. Anything that posts, sends or spends waits for your OK in the Inbox.</div>
            </div>
            {(appOpen.actions || []).length > 0 && (
              <>
                <label style={{ marginTop: 0 }}>What helpers can do</label>
                <ul className="app-acts">
                  {(appOpen.actions || []).map((a) => (
                    <li key={a.label}><span>{a.label}</span>
                      <span className={`chip ${a.approval === "auto" ? "" : "warn"}`}>{a.approval === "auto" ? "Directly" : "Asks you first"}</span></li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </Drawer>
      )}

      {/* --------------- Advanced section (collapsed by default) --------------- */}
      <div style={{ marginTop: 32 }}>
        <button
          className="btn quiet"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          style={{ marginBottom: showAdvanced ? 16 : 0 }}
        >
          <i className={showAdvanced ? "ri-subtract-line" : "ri-add-line"} />
          {showAdvanced ? "Hide advanced" : "Advanced: custom integrations"}
        </button>

        {showAdvanced && (
          <div>
            <p className="small" style={{ marginBottom: 16 }}>
              Add any MCP server by URL or by running a local program. This is for developers
              and custom integrations.
            </p>

            {/* Raw connectors list */}
            <div className="sec" style={{ marginTop: 0 }}>
              <div className="sechead" style={{ marginBottom: 12 }}>
                <span style={{ fontWeight: 500, fontSize: 14 }}>Connected MCP servers</span>
                <span className="sp" />
                <button className="btn sm primary" onClick={startNew}>
                  <i className="ri-add-line" />Add server
                </button>
              </div>

              {list === null ? (
                <p className="small">Loading...</p>
              ) : rawList.length === 0 ? (
                <div className="empty">
                  <b>No custom servers yet</b>
                  <span>Start from a template or add any MCP server by URL or command.</span>
                  <div style={{ marginTop: 12 }}>
                    <button className="btn primary" onClick={startNew}>
                      <i className="ri-add-line" />Add server
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid2">
                  {rawList.map((c) => {
                    const t = tests[c.id];
                    return (
                      <div
                        key={c.id} className="card" role="button" tabIndex={0}
                        style={{ cursor: "pointer" }}
                        onClick={() => edit(c)}
                        onKeyDown={(e) => { if (e.key === "Enter") edit(c); }}
                        onContextMenu={menu(() => items(c))}
                        aria-label={`Edit ${c.label}`}
                      >
                        <div className="acts" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                          <b style={{ fontWeight: 500 }}><i className="ri-plug-line" /> {c.label}</b>
                          <span className={`chip ${!c.enabled ? "idle" : t?.ok === false ? "down" : "up"}`}>
                            {!c.enabled ? "Off" : t?.ok === false ? "Not reachable" : "On"}
                          </span>
                        </div>
                        <div className="small mono" style={{ wordBreak: "break-all" }}>
                          {c.kind === "http" ? c.url : `${c.command} ${c.args.join(" ")}`}
                        </div>
                        <div className="small">
                          {c.approval === "auto" ? "Uses its tools directly" : "Asks you first"}
                          {" "}&middot;{" "}
                          {c.default_on ? "on in every chat" : "off until switched on"}
                        </div>
                        {t && t.ok !== false && <div className={`small ${t.ok ? "up" : ""}`}>{t.detail}</div>}
                        <div className="acts" style={{ marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
                          <button className="btn sm" onClick={() => test(c.id)}>Test</button>
                          <button className="btn sm" onClick={() => toggle(c)}>
                            {c.enabled ? "Turn off" : "Turn on"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* --------------- Drawer: raw connector form --------------- */}
      <Drawer
        open={!!form} onClose={close}
        icon={<i className={tpl?.icon || "ri-plug-line"} />}
        title={form?.editing ? form.label || "Connector"
          : form?.tpl ? `Add ${tpl?.name || "connector"}` : "Add a server"}
        sub={form?.editing ? (form.kind === "http" ? "Web address" : "Program on this computer")
          : form?.tpl ? tpl?.blurb : "Start from a template, or add any MCP server."}
        footer={form && (form.tpl ? (
          <>
            {form.editing
              ? <button className="btn quiet" onClick={() => remove(form.id, form.label)}><i className="ri-delete-bin-line" />Remove</button>
              : <button className="btn quiet" onClick={() => setForm({ ...blank })}><i className="ri-arrow-left-line" />Templates</button>}
            <span className="sp" />
            <button className="btn" onClick={close}>Cancel</button>
            <button className="btn primary" disabled={!ready || busy} onClick={save}>
              {busy ? "Saving..." : form.editing ? "Save changes" : "Add and test"}
            </button>
          </>
        ) : <><span className="sp" /><button className="btn" onClick={close}>Cancel</button></>)}
      >
        {form && !form.tpl && (
          <>
            {suggested.length > 0 && (
              <div className="dw-sec">
                <h3>From your setup</h3>
                <p className="dw-help" style={{ marginTop: 0 }}>
                  You said you use these. Connect them so helpers can work with them.
                </p>
                <div className="tpl-grid">
                  {suggested.map((t) => <TplButton key={t.key} t={t} onPick={pick} />)}
                </div>
              </div>
            )}
            {GROUPS.map(([g, title]) => (
              <div key={g} className="dw-sec">
                <h3>{title}</h3>
                <div className="tpl-grid">
                  {TEMPLATES.filter((t) => t.group === g).map((t) => (
                    <TplButton key={t.key} t={t} onPick={pick} />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
        {form && form.tpl && (
          <>
            {tpl?.steps && (
              <div className="dw-sec tpl-steps">
                <h3>How to connect {tpl.name}</h3>
                <ol>{tpl.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
                {tpl.link && (
                  <a className="btn sm" href={tpl.link[0]} target="_blank" rel="noopener noreferrer">
                    <i className="ri-external-link-line" />{tpl.link[1]}
                  </a>
                )}
              </div>
            )}
            {tpl?.help && <div className="callout" style={{ marginTop: 16 }}>{tpl.help}</div>}
            <div className="dw-sec">
              <label style={{ marginTop: 0 }}>Name</label>
              <input
                value={form.label}
                onChange={(e) => set({ label: e.target.value, ...(form.editing ? {} : { id: slug(e.target.value) }) })}
                placeholder="e.g. GitHub"
              />
              {!form.editing && (form.tpl === "web" || form.tpl === "program") && (
                <>
                  <label>How it connects</label>
                  <div className="opt2">
                    <button type="button" className={form.kind === "http" ? "on" : ""} onClick={() => set({ kind: "http" })}>
                      <b><i className="ri-links-line" />Web address</b><span>The maker gives you a URL</span>
                    </button>
                    <button type="button" className={form.kind === "stdio" ? "on" : ""} onClick={() => set({ kind: "stdio" })}>
                      <b><i className="ri-terminal-box-line" />Program</b><span>Runs on this computer</span>
                    </button>
                  </div>
                </>
              )}
              {form.kind === "http" ? (
                <>
                  <label>Address</label>
                  <input
                    value={form.url}
                    onChange={(e) => set({ url: e.target.value })}
                    placeholder={tpl?.urlHint || "https://example.com/mcp"}
                    inputMode="url"
                  />
                  {tpl?.urlHint && (
                    <p className="dw-help">Paste the address Composio gives you; it has your server id and user id in it.</p>
                  )}
                </>
              ) : (
                <>
                  <label>Command</label>
                  <input className="mono" value={form.command} onChange={(e) => set({ command: e.target.value })} placeholder="npx" />
                  <label>Arguments</label>
                  <input className="mono" value={form.args} onChange={(e) => set({ args: e.target.value })} placeholder="-y @scope/some-mcp-server" />
                </>
              )}
            </div>

            <div className="dw-sec">
              <h3>{form.kind === "http" ? "Secret headers" : "Secret settings"}</h3>
              <p className="dw-help" style={{ marginTop: 0, marginBottom: 8 }}>
                {form.kind === "http"
                  ? "Usually an Authorization header with a token."
                  : "Environment variables such as API keys."}
                {" "}Stored encrypted; only the helpers' AI engine receives them.
              </p>
              {form.secrets.map((p, i) => (
                <div key={i} className="kv">
                  <input
                    value={p.k}
                    placeholder={form.kind === "http" ? "Authorization" : "API_TOKEN"}
                    aria-label="Name"
                    onChange={(e) => set({ secrets: withBlankRow(form.secrets.map((x, j) => (j === i ? { ...x, k: e.target.value } : x))) })}
                  />
                  <input
                    type="password" autoComplete="off" value={p.v} aria-label="Value"
                    placeholder={form.editing && p.k ? "saved (type to replace)" : "value"}
                    onChange={(e) => set({ secrets: withBlankRow(form.secrets.map((x, j) => (j === i ? { ...x, v: e.target.value } : x))) })}
                  />
                  {(p.k || p.v)
                    ? <button className="iconbtn" aria-label="Remove" onClick={() => set({ secrets: withBlankRow(form.secrets.filter((_, j) => j !== i)) })}><i className="ri-close-line" /></button>
                    : <span />}
                </div>
              ))}
            </div>

            <div className="dw-sec">
              <h3>Before using its tools</h3>
              <div className="opt2" style={{ marginTop: 8 }}>
                <button type="button" className={form.approval === "ask" ? "on" : ""} onClick={() => set({ approval: "ask" })}>
                  <b><i className="ri-shield-check-line" />Ask me first</b><span>Helpers request it in the Inbox</span>
                </button>
                <button type="button" className={form.approval === "auto" ? "on" : ""} onClick={() => set({ approval: "auto" })}>
                  <b><i className="ri-flashlight-line" />Use directly</b><span>For read-only, low-risk tools</span>
                </button>
              </div>
              <div className="togrow" style={{ marginTop: 8 }} onClick={() => set({ default_on: !form.default_on })}>
                <span className="t">
                  <b>On in every chat and job</b>
                  <span>Otherwise switch it on per chat with +</span>
                </span>
                <span className={`switch ${form.default_on ? "on" : ""}`} role="switch" aria-checked={form.default_on}><i /></span>
              </div>
              {form.editing && (
                <div className="togrow" onClick={() => set({ enabled: !form.enabled })}>
                  <span className="t">
                    <b>Server is on</b>
                    <span>Turn off to stop every helper from using it</span>
                  </span>
                  <span className={`switch ${form.enabled ? "on" : ""}`} role="switch" aria-checked={form.enabled}><i /></span>
                </div>
              )}
            </div>

            {form.editing && (
              <div className="dw-sec">
                <div className="acts" style={{ justifyContent: "space-between" }}>
                  <h3 style={{ margin: 0 }}>Connection</h3>
                  <button className="btn sm" onClick={() => test(form.id)}><i className="ri-pulse-line" />Test now</button>
                </div>
                {tests[form.id] ? (
                  <div className={`callout ${tests[form.id].ok ? "ok" : tests[form.id].ok === false ? "warn" : ""}`} style={{ marginTop: 8 }}>
                    {tests[form.id].detail}
                    {!!tests[form.id].tools?.length && (
                      <div className="small" style={{ marginTop: 6 }}>{tests[form.id].tools!.join(", ")}</div>
                    )}
                  </div>
                ) : <p className="dw-help">Not tested in this visit.</p>}
              </div>
            )}
            <Err error={err} />
          </>
        )}
      </Drawer>
    </div>
  );
}
