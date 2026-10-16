"use client";
import { useCallback, useEffect, useState } from "react";
import Drawer from "@/components/Drawer";
import { Err } from "@/components/ui";
import { api } from "@/lib/api";

/* Connectors: MCP servers (apps and services) your helpers can use, like Claude's connectors.
   Adding and editing happen in a drawer on the right, starting from a ready-made template. */

type Conn = { id: string; label: string; kind: "http" | "stdio"; url: string; command: string; args: string[]; approval: "auto" | "ask";
  default_on: boolean; enabled: boolean; header_names: string[]; env_names: string[] };
type Pair = { k: string; v: string };
type Form = { id: string; label: string; kind: "http" | "stdio"; url: string; command: string; args: string; approval: "auto" | "ask";
  default_on: boolean; enabled: boolean; secrets: Pair[]; editing: boolean; tpl: string };
type Test = { ok: boolean | null; detail: string; tools?: string[] };
type Tpl = { key: string; name: string; icon: string; blurb: string; form: Partial<Form>; help?: string };

const TEMPLATES: Tpl[] = [
  { key: "github", name: "GitHub", icon: "ri-github-line", blurb: "Issues, pull requests, code", help: "Create a personal access token on GitHub (Settings → Developer settings) and paste it after “Bearer ”.",
    form: { label: "GitHub", kind: "http", url: "https://api.githubcopilot.com/mcp/", approval: "ask", secrets: [{ k: "Authorization", v: "Bearer " }] } },
  { key: "playwright", name: "Browser (Playwright)", icon: "ri-global-line", blurb: "Open and use websites", help: "Needs Node.js on this computer. The first run downloads the browser.",
    form: { label: "Browser", kind: "stdio", command: "npx", args: "-y @playwright/mcp@latest", approval: "ask" } },
  { key: "context7", name: "Library docs (Context7)", icon: "ri-book-open-line", blurb: "Up-to-date docs for code libraries", help: "Read-only, so it can be used directly. Needs Node.js.",
    form: { label: "Library docs", kind: "stdio", command: "npx", args: "-y @upstash/context7-mcp", approval: "auto" } },
  { key: "postgres", name: "Postgres database", icon: "ri-database-2-line", blurb: "Read your database", help: "Replace the address with your database's (a read-only user is safest). Needs Node.js.",
    form: { label: "Database", kind: "stdio", command: "npx", args: "-y @modelcontextprotocol/server-postgres postgresql://readonly:password@localhost:5432/app", approval: "ask" } },
  { key: "web", name: "Any web address", icon: "ri-links-line", blurb: "An MCP server URL from its maker", form: { kind: "http" } },
  { key: "program", name: "Any program", icon: "ri-terminal-box-line", blurb: "An MCP server you run here", form: { kind: "stdio" } },
];

const blank: Form = { id: "", label: "", kind: "http", url: "", command: "", args: "", approval: "ask", default_on: true, enabled: true,
  secrets: [{ k: "", v: "" }], editing: false, tpl: "" };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const withBlankRow = (p: Pair[]) => (p.length && !p[p.length - 1].k && !p[p.length - 1].v ? p : [...p, { k: "", v: "" }]);

