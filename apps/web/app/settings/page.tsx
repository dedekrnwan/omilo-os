"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Avatar from "@/components/Avatar";
import ClaudeCodeSetup from "@/components/ClaudeCodeSetup";
import ClaudeSetup, { ClaudeChoice } from "@/components/ClaudeSetup";
import KnowledgeSettings from "@/components/KnowledgeSettings";
import NotifySettings from "@/components/NotifySettings";
import { useOverview } from "@/components/Shell";
import { Err } from "@/components/ui";
import { BASE, ApiError, api } from "@/lib/api";
import { confirmDialog } from "@/lib/dialog";
import { usePoll } from "@/lib/poll";

/* Settings, grouped: Company (general, safety), AI (engine, connection check, knowledge), You (account, devices,
   notifications), Data (activity log, storage). Each section has its own address (/settings/?s=activity) and the
   left list can be searched. Settings that belong to one thing (a helper's permissions, a connector) stay on its page;
   "Elsewhere" links to them. */

type Item = { id: string; label: string; icon: string; words: string; desc: string };
const GROUPS: { label: string; items: Item[] }[] = [
  { label: "Company", items: [
    { id: "general", label: "General", icon: "ri-building-2-line", words: "name company timezone time zone", desc: "Your company's name and time zone." },
    { id: "safety", label: "Safety & limits", icon: "ri-shield-check-line", words: "strict mode approvals pause stop concurrency parallel limits budget spend money cost", desc: "What needs your approval, how many helpers work at once, the company budget and the stop button." },
    { id: "email", label: "Email (SMTP)", icon: "ri-mail-send-line", words: "smtp email mail server host port tls ssl username password from send notifications", desc: "The mail server Omilo uses to send email notifications." },
  ] },
  { label: "AI", items: [
    { id: "ai", label: "AI engine", icon: "ri-sparkling-2-line", words: "claude api key model practice mode engine", desc: "The AI your helpers think with." },
    { id: "health", label: "Connection check", icon: "ri-pulse-line", words: "health working broken status reach", desc: "Can each helper reach its AI right now?" },
    { id: "knowledge", label: "Knowledge", icon: "ri-database-2-line", words: "embeddings vectors voyage openai local model search pgvector", desc: "How knowledge is turned into vectors for search by meaning." },
  ] },
  { label: "You", items: [
    { id: "account", label: "Account", icon: "ri-user-line", words: "name email password", desc: "Your name and password." },
    { id: "devices", label: "Devices & tokens", icon: "ri-device-line", words: "sessions browsers sign out tokens cli api", desc: "Where you're signed in, and tokens for the command line." },
    { id: "notifications", label: "Notifications", icon: "ri-notification-3-line", words: "push alerts notify phone", desc: "What Omilo tells you about, and where." },
  ] },
  { label: "Data", items: [
    { id: "activity", label: "Activity log", icon: "ri-history-line", words: "audit log history who changed what export csv", desc: "Everything that changed, who did it and when." },
    { id: "system", label: "Data & storage", icon: "ri-hard-drive-2-line", words: "postgres redis database storage size version folder", desc: "What this install runs on and where your data lives." },
  ] },
];
const ALL = GROUPS.flatMap((g) => g.items);
const ELSEWHERE: [string, string, string][] = [
  ["/staff/", "Helper access, permissions & budgets", "ri-team-line"], ["/connectors/", "Connectors", "ri-plug-line"], ["/skills/", "Skills", "ri-magic-line"],
  ["/harness/", "Claude subscriptions", "ri-stack-line"], ["/computer/", "Folders", "ri-computer-line"],
];

const fmtBytes = (n?: number | null) => n == null ? "–" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`;
const fmtDay = (d: Date) => {
  const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
};
const ago = (iso?: string | null) => {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} days ago`;
};

function Row({ title, desc, children, wide }: { title: string; desc?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`set-row ${wide ? "wide" : ""}`}>
      <div className="set-row-l"><b>{title}</b>{desc && <span>{desc}</span>}</div>
      <div className="set-row-r">{children}</div>
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" className={`switch ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}><i /></button>;
}

