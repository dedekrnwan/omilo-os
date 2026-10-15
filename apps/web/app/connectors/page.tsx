"use client";
import { useCallback, useEffect, useState } from "react";
import { Err } from "@/components/ui";
import { api } from "@/lib/api";

/* Connectors: MCP servers (apps and services) your helpers can use, like Claude's connectors. */

type Conn = { id: string; label: string; kind: "http" | "stdio"; url: string; command: string; args: string[]; approval: "auto" | "ask";
  default_on: boolean; enabled: boolean; header_names: string[]; env_names: string[] };
type Pair = { k: string; v: string };
type Form = { id: string; label: string; kind: "http" | "stdio"; url: string; command: string; args: string; approval: "auto" | "ask";
  default_on: boolean; enabled: boolean; secrets: Pair[]; editing: boolean };

const blank: Form = { id: "", label: "", kind: "http", url: "", command: "", args: "", approval: "ask", default_on: true, enabled: true, secrets: [{ k: "", v: "" }], editing: false };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export default function Connectors() {
  const [list, setList] = useState<Conn[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean | null; detail: string; tools?: string[] }>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => { try { setList(await api<Conn[]>("/connectors")); } catch (e: any) { setErr(e.message); } }, []);
  useEffect(() => { load(); }, [load]);

  const edit = (c: Conn) => setForm({ id: c.id, label: c.label, kind: c.kind, url: c.url, command: c.command, args: c.args.join(" "), approval: c.approval,
    default_on: c.default_on, enabled: c.enabled, editing: true,
    secrets: [...(c.kind === "http" ? c.header_names : c.env_names).map((k) => ({ k, v: "" })), { k: "", v: "" }] });

  const save = async () => {
    if (!form) return;
    setErr(null);
    const pairs = form.secrets.filter((p) => p.k.trim());
    // when editing, an empty value keeps the saved secret: only send the map if something new was typed
    const secrets = form.editing && !pairs.some((p) => p.v) ? undefined : Object.fromEntries(pairs.map((p) => [p.k.trim(), p.v]));
    const body = { id: form.id || slug(form.label), label: form.label, kind: form.kind, url: form.url.trim(), command: form.command.trim(),
      args: form.args.trim() ? form.args.trim().split(/\s+/) : [], approval: form.approval, default_on: form.default_on, enabled: form.enabled,
      ...(form.kind === "http" ? { headers: secrets } : { env: secrets }) };
    try {
      await api(form.editing ? `/connectors/${form.id}` : "/connectors", { method: form.editing ? "PUT" : "POST", body });
      setForm(null); load();
    } catch (e: any) { setErr(e.message); }
  };
  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: { ok: null, detail: "Testing…" } }));
    try { const r = await api<{ ok: boolean | null; detail: string; tools?: string[] }>(`/connectors/${id}/test`, { body: {} }); setTests((t) => ({ ...t, [id]: r })); }
    catch (e: any) { setTests((t) => ({ ...t, [id]: { ok: false, detail: e.message } })); }
  };
  const remove = async (c: Conn) => { if (!confirm(`Remove ${c.label}?`)) return; await api(`/connectors/${c.id}`, { method: "DELETE" }); load(); };
  const toggle = async (c: Conn) => { await api(`/connectors/${c.id}`, { method: "PUT", body: { ...c, enabled: !c.enabled } }); load(); };

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <div>
      <h1>Connectors</h1>
      <p className="sub">Apps and services your helpers can use: GitHub, Notion, Linear, your database, anything with an MCP server. Turn them on per chat with the + button in the Workspace.</p>

      <div className="sec">
        <div className="sechead"><h2>Your connectors</h2><span className="sp" />
          {!form && <button className="btn primary" onClick={() => setForm({ ...blank })}><i className="ri-add-line" />Add connector</button>}</div>
        {list === null ? <p className="small">Loading…</p> : list.length === 0 && !form ? (
          <div className="empty"><b>No connectors yet</b><span>Add one with the address (or command) its maker gives you.</span></div>
        ) : (
          <div className="grid2">
            {list.map((c) => {
              const t = tests[c.id];
              return (
                <div key={c.id} className="card">
                  <div className="acts" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                    <b style={{ fontWeight: 500 }}><i className="ri-plug-line" /> {c.label}</b>
                    <span className={`chip ${c.enabled ? "up" : "idle"}`}>{c.enabled ? "On" : "Off"}</span>
                  </div>
                  <div className="small mono" style={{ wordBreak: "break-all" }}>{c.kind === "http" ? c.url : `${c.command} ${c.args.join(" ")}`}</div>
                  <div className="small">
                    {c.approval === "auto" ? "Uses its tools directly" : "Asks you before using its tools"} · {c.default_on ? "on for every chat" : "off until you turn it on in a chat"}
                    {(c.header_names.length + c.env_names.length) > 0 && ` · ${c.header_names.length + c.env_names.length} secret${c.header_names.length + c.env_names.length > 1 ? "s" : ""} saved`}
                  </div>
                  {t && <div className={`small ${t.ok ? "up" : t.ok === false ? "down" : ""}`}>{t.detail}{t.tools?.length ? `: ${t.tools.slice(0, 8).join(", ")}${t.tools.length > 8 ? "…" : ""}` : ""}</div>}
                  <div className="acts" style={{ marginTop: 4 }}>
                    <button className="btn sm" onClick={() => test(c.id)}>Test</button>
                    <button className="btn sm" onClick={() => edit(c)}>Edit</button>
                    <button className="btn sm" onClick={() => toggle(c)}>{c.enabled ? "Turn off" : "Turn on"}</button>
                    <span className="sp" />
                    <button className="iconbtn" aria-label={`Remove ${c.label}`} onClick={() => remove(c)}><i className="ri-delete-bin-line" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {form && (
        <div className="paper" style={{ marginTop: 20 }}>
          <h2 style={{ marginTop: 0 }}>{form.editing ? `Edit ${form.label}` : "Add a connector"}</h2>
          <div className="grid2">
            <div><label>Name</label><input value={form.label} onChange={(e) => set({ label: e.target.value, ...(form.editing ? {} : { id: slug(e.target.value) }) })} placeholder="e.g. GitHub" /></div>
            <div><label>How it connects</label>
              <div className="seg"><button type="button" className={form.kind === "http" ? "on" : ""} onClick={() => set({ kind: "http" })}>Web address</button>
                <button type="button" className={form.kind === "stdio" ? "on" : ""} onClick={() => set({ kind: "stdio" })}>Program on this computer</button></div></div>
          </div>
          {form.kind === "http" ? (
            <><label>Address</label><input value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://api.githubcopilot.com/mcp/" /></>
          ) : (
            <div className="grid2">
              <div><label>Command</label><input value={form.command} onChange={(e) => set({ command: e.target.value })} placeholder="npx" /></div>
              <div><label>Arguments</label><input value={form.args} onChange={(e) => set({ args: e.target.value })} placeholder="-y @modelcontextprotocol/server-postgres postgres://…" /></div>
            </div>
          )}
          <label>{form.kind === "http" ? "Secret headers (for example Authorization)" : "Secret settings (environment variables)"}</label>
          {form.secrets.map((p, i) => (
            <div key={i} className="acts" style={{ flexWrap: "nowrap", marginBottom: 6 }}>
              <input style={{ flex: 1 }} value={p.k} placeholder={form.kind === "http" ? "Authorization" : "API_TOKEN"}
                onChange={(e) => set({ secrets: form.secrets.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)).concat(i === form.secrets.length - 1 && e.target.value ? [{ k: "", v: "" }] : []) })} />
              <input style={{ flex: 2 }} type="password" autoComplete="off" value={p.v} placeholder={form.editing && p.k ? "saved (type to replace)" : "Bearer …"}
                onChange={(e) => set({ secrets: form.secrets.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)) })} />
            </div>
          ))}
          <p className="small" style={{ margin: "2px 0 0" }}>Stored encrypted. Only the helpers' AI engine receives them.</p>
          <label>Before using its tools</label>
          <div className="seg"><button type="button" className={form.approval === "ask" ? "on" : ""} onClick={() => set({ approval: "ask" })}>Ask me first</button>
            <button type="button" className={form.approval === "auto" ? "on" : ""} onClick={() => set({ approval: "auto" })}>Use directly</button></div>
          <p className="small" style={{ margin: "6px 0 0" }}>{form.approval === "ask" ? "Helpers send you a request in the Inbox and use the connector after you approve." : "Pick this for read-only or low-risk tools."}</p>
          <label className="check"><input type="checkbox" checked={form.default_on} onChange={(e) => set({ default_on: e.target.checked })} />On for every chat and job (you can still switch it off per chat)</label>
          <div className="acts" style={{ marginTop: 16 }}>
            <button className="btn primary" disabled={!form.label.trim() || (form.kind === "http" ? !form.url.trim() : !form.command.trim())} onClick={save}>{form.editing ? "Save" : "Add connector"}</button>
            <button className="btn quiet" onClick={() => { setForm(null); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}
      <Err error={err} />
    </div>
  );
}