export default function Connectors() {
  const [list, setList] = useState<Conn[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [tests, setTests] = useState<Record<string, Test>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => { try { setList(await api<Conn[]>("/connectors")); } catch (e: any) { setErr(e.message); } }, []);
  useEffect(() => { load(); }, [load]);
  const close = useCallback(() => { setForm(null); setErr(null); }, []);

  const startNew = () => { setErr(null); setForm({ ...blank }); };
  const pick = (t: Tpl) => setForm((f) => ({ ...blank, ...t.form, tpl: t.key, secrets: withBlankRow(t.form.secrets || []), id: slug(t.form.label || ""), label: t.form.label || "", editing: f?.editing || false }));
  const edit = (c: Conn) => { setErr(null); setForm({ id: c.id, label: c.label, kind: c.kind, url: c.url, command: c.command, args: c.args.join(" "), approval: c.approval,
    default_on: c.default_on, enabled: c.enabled, editing: true, tpl: "edit",
    secrets: withBlankRow((c.kind === "http" ? c.header_names : c.env_names).map((k) => ({ k, v: "" }))) }); };

  const save = async () => {
    if (!form) return;
    setErr(null); setBusy(true);
    const pairs = form.secrets.filter((p) => p.k.trim());
    // when editing, an empty value keeps the saved secret: only send the map if something new was typed
    const secrets = form.editing && !pairs.some((p) => p.v) ? undefined : Object.fromEntries(pairs.map((p) => [p.k.trim(), p.v]));
    const body = { id: form.id || slug(form.label), label: form.label, kind: form.kind, url: form.url.trim(), command: form.command.trim(),
      args: form.args.trim() ? form.args.trim().split(/\s+/) : [], approval: form.approval, default_on: form.default_on, enabled: form.enabled,
      ...(form.kind === "http" ? { headers: secrets } : { env: secrets }) };
    try {
      const c = await api<Conn>(form.editing ? `/connectors/${form.id}` : "/connectors", { method: form.editing ? "PUT" : "POST", body });
      setForm(null); await load(); test(c.id);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: { ok: null, detail: "Testing…" } }));
    try { const r = await api<Test>(`/connectors/${id}/test`, { body: {} }); setTests((t) => ({ ...t, [id]: r })); }
    catch (e: any) { setTests((t) => ({ ...t, [id]: { ok: false, detail: e.message } })); }
  };
  const remove = async (id: string, label: string) => {
    if (!confirm(`Remove ${label}? Helpers lose access to it.`)) return;
    await api(`/connectors/${id}`, { method: "DELETE" }); setForm(null); load();
  };
  const toggle = async (c: Conn) => { await api(`/connectors/${c.id}`, { method: "PUT", body: { ...c, enabled: !c.enabled } }); load(); };
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const tpl = TEMPLATES.find((t) => t.key === form?.tpl);
  const ready = !!form && !!form.label.trim() && (form.kind === "http" ? /^https?:\/\//.test(form.url.trim()) : !!form.command.trim());

  return (
    <div>
      <div className="sechead" style={{ alignItems: "flex-start" }}>
        <div><h1>Connectors</h1>
          <p className="sub" style={{ marginBottom: 0 }}>Apps and services your helpers can use: GitHub, a browser, your database, anything with an MCP server. Switch them on per chat with the + button.</p></div>
        <span className="sp" />
        <button className="btn primary" onClick={startNew}><i className="ri-add-line" />Add connector</button>
      </div>

      <div className="sec" style={{ marginTop: 20 }}>
        {list === null ? <p className="small">Loading…</p> : list.length === 0 ? (
          <div className="empty"><b>No connectors yet</b><span>Start from GitHub, a browser or your database, or add any MCP server.</span>
            <div style={{ marginTop: 12 }}><button className="btn primary" onClick={startNew}><i className="ri-add-line" />Add connector</button></div></div>
        ) : (
          <div className="grid2">
            {list.map((c) => {
              const t = tests[c.id];
              return (
                <div key={c.id} className="card" role="button" tabIndex={0} style={{ cursor: "pointer" }} onClick={() => edit(c)} onKeyDown={(e) => { if (e.key === "Enter") edit(c); }}>
                  <div className="acts" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                    <b style={{ fontWeight: 500 }}><i className="ri-plug-line" /> {c.label}</b>
                    <span className={`chip ${!c.enabled ? "idle" : t?.ok === false ? "down" : "up"}`}>{!c.enabled ? "Off" : t?.ok === false ? "Not reachable" : "On"}</span>
                  </div>
                  <div className="small mono" style={{ wordBreak: "break-all" }}>{c.kind === "http" ? c.url : `${c.command} ${c.args.join(" ")}`}</div>
                  <div className="small">{c.approval === "auto" ? "Uses its tools directly" : "Asks you first"} · {c.default_on ? "on in every chat" : "off until switched on"}</div>
                  {t && t.ok !== false && <div className={`small ${t.ok ? "up" : ""}`}>{t.detail}</div>}
                  <div className="acts" style={{ marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn sm" onClick={() => test(c.id)}>Test</button>
                    <button className="btn sm" onClick={() => toggle(c)}>{c.enabled ? "Turn off" : "Turn on"}</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {!form && <Err error={err} />}

      <Drawer open={!!form} onClose={close} icon={<i className={tpl?.icon || "ri-plug-line"} />}
        title={form?.editing ? form.label || "Connector" : form?.tpl ? `Add ${tpl?.name || "connector"}` : "Add a connector"}
        sub={form?.editing ? (form.kind === "http" ? "Web address" : "Program on this computer") : form?.tpl ? tpl?.blurb : "Start from a template, or add any MCP server."}
        footer={form && (form.tpl ? (
          <>
            {form.editing ? <button className="btn quiet" onClick={() => remove(form.id, form.label)}><i className="ri-delete-bin-line" />Remove</button>
              : <button className="btn quiet" onClick={() => setForm({ ...blank })}><i className="ri-arrow-left-line" />Templates</button>}
            <span className="sp" />
            <button className="btn" onClick={close}>Cancel</button>
            <button className="btn primary" disabled={!ready || busy} onClick={save}>{busy ? "Saving…" : form.editing ? "Save changes" : "Add and test"}</button>
          </>
        ) : <><span className="sp" /><button className="btn" onClick={close}>Cancel</button></>)}>
        {form && !form.tpl && (
          <div className="dw-sec">
            <h3>Start from</h3>
            <div className="tpl-grid">
              {TEMPLATES.map((t) => (
                <button key={t.key} type="button" className="tpl" onClick={() => pick(t)}>
                  <i className={t.icon} /><span style={{ display: "flex", flexDirection: "column" }}><b>{t.name}</b><span>{t.blurb}</span></span>
                </button>
              ))}
            </div>
          </div>
        )}
        {form && form.tpl && (
          <>
            {tpl?.help && <div className="callout" style={{ marginTop: 16 }}>{tpl.help}</div>}
            <div className="dw-sec">
              <label style={{ marginTop: 0 }}>Name</label>
              <input value={form.label} onChange={(e) => set({ label: e.target.value, ...(form.editing ? {} : { id: slug(e.target.value) }) })} placeholder="e.g. GitHub" />
              {!form.editing && (form.tpl === "web" || form.tpl === "program") && (
                <>
                  <label>How it connects</label>
                  <div className="opt2">
                    <button type="button" className={form.kind === "http" ? "on" : ""} onClick={() => set({ kind: "http" })}><b><i className="ri-links-line" />Web address</b><span>The maker gives you a URL</span></button>
                    <button type="button" className={form.kind === "stdio" ? "on" : ""} onClick={() => set({ kind: "stdio" })}><b><i className="ri-terminal-box-line" />Program</b><span>Runs on this computer</span></button>
                  </div>
                </>
              )}
              {form.kind === "http" ? (
                <><label>Address</label><input value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://example.com/mcp" inputMode="url" /></>
              ) : (
                <>
                  <label>Command</label><input className="mono" value={form.command} onChange={(e) => set({ command: e.target.value })} placeholder="npx" />
                  <label>Arguments</label><input className="mono" value={form.args} onChange={(e) => set({ args: e.target.value })} placeholder="-y @scope/some-mcp-server" />
                </>
              )}
            </div>

            <div className="dw-sec">
              <h3>{form.kind === "http" ? "Secret headers" : "Secret settings"}</h3>
              <p className="dw-help" style={{ marginTop: 0, marginBottom: 8 }}>{form.kind === "http" ? "Usually an Authorization header with a token." : "Environment variables such as API keys."} Stored encrypted; only the helpers' AI engine receives them.</p>
              {form.secrets.map((p, i) => (
                <div key={i} className="kv">
                  <input value={p.k} placeholder={form.kind === "http" ? "Authorization" : "API_TOKEN"} aria-label="Name"
                    onChange={(e) => set({ secrets: withBlankRow(form.secrets.map((x, j) => (j === i ? { ...x, k: e.target.value } : x))) })} />
                  <input type="password" autoComplete="off" value={p.v} aria-label="Value" placeholder={form.editing && p.k ? "saved (type to replace)" : "value"}
                    onChange={(e) => set({ secrets: withBlankRow(form.secrets.map((x, j) => (j === i ? { ...x, v: e.target.value } : x))) })} />
                  {(p.k || p.v) ? <button className="iconbtn" aria-label="Remove" onClick={() => set({ secrets: withBlankRow(form.secrets.filter((_, j) => j !== i)) })}><i className="ri-close-line" /></button> : <span />}
                </div>
              ))}
            </div>

            <div className="dw-sec">
              <h3>Before using its tools</h3>
              <div className="opt2" style={{ marginTop: 8 }}>
                <button type="button" className={form.approval === "ask" ? "on" : ""} onClick={() => set({ approval: "ask" })}><b><i className="ri-shield-check-line" />Ask me first</b><span>Helpers request it in the Inbox</span></button>
                <button type="button" className={form.approval === "auto" ? "on" : ""} onClick={() => set({ approval: "auto" })}><b><i className="ri-flashlight-line" />Use directly</b><span>For read-only, low-risk tools</span></button>
              </div>
              <div className="togrow" style={{ marginTop: 8 }} onClick={() => set({ default_on: !form.default_on })}>
                <span className="t"><b>On in every chat and job</b><span>Otherwise switch it on per chat with +</span></span>
                <span className={`switch ${form.default_on ? "on" : ""}`} role="switch" aria-checked={form.default_on}><i /></span>
              </div>
              {form.editing && (
                <div className="togrow" onClick={() => set({ enabled: !form.enabled })}>
                  <span className="t"><b>Connector is on</b><span>Turn off to stop every helper from using it</span></span>
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
                    {!!tests[form.id].tools?.length && <div className="small" style={{ marginTop: 6 }}>{tests[form.id].tools!.join(", ")}</div>}
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