// ------------------------------------------------------------------ sections
function General({ set }: { set: (b: Record<string, unknown>) => Promise<boolean> }) {
  const { overview } = useOverview();
  const [name, setName] = useState(overview?.company_name || "");
  const [tz, setTz] = useState(overview?.timezone || "UTC");
  const [saved, setSaved] = useState<string | null>(null);
  const zones = useMemo(() => { try { return (Intl as any).supportedValuesOf("timeZone") as string[]; } catch { return ["UTC", "Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"]; } }, []);
  const now = useMemo(() => { try { return new Date().toLocaleTimeString([], { timeZone: tz, hour: "2-digit", minute: "2-digit" }); } catch { return ""; } }, [tz]);
  return (
    <>
      <Row title="Company name" desc="Shown in the app and told to every helper.">
        <div className="acts nowrap"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          <button className="btn" disabled={!name.trim() || name === overview?.company_name} onClick={async () => { if (await set({ company_name: name.trim() })) setSaved("name"); }}>Save</button></div>
        {saved === "name" && <span className="set-ok"><i className="ri-check-line" />Saved</span>}
      </Row>
      <Row title="Time zone" desc={<>Regular jobs, schedules and the weekly retro run in this time zone.{now && <> It's <b>{now}</b> there now.</>}</>}>
        <div className="acts nowrap">
          <input list="set-zones" value={tz} onChange={(e) => setTz(e.target.value)} placeholder="Asia/Jakarta" />
          <datalist id="set-zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
          <button className="btn" disabled={tz === overview?.timezone || !zones.includes(tz)} onClick={async () => { if (await set({ timezone: tz })) setSaved("tz"); }}>Save</button>
        </div>
        {saved === "tz" && <span className="set-ok"><i className="ri-check-line" />Saved: schedules follow the new time zone</span>}
      </Row>
    </>
  );
}

function Safety({ set }: { set: (b: Record<string, unknown>) => Promise<boolean> }) {
  const { overview } = useOverview();
  const [conc, setConc] = useState(overview?.max_concurrent_tasks || 3);
  useEffect(() => { if (overview) setConc(overview.max_concurrent_tasks); }, [overview?.max_concurrent_tasks]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!overview) return null;
  return (
    <>
      <Row title="Strict mode" desc="On: anything that leaves the company (posts, messages, payments, deploys) waits for your approval, whatever a helper's permissions say. Recommended.">
        <Switch on={overview.strict_mode} label="Strict mode" onChange={(v) => set({ strict_mode: v })} />
      </Row>
      <Row title="Helpers working at the same time" desc="More means more done in parallel, and more AI usage at once.">
        <div className="set-step">
          <button className="iconbtn" aria-label="Fewer" disabled={conc <= 1} onClick={() => setConc(conc - 1)}><i className="ri-subtract-line" /></button>
          <b>{conc}</b>
          <button className="iconbtn" aria-label="More" disabled={conc >= 20} onClick={() => setConc(conc + 1)}><i className="ri-add-line" /></button>
          {conc !== overview.max_concurrent_tasks && <button className="btn sm" onClick={() => set({ max_concurrent_tasks: conc })}>Save</button>}
        </div>
      </Row>
      <Row title={overview.paused ? "Everything is paused" : "Pause everything"} desc={overview.paused ? "No helper starts new work until you resume." : "Stops every helper from starting new work (jobs in progress finish). The same switch is in the sidebar."}>
        <button className={`btn ${overview.paused ? "primary" : "danger"}`} onClick={async () => {
          if (!overview.paused && !(await confirmDialog({ title: "Pause every helper?", body: "No new jobs start until you resume. Jobs already running finish.", confirm: "Pause everything", danger: true }))) return;
          set({ paused: !overview.paused });
        }}><i className={overview.paused ? "ri-play-line" : "ri-pause-line"} />{overview.paused ? "Resume" : "Pause"}</button>
      </Row>
      <CompanyBudget b={overview.budget_company} set={set} />
      <p className="small set-foot">What each helper may do on its own, what it may open on this computer (Access) and its own monthly budget are set per helper on <Link href="/staff/">Team</Link>.</p>
    </>
  );
}

function CompanyBudget({ b, set }: { b?: { budget_usd: number; cost_usd: number; pct: number | null }; set: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [usd, setUsd] = useState(b?.budget_usd ? String(b.budget_usd) : "");
  useEffect(() => { setUsd(b?.budget_usd ? String(b.budget_usd) : ""); }, [b?.budget_usd]);
  const changed = (Number(usd) || 0) !== (b?.budget_usd || 0);
  return (
    <Row title="Company budget per month" desc={<>All helpers together, in USD at API prices. At 80% you get an alert; at 100% every helper pauses until you raise it or resume.
      Leave empty for no limit.{b && <> This month so far: <b className="mono">${b.cost_usd.toFixed(2)}</b>{b.pct != null && <> ({Math.round(b.pct)}%)</>}.</>}</>}>
      <div className="set-step">
        <input inputMode="decimal" aria-label="Company budget per month in USD" style={{ width: 110 }} value={usd} placeholder="No limit" onChange={(e) => setUsd(e.target.value)} />
        {changed && <button className="btn sm" onClick={() => set({ budget_company_usd: Math.max(0, Number(usd) || 0) })}>Save</button>}
      </div>
    </Row>
  );
}

type AiState = { provider: string; model: string | null; claude_key_hint: string | null; staff: Record<string, { provider: string }>; claude_code?: { installed: boolean }; local_login?: { installed: boolean; logged_in: boolean }; pool_consent?: { consented: boolean; notice_pending: boolean } };
type VendorProvider = { id: string; label: string; icon: string; has_key: boolean };
type PoolState = { ready: number; total: number; cli: { path: string | null } };

const VENDOR_ICON: Record<string, string> = {
  anthropic: "ri-anthropic-line",
  openai: "ri-openai-line",
  gemini: "ri-gemini-line",
  deepseek: "ri-deepseek-line",
  xai: "ri-twitter-x-line",
  mistral: "ri-wind-line",
  bedrock: "ri-amazon-line",
  groq: "ri-cpu-line",
};

function AiEngine() {
  const [ai, setAi] = useState<AiState | null>(null);
  const [edit, setEdit] = useState(false);
  const [claude, setClaude] = useState<ClaudeChoice>({ key: "", model: "", ok: false });
  const [ccReady, setCcReady] = useState(false);
  const [light, setLight] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // vendor picker state
  const [vendors, setVendors] = useState<VendorProvider[]>([]);
  const [vendorEdit, setVendorEdit] = useState<string | null>(null);
  const [vendorKey, setVendorKey] = useState("");
  const [pool, setPool] = useState<PoolState | null>(null);
  const load = useCallback(() => api<AiState>("/ai").then(setAi).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api<VendorProvider[]>("/ai/providers").then(setVendors).catch(() => {}); }, []);
  useEffect(() => { api<PoolState>("/harness").then(setPool).catch(() => {}); }, []);
  const save = async (provider: string) => {
    setErr(null); setMsg(null);
    try {
      const isClaude = provider === "claude" || provider === "claude-direct";
      await api("/ai", { body: isClaude ? { provider, api_key: claude.key || undefined, model: claude.model } : { provider } });
      setEdit(false); setClaude({ key: "", model: "", ok: false });
      setMsg(provider === "claude-code" ? "Saved. Your helpers now run on the Claude subscription pool, with your API key as overflow."
        : provider === "claude" ? "Saved. Your helpers now run in Claude Code with your API key."
        : provider === "claude-direct" ? "Saved. Your helpers use built-in Claude (web search and Omilo's tools)."
        : provider === "local" ? "Saved. Your helpers now run on your locally signed-in Claude."
        : "Saved. All helpers are in practice mode.");
      load();
    } catch (e: any) { setErr(e.message); }
  };
  const saveVendor = async (id: string) => {
    setErr(null); setMsg(null);
    try {
      await api("/ai", { body: { provider: id, api_key: vendorKey || undefined } });
      setVendorEdit(null); setVendorKey("");
      setMsg(`Saved. All helpers now use ${vendors.find((v) => v.id === id)?.label || id}.`);
      load();
      // refresh has_key state
      api<VendorProvider[]>("/ai/providers").then(setVendors).catch(() => {});
    } catch (e: any) { setErr(e.message); }
  };
  const label = (p?: string) => ({ claude: "Claude Code with your API key", "claude-direct": "Built-in Claude (light: web and Omilo's tools)",
    fake: "Practice mode (no AI)", "claude-code": "Claude subscription pool (+ API key overflow)", local: "My Claude Code sign-in (this machine)", mixed: "Different per helper" } as Record<string, string>)[p || ""] || (vendors.find((v) => v.id === (p || ""))?.label) || p || "…";
  const isVendor = (p?: string) => !!vendors.find((v) => v.id === p);
  const p = ai?.provider;
  const sub = p === "claude-code" ? (pool?.cli?.path ? `Pool: ${pool.ready}/${pool.total} seats ready. Your API key covers overflow.` : "Pool first, API key for overflow. Install Claude Code on Harness.")
    : p === "local" ? "Runs your own locally signed-in Claude — your login never leaves this machine."
    : p === "fake" ? "Helpers go through every step without calling an AI."
    : ai?.claude_key_hint ? `key ending in ${ai.claude_key_hint}${p === "claude" && ai.model ? ` · ${ai.model}` : ""}`
    : isVendor(p) ? "Direct API · key on file" : "";
  return (
    <>
      <div className="callout">
        <b>How your team runs</b>
        <p style={{ margin: "6px 0 8px" }}>Every helper is the same Claude Code agent: files, terminal, MCP tools, skills and web work the same way whichever you pick here. The only choice is who pays for each run.</p>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          <li><b>Claude subscription pool</b> (recommended): flat-rate seats you add on <Link href="/harness/">Harness</Link>. Your team runs on these first.</li>
          <li><b>Your Claude API key</b>: the automatic overflow when every pool seat is busy, or it runs the whole team on its own (billed per token) when you have no subscription.</li>
        </ul>
      </div>

      <div className="set-card">
        <i className={`${isVendor(p) ? (VENDOR_ICON[p || ""] || "ri-sparkling-2-line") : p === "claude-code" ? "ri-stack-line" : "ri-sparkling-2-line"} set-card-ic ${p === "fake" ? "idle" : ""}`} />
        <div className="t"><b>{label(p)}</b><span>{sub}</span></div>
      </div>
      {msg && <div className="callout ok">{msg}</div>}

      {!edit && !vendorEdit && (
        <div className="set-box">
          <div className="set-sub" style={{ marginTop: 0 }}>
            <i className="ri-stack-line" /><b>Claude subscription pool</b>
            <span className="small">Recommended. Full powers, flat-rate seats.</span>
          </div>
          <p className="small" style={{ margin: "0 0 10px" }}>Helpers run on your Claude subscriptions first; your API key automatically covers any overflow. Add or manage seats on <Link href="/harness/">Harness</Link>{pool?.cli?.path ? ` (${pool.ready}/${pool.total} ready)` : ""}.</p>
          <div className="acts">
            <button className="btn primary" disabled={p === "claude-code"} onClick={() => save("claude-code")}>{p === "claude-code" ? "In use for all helpers" : "Use the pool for all helpers"}</button>
            <Link className="btn" href="/harness/">Manage seats</Link>
          </div>
        </div>
      )}

      {!edit && !vendorEdit && ai?.local_login?.logged_in && (
        <button type="button" className={`choice${p === "local" ? " on" : ""}`} onClick={() => { if (p !== "local") save("local"); }}>
          <b>Use my Claude Code sign-in (this machine)</b>
          <span>Runs your own locally signed-in Claude — your login never leaves this machine.</span>
        </button>
      )}
      {!edit && !vendorEdit && ai?.local_login?.installed && !ai.local_login.logged_in && (
        <p className="small" style={{ margin: "4px 0 8px", color: "var(--muted)" }}>Claude Code is installed — run <code>claude</code> in a terminal to sign in, then refresh.</p>
      )}

      {!edit && !vendorEdit && (
        <>
          <div className="set-sub"><i className="ri-key-2-line" /><b>Run on your Claude API key only</b><span className="small">Billed per token. Use when you have no subscription.</span></div>
          <div className="acts" style={{ marginBottom: 10 }}>
            <button className="btn" onClick={() => setEdit(true)}>{p === "claude" || p === "claude-direct" ? "Change key or model" : "Use my Claude API key"}</button>
            {ai && p !== "fake" && <button className="btn" onClick={async () => { if (await confirmDialog({ title: "Switch every helper to practice mode?", body: "They stop calling the AI until you switch back.", confirm: "Practice mode" })) save("fake"); }}>Practice mode</button>}
          </div>
        </>
      )}
      {edit && (
        <div className="set-box">
          <ClaudeSetup value={claude} onChange={setClaude} savedHint={ai?.claude_key_hint} />
          {claude.ok && !light && <ClaudeCodeSetup autoInstall onReady={setCcReady} />}
          {claude.ok && !ccReady && (
            <label className="check"><input type="checkbox" checked={light} onChange={(e) => setLight(e.target.checked)} />
              <span>Use built-in Claude for now (nothing to install: web search and Omilo&apos;s tools, but no files, commands or browser)</span></label>
          )}
          <div className="acts" style={{ marginTop: 12 }}>
            <button className="btn primary" disabled={!(claude.ok && claude.model && (ccReady || light))} onClick={() => save(light ? "claude-direct" : "claude")}>Use Claude for all helpers</button>
            <button className="btn" onClick={() => setEdit(false)}>Cancel</button>
          </div>
        </div>
      )}
      {vendors.length > 0 && !edit && (
        <>
          <div className="set-sub" style={{ marginTop: 14 }}><i className="ri-apps-2-line" /><b>Or another provider&apos;s API key</b><span className="small">OpenAI, Gemini, and others (direct API, Omilo&apos;s tools only)</span></div>
          <div className="set-vendor-grid">
            {vendors.map((v) => {
              const active = ai?.provider === v.id;
              const expanding = vendorEdit === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  className={`set-vendor-tile${active ? " on" : ""}${expanding ? " expand" : ""}`}
                  onClick={() => { setVendorEdit(expanding ? null : v.id); setVendorKey(""); setErr(null); setMsg(null); }}
                  aria-pressed={active}
                >
                  <i className={VENDOR_ICON[v.id] || "ri-sparkling-2-line"} />
                  <span>{v.label}</span>
                  {!v.has_key && <span className="set-vendor-needs">Add key</span>}
                  {active && <i className="ri-check-line set-vendor-check" />}
                </button>
              );
            })}
          </div>
          {vendorEdit && (
            <div className="set-box" style={{ marginTop: 8 }}>
              <p className="small" style={{ marginBottom: 8 }}>
                <b>{vendors.find((v) => v.id === vendorEdit)?.label}</b> API key
                {vendors.find((v) => v.id === vendorEdit)?.has_key && <span style={{ marginLeft: 6, color: "var(--ok)" }}><i className="ri-check-line" />Key on file — enter a new one to replace it</span>}
              </p>
              <div className="acts nowrap">
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={vendors.find((v) => v.id === vendorEdit)?.has_key ? "Replace existing key…" : "Paste API key…"}
                  value={vendorKey}
                  onChange={(e) => setVendorKey(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn primary"
                  disabled={!vendorKey.trim() && !vendors.find((v) => v.id === vendorEdit)?.has_key}
                  onClick={() => saveVendor(vendorEdit)}
                >
                  {ai?.provider === vendorEdit ? "Update" : "Use this provider"}
                </button>
                <button className="btn" onClick={() => { setVendorEdit(null); setVendorKey(""); }}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
      <Err error={err} />
      <p className="small set-foot">Want a different engine for one helper? Set it per helper on <Link href="/staff/">Team</Link>.</p>
    </>
  );
}

function Health() {
  const [h, setH] = useState<Record<string, { ok: boolean; detail?: string }> | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const check = useCallback(async () => { setBusy(true); try { setH(await api("/health/engines")); } catch { /* next time */ } finally { setBusy(false); } }, []);
  useEffect(() => { check(); api<{ id: string; name: string }[]>("/staff").then((l) => setNames(Object.fromEntries(l.map((s) => [s.id, s.name])))).catch(() => {}); }, [check]);
  usePoll(check, 30000, [check]);
  const rows = Object.entries(h || {});
  const bad = rows.filter(([, x]) => !x.ok).length;
  return (
    <>
      <div className="set-card">
        <i className={`ri-pulse-line set-card-ic ${bad ? "bad" : ""}`} />
        <div className="t"><b>{!h ? "Checking…" : bad ? `${bad} helper${bad > 1 ? "s" : ""} can't reach the AI` : "Every helper can reach its AI"}</b>
          <span>Checked every 30 seconds while this page is open.</span></div>
        <button className="btn" disabled={busy} onClick={check}><i className="ri-refresh-line" />{busy ? "Checking…" : "Check now"}</button>
      </div>
      <div className="set-list">
        {rows.map(([id, x]) => (
          <div key={id} className="set-li">
            <Avatar who={{ id, name: names[id] || id } as any} size={22} />
            <b>{names[id] || id}</b>
            <span className="small grow">{x.detail}</span>
            <span className={`chip ${x.ok ? "up" : "down"}`}>{x.ok ? "Working" : "Not working"}</span>
          </div>
        ))}
        {h && rows.length === 0 && <p className="small">No helpers yet.</p>}
      </div>
    </>
  );
}

function Account() {
  const [me, setMe] = useState<{ email: string; name: string } | null>(null);
  const [name, setName] = useState("");
  const [pw, setPw] = useState({ current: "", next: "", again: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<{ email: string; name: string }>("/auth/me").then((m) => { setMe(m); setName(m.name || ""); }).catch((e) => setErr(e.message)); }, []);
  if (!me) return <Err error={err} />;
  const pwOk = pw.next.length >= 10 && pw.next === pw.again && pw.current;
  return (
    <>
      <Row title="Email" desc="You sign in with it. To change it, reset the account from the computer running Omilo."><span className="mono">{me.email}</span></Row>
      <Row title="Your name" desc="Helpers address you by it.">
        <div className="acts nowrap"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Your name" />
          <button className="btn" disabled={!name.trim() || name === me.name} onClick={async () => {
            try { setMe(await api("/auth/me", { method: "PATCH", body: { name: name.trim() } })); setMsg("Name saved."); } catch (e: any) { setErr(e.message); }
          }}>Save</button></div>
      </Row>
      <Row title="Password" desc="At least 10 characters. Other browsers are signed out; this one stays signed in." wide>
        <form className="set-pw" onSubmit={async (e) => {
          e.preventDefault(); setErr(null); setMsg(null);
          try {
            const r = await api<{ signed_out: number }>("/auth/password", { body: { current: pw.current, new: pw.next } });
            setPw({ current: "", next: "", again: "" });
            setMsg(`Password changed.${r.signed_out ? ` ${r.signed_out} other session${r.signed_out > 1 ? "s were" : " was"} signed out.` : ""}`);
          } catch (e: any) { setErr(e.message); }
        }}>
          <input type="password" autoComplete="current-password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          <input type="password" autoComplete="new-password" placeholder="New password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          <input type="password" autoComplete="new-password" placeholder="New password again" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} />
          <div className="acts">
            <button className="btn primary" disabled={!pwOk}>Change password</button>
            {pw.next && pw.next.length < 10 && <span className="small">{10 - pw.next.length} more characters</span>}
            {pw.again && pw.next !== pw.again && <span className="small" style={{ color: "var(--bad)" }}>The two don&apos;t match</span>}
          </div>
        </form>
      </Row>
      {msg && <div className="callout ok">{msg}</div>}
      <Err error={err} />
      <p className="small set-foot">Forgot it? On the computer that runs Omilo: <span className="mono">make reset-password</span></p>

      <div className="set-sub" style={{ marginTop: 20 }}><b>Your Persona</b><span className="soon-tag">Soon</span></div>
      <div className="set-blk-soon">
        <p className="small" style={{ margin: 0, color: "var(--muted)" }}>Turn your experience into staff other teams can hire. About 5 minutes.</p>
      </div>

      <div className="set-sub" style={{ marginTop: 20 }}><b>Danger zone</b></div>
      <div className="set-blk-danger">
        <div className="set-blk-danger-t">
          <b>Delete account</b>
          <span className="small">Removes you from Omilo. The company and its helpers stay with the other owners.</span>
        </div>
        <button className="btn danger" disabled tabIndex={-1} aria-disabled="true">
          <i className="ri-delete-bin-line" />Delete<span className="soon-tag" style={{ marginLeft: 6 }}>Soon</span>
        </button>
      </div>
    </>
  );
}

type Sess = { id: string; kind: string; name: string; current: boolean; created_at: string; last_used_at: string | null; expires_at: string | null };
function Devices() {
  const [list, setList] = useState<Sess[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api<Sess[]>("/auth/sessions").then(setList).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const sessions = (list || []).filter((s) => s.kind === "session"), tokens = (list || []).filter((s) => s.kind === "api");
  return (
    <>
      <div className="set-sub"><b>Browsers</b>
        {sessions.filter((s) => !s.current).length > 0 && <button className="btn sm" onClick={async () => {
          if (!(await confirmDialog({ title: "Sign out everywhere else?", body: "Other browsers and phones have to sign in again.", confirm: "Sign out others" }))) return;
          await api("/auth/sessions/sign-out-others", { body: {} }); load();
        }}>Sign out everywhere else</button>}</div>
      <div className="set-list">
        {sessions.map((s) => (
          <div key={s.id} className="set-li">
            <i className="ri-window-line" /><b>{s.current ? "This browser" : "Browser"}</b>
            <span className="small grow">signed in {ago(s.created_at)} · last used {ago(s.last_used_at)}</span>
            {s.current && <span className="chip up">You are here</span>}
          </div>
        ))}
      </div>
      <div className="set-sub"><b>Access tokens</b><span className="small">For the command line (<span className="mono">omilo login</span>) and scripts.</span></div>
      <div className="set-list">
        {tokens.length === 0 ? <p className="small">None. <span className="mono">omilo login</span> creates one.</p> : tokens.map((t) => (
          <div key={t.id} className="set-li">
            <i className="ri-key-2-line" /><b>{t.name}</b>
            <span className="small grow">created {ago(t.created_at)} · last used {ago(t.last_used_at)}</span>
            <button className="btn sm" onClick={async () => {
              if (!(await confirmDialog({ title: `Revoke “${t.name}”?`, body: "Anything using it stops working.", confirm: "Revoke", danger: true }))) return;
              await api(`/auth/tokens/${t.id}`, { method: "DELETE" }); load();
            }}>Revoke</button>
          </div>
        ))}
      </div>
      <Err error={err} />
    </>
  );
}

type Act = { id: number; at: string; actor: string; who: { kind: string; id?: string; name: string }; action: string; what: string; category: string;
  category_label: string; ref: string; ref_label: string | null; detail: Record<string, unknown> };
type ActPage = { items: Act[]; total: number; page: number; pages: number; per_page: number; categories: { id: string; label: string; icon: string; count_30d: number }[] };
const CAT_ICON: Record<string, string> = { settings: "ri-settings-3-line", security: "ri-shield-keyhole-line", team: "ri-team-line", decisions: "ri-checkbox-circle-line",
  plan: "ri-line-chart-line", capabilities: "ri-plug-line", workflows: "ri-flow-chart", knowledge: "ri-database-2-line", other: "ri-more-line" };

function Activity() {
  const [q, setQ] = useState("");
  const [qq, setQq] = useState("");
  const [cat, setCat] = useState("");
  const [actor, setActor] = useState("");
  const [days, setDays] = useState(0);
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(25);
  const [data, setData] = useState<ActPage | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => { setQq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const params = useMemo(() => new URLSearchParams({ q: qq, category: cat, actor, days: String(days) }).toString(), [qq, cat, actor, days]);
  const load = useCallback(() => api<ActPage>(`/audit?${params}&page=${page}&per_page=${per}`).then(setData).catch((e) => setErr(e.message)), [params, page, per]);
  useEffect(() => { load(); }, [load]);
  const pick = (f: () => void) => { f(); setPage(1); };
  let lastDay = "";
  return (
    <>
      <div className="act-filters">
        <div className="act-search"><i className="ri-search-line" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search actions, names, ids…" aria-label="Search the activity log" /></div>
        <select value={actor} onChange={(e) => pick(() => setActor(e.target.value))} aria-label="Who">
          <option value="">Everyone</option><option value="owner">You</option><option value="helpers">Helpers</option><option value="system">Omilo & workflows</option>
        </select>
        <select value={days} onChange={(e) => pick(() => setDays(Number(e.target.value)))} aria-label="When">
          <option value={0}>All time</option><option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option>
        </select>
        <a className="btn sm" href={`${BASE}/api/audit/export?${params}`} download><i className="ri-download-2-line" />CSV</a>
      </div>
      <div className="act-cats">
        <button className={`kb-kind ${!cat ? "on" : ""}`} onClick={() => pick(() => setCat(""))}>All</button>
        {(data?.categories || []).map((c) => (
          <button key={c.id} className={`kb-kind ${cat === c.id ? "on" : ""}`} onClick={() => pick(() => setCat(cat === c.id ? "" : c.id))} title={`${c.count_30d} in the last 30 days`}>
            <i className={c.icon} />{c.label}{c.count_30d > 0 && <span>{c.count_30d}</span>}</button>
        ))}
      </div>
      <Err error={err} />
      {!data ? <p className="small">Loading…</p> : data.items.length === 0 ? <div className="empty"><b>Nothing found</b><span>Try another filter or search.</span></div> : (
        <div className="act-list">
          {data.items.map((a) => {
            const d = new Date(a.at); const day = fmtDay(d);
            const head = day !== lastDay ? (lastDay = day) : null;
            const det = Object.entries(a.detail || {}).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length));
            return (
              <div key={a.id}>
                {head && <div className="act-day">{head}</div>}
                <button className={`act-row ${open === a.id ? "open" : ""}`} onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
                  <span className="act-time mono">{d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</span>
                  {a.who.kind === "helper" ? <Avatar who={{ id: a.who.id!, name: a.who.name } as any} size={20} />
                    : <span className={`act-ic ${a.who.kind}`}><i className={a.who.kind === "owner" ? "ri-user-fill" : a.who.kind === "system" ? "ri-settings-4-fill" : "ri-question-line"} /></span>}
                  <span className="act-t"><b>{a.who.kind === "owner" ? "You" : a.who.name}</b> {a.what}{a.ref_label && <span className={`act-ref ${a.ref_label === a.ref ? "mono" : ""}`} title={a.ref}>{a.ref_label.length > 48 ? `${a.ref_label.slice(0, 46)}…` : a.ref_label}</span>}</span>
                  <span className="act-cat"><i className={CAT_ICON[a.category] || "ri-more-line"} />{a.category_label}</span>
                  {det.length > 0 && <i className={`ri-arrow-${open === a.id ? "up" : "down"}-s-line act-more`} />}
                </button>
                {open === a.id && (
                  <div className="act-detail">
                    <div><span>When</span><b>{d.toLocaleString()}</b></div>
                    <div><span>Action</span><b className="mono">{a.action}</b></div>
                    {a.ref && <div><span>About</span><b className="mono">{a.ref}</b></div>}
                    {det.map(([k, v]) => <div key={k}><span>{k === "ip" ? "IP address" : k.replace(/_/g, " ")}</span><b className="mono">{typeof v === "string" ? v : JSON.stringify(v)}</b></div>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {data && data.total > 0 && (
        <div className="act-pager">
          <span className="small">{(data.page - 1) * data.per_page + 1}–{Math.min(data.page * data.per_page, data.total)} of {data.total.toLocaleString()}</span>
          <span className="sp" />
          <select value={per} onChange={(e) => pick(() => setPer(Number(e.target.value)))} aria-label="Rows per page">
            {[25, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}
          </select>
          <button className="iconbtn" aria-label="First page" disabled={page <= 1} onClick={() => setPage(1)}><i className="ri-skip-left-line" /></button>
          <button className="iconbtn" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}><i className="ri-arrow-left-s-line" /></button>
          <span className="small">Page {data.page} of {data.pages}</span>
          <button className="iconbtn" aria-label="Next page" disabled={page >= data.pages} onClick={() => setPage(page + 1)}><i className="ri-arrow-right-s-line" /></button>
          <button className="iconbtn" aria-label="Last page" disabled={page >= data.pages} onClick={() => setPage(data.pages)}><i className="ri-skip-right-line" /></button>
        </div>
      )}
    </>
  );
}

function System() {
  const [i, setI] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api("/system/info").then(setI).catch((e) => setErr(e.message)); }, []);
  if (!i) return err ? <Err error={err} /> : <p className="small">Loading…</p>;
  const card = (ok: boolean, icon: string, title: string, lines: React.ReactNode, chip = true) => (
    <div className="set-card"><i className={`${icon} set-card-ic ${ok ? "" : "bad"}`} /><div className="t"><b>{title}</b><span>{lines}</span></div>
      {chip && <span className={`chip ${ok ? "up" : "down"}`}>{ok ? "Connected" : "Not reachable"}</span>}</div>
  );
  return (
    <>
      {card(i.database.ok, "ri-database-2-line", `PostgreSQL ${i.database.version || ""}`,
        i.database.ok ? <>pgvector {i.database.pgvector} · this company {fmtBytes(i.database.company_bytes)} · whole database {fmtBytes(i.database.size_bytes)} · {i.database.host}</> : i.database.error)}
      {card(i.redis.ok, "ri-flashlight-line", `Redis ${i.redis.version || ""}`,
        i.redis.ok ? <>Live updates, locks and queues · {i.redis.memory} in use · {i.redis.host}</> : i.redis.error)}
      {card(true, "ri-folder-3-line", "Files", <>Docs, uploads, skills and keys · {fmtBytes(i.files.size_bytes)} · <span className="mono">{i.files.path}</span></>, false)}
      <Row title="Version" desc="Omilo on this computer."><span className="mono">{i.version}</span></Row>
      <Row title="Companies" desc="Each one is fully separate (its own schema and folder).">
        <span>{i.companies} <span className="small">· add or switch in the company menu, top left</span></span></Row>
      <Row title="Background worker" desc="Runs jobs, schedules, workflows and indexing.">
        <span>{i.embedded_worker ? "Inside the app (laptop mode)" : "Separate process (server mode)"}</span></Row>
      <p className="small set-foot">Backups: back up the Postgres database (<span className="mono">pg_dump</span>) and the folder above. Redis holds nothing you'd miss.</p>
    </>
  );
}

// ------------------------------------------------------------------ email smtp
type SmtpConfig = { host: string; port: number; security: "none" | "tls" | "ssl"; username: string; from_addr: string; has_password: boolean };
type SmtpForm = { host: string; port: string; security: "none" | "tls" | "ssl"; username: string; password: string; from_addr: string };

function EmailSmtp() {
  const [form, setForm] = useState<SmtpForm>({ host: "", port: "587", security: "tls", username: "", password: "", from_addr: "" });
  const [hasPassword, setHasPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testErr, setTestErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api<SmtpConfig>("/settings/smtp").then((d) => {
      setForm({ host: d.host || "", port: String(d.port || 587), security: d.security || "tls", username: d.username || "", password: "", from_addr: d.from_addr || "" });
      setHasPassword(d.has_password);
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const f = (k: keyof SmtpForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((prev) => ({ ...prev, [k]: e.target.value }));

  const save = async () => {
    setSaving(true); setMsg(null); setErr(null);
    try {
      const body: Record<string, unknown> = { host: form.host, port: Number(form.port) || 587, security: form.security, username: form.username, from_addr: form.from_addr };
      if (form.password) body.password = form.password;
      const d = await api<SmtpConfig>("/settings/smtp", { method: "PUT", body });
      setHasPassword(d.has_password);
      setForm((prev) => ({ ...prev, password: "" }));
      setMsg("Saved.");
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };

  const sendTest = async () => {
    setTesting(true); setTestMsg(null); setTestErr(null);
    try {
      await api("/settings/smtp/test", { body: testTo.trim() ? { to: testTo.trim() } : {} });
      setTestMsg("Test email sent successfully.");
    } catch (e: any) {
      setTestErr(e.message);
    } finally { setTesting(false); }
  };

  return (
    <>
      <p className="small" style={{ margin: "0 0 18px", color: "var(--muted)" }}>
        Omilo writes the emails; your own mail server sends them. Until it&apos;s connected, everything stays in the app.
      </p>

      <Row title="Host" desc="The SMTP server hostname, e.g. smtp.yourdomain.com.">
        <input value={form.host} onChange={f("host")} placeholder="smtp.yourdomain.com" autoComplete="off" style={{ width: "100%" }} />
      </Row>

      <Row title="Port" desc="Common: 587 for STARTTLS, 465 for SSL/TLS, 25 for plain.">
        <input value={form.port} onChange={f("port")} inputMode="numeric" placeholder="587" style={{ width: 90 }} />
      </Row>

      <Row title="Security" desc="How the connection to the mail server is encrypted.">
        <select value={form.security} onChange={f("security")} style={{ width: "auto" }}>
          <option value="tls">STARTTLS</option>
          <option value="ssl">SSL / TLS</option>
          <option value="none">None</option>
        </select>
      </Row>

      <Row title="Username" desc="The login name for your SMTP server (usually an email address).">
        <input value={form.username} onChange={f("username")} placeholder="you@yourdomain.com" autoComplete="username" style={{ width: "100%" }} />
      </Row>

      <Row title="Password" desc={hasPassword ? "A password is saved. Enter a new one to replace it, or leave blank to keep the current one." : "SMTP password for the account above."}>
        <input
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={f("password")}
          placeholder={hasPassword ? "Leave blank to keep saved password" : "Password"}
          style={{ width: "100%" }}
        />
        {hasPassword && !form.password && <span className="set-ok"><i className="ri-lock-line" />Password saved</span>}
      </Row>

      <Row title="From address" desc="The email address that appears in the From field of sent emails.">
        <input value={form.from_addr} onChange={f("from_addr")} placeholder="omilo@yourdomain.com" autoComplete="off" style={{ width: "100%" }} />
      </Row>

      <div className="acts" style={{ marginTop: 4, marginBottom: 4 }}>
        <button className="btn primary" disabled={saving || !form.host.trim() || !form.from_addr.trim()} onClick={save}>{saving ? "Saving…" : "Save"}</button>
        {msg && <span className="set-ok"><i className="ri-check-line" />{msg}</span>}
      </div>
      {err && <div className="callout" style={{ borderColor: "var(--bad-line)", background: "var(--bad-tint)", marginTop: 8 }}>{err}</div>}

      <div className="set-sub" style={{ marginTop: 20 }}>
        <i className="ri-mail-check-line" /><b>Send a test email</b>
      </div>
      <p className="small" style={{ margin: "0 0 10px" }}>Send a test to confirm the connection and credentials are working.</p>
      <div className="acts">
        <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Recipient (optional — defaults to your account email)" style={{ flex: 1, minWidth: 0 }} />
        <button className="btn" disabled={testing} onClick={sendTest}>{testing ? "Sending…" : "Send test"}</button>
      </div>
      {testMsg && <div className="callout ok" style={{ marginTop: 8 }}><i className="ri-check-line" /> {testMsg}</div>}
      {testErr && <div className="callout" style={{ borderColor: "var(--bad-line)", background: "var(--bad-tint)", marginTop: 8 }}>{testErr}</div>}
    </>
  );
}

// ------------------------------------------------------------------ page
function SettingsInner() {
  const { overview, refresh } = useOverview();
  const params = useSearchParams();
  const router = useRouter();
  const s = ALL.find((x) => x.id === params.get("s")) ? params.get("s")! : "general";
  const [find, setFind] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const cur = ALL.find((x) => x.id === s)!;
  const go = (id: string) => router.push(`/settings/?s=${id}`);
  const set = useCallback(async (body: Record<string, unknown>) => {
    setErr(null);
    try { await api("/system", { body }); refresh(); return true; } catch (e: any) { setErr(e.message); return false; }
  }, [refresh]);
  useEffect(() => { document.querySelector(".set-link.on")?.scrollIntoView({ block: "nearest", inline: "center" }); }, [s]);
  const f = find.trim().toLowerCase();
  const match = (it: Item) => !f || `${it.label} ${it.words} ${it.desc}`.toLowerCase().includes(f);
  if (!overview) return null;
  return (
    <div className="set">
      <nav className="set-nav" aria-label="Settings sections">
        <div className="set-find"><i className="ri-search-line" /><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a setting" aria-label="Find a setting"
          onKeyDown={(e) => { if (e.key === "Enter") { const first = ALL.find(match); if (first) go(first.id); } }} /></div>
        {GROUPS.map((g) => {
          const items = g.items.filter(match);
          if (!items.length) return null;
          return (
            <div key={g.label} className="set-grp">
              <p>{g.label}</p>
              {items.map((it) => (
                <button key={it.id} className={`set-link ${s === it.id ? "on" : ""}`} onClick={() => go(it.id)} aria-current={s === it.id ? "page" : undefined}>
                  <i className={it.icon} />{it.label}
                  {it.id === "safety" && overview.paused && <span className="chip warn">Paused</span>}
                </button>
              ))}
            </div>
          );
        })}
        {f && !ALL.some(match) && <p className="small" style={{ padding: "4px 10px" }}>No setting matches.</p>}
        <div className="set-grp">
          <p>Elsewhere</p>
          {ELSEWHERE.map(([href, l, ic]) => <Link key={href} className="set-link" href={href}><i className={ic} />{l}<i className="ri-arrow-right-up-line set-ext" /></Link>)}
        </div>
      </nav>
      <section className="set-main" aria-labelledby="set-title">
        <div className="set-body">
          <div className="set-head">
            <h1 id="set-title"><i className={cur.icon} />{cur.label}</h1>
            <p>{cur.desc}</p>
          </div>
          <Err error={err} />
          {s === "general" && <General set={set} />}
          {s === "safety" && <Safety set={set} />}
          {s === "email" && <EmailSmtp />}
          {s === "ai" && <AiEngine />}
          {s === "health" && <Health />}
          {s === "knowledge" && <><KnowledgeSettings /><p className="small set-foot">See what helpers know, and how they search it, in <Link href="/docs/?kb=1">Docs → Knowledge</Link>.</p></>}
          {s === "account" && <Account />}
          {s === "devices" && <Devices />}
          {s === "notifications" && <NotifySettings embedded />}
          {s === "activity" && <Activity />}
          {s === "system" && <System />}
        </div>
      </section>
    </div>
  );
}

export default function Settings() {
  return <Suspense><SettingsInner /></Suspense>;
}
