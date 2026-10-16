"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Drawer from "@/components/Drawer";
import { Err } from "@/components/ui";
import { BASE, Overview, api } from "@/lib/api";
import { MenuItem, menu, sep } from "@/lib/menu";
import { confirmDialog } from "@/lib/dialog";

/* The company picker at the top of the sidebar. Every company is fully separate (its own helpers, jobs, inbox,
   docs and pool); only your login is shared. Switching reloads the app on the other company, in every open tab. */

export type Co = { id: string; name: string; onboarded: boolean; inbox: number; running: number; archived: boolean; created_at?: string | null };

const TINTS = ["#6366f1", "#14b8a6", "#f97316", "#ec4899", "#8b5cf6", "#0ea5e9", "#65a30d", "#f59e0b"];
const tint = (id: string) => TINTS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TINTS.length];

export function CoBadge({ co, size = 22 }: { co: { id: string; name: string }; size?: number }) {
  const letters = co.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  return <span className="co-av" style={{ width: size, height: size, background: tint(co.id), fontSize: size * 0.42 }} aria-hidden>{letters}</span>;
}

let chan: BroadcastChannel | null = null;
const channel = () => { try { return (chan ||= new BroadcastChannel("saga-company")); } catch { return null; } };

/** Go to another company: remembered by the server (cookie), every open tab follows. */
export async function switchTo(id: string, to = "/") {
  await api("/companies/switch", { body: { id } });
  channel()?.postMessage({ id });
  location.href = `${BASE}${to}`;
}

export default function CompanySwitcher({ overview }: { overview: Overview | null }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Co[] | null>(null);
  const [current, setCurrent] = useState<string>("main");
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try { const r = await api<{ current: string; companies: Co[] }>(`/companies${managing ? "?archived=true" : ""}`); setList(r.companies); setCurrent(r.current); } catch { /* signed out */ }
  }, [managing]);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => { // a link that names its company (?co=…, e.g. from a notification of another company)
    if (!list) return;
    const q = new URLSearchParams(location.search);
    const want = q.get("co");
    if (!want) return;
    q.delete("co");
    const rest = location.pathname.slice(BASE.length) + (q.toString() ? `?${q}` : "") + location.hash;
    if (want !== current && list.some((c) => c.id === want && !c.archived)) switchTo(want, rest);
    else history.replaceState(null, "", BASE + rest);
  }, [list, current]);
  useEffect(() => { // another tab switched company: follow it
    const c = channel();
    if (!c) return;
    const on = (e: MessageEvent) => { if (e.data?.id && e.data.id !== current) location.reload(); };
    c.addEventListener("message", on);
    return () => c.removeEventListener("message", on);
  }, [current]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", close); window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", esc); };
  }, [open]);

  const me = list?.find((c) => c.id === current);
  const label = overview?.company_name || me?.name || "Your company";
  const others = (list || []).filter((c) => c.id !== current && !c.archived);
  const waiting = others.reduce((n, c) => n + c.inbox, 0);

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const co = await api<Co>("/companies", { body: { name: name.trim() } });
      channel()?.postMessage({ id: co.id });
      location.href = `${BASE}/onboarding/`;
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  const patch = async (id: string, body: Record<string, unknown>) => {
    try { await api(`/companies/${id}`, { method: "PATCH", body }); await load(); if (body.archived && id === current) location.href = `${BASE}/`; }
    catch (e: any) { setErr(e.message); }
  };
  const rowMenu = (c: Co): MenuItem[] => [
    { heading: c.name },
    c.id !== current && { label: "Switch to it", icon: "ri-arrow-left-right-line", onSelect: () => switchTo(c.id) },
    c.id !== current && c.inbox > 0 && { label: "Open its inbox", icon: "ri-inbox-line", hint: `${c.inbox} waiting`, onSelect: () => switchTo(c.id, "/") },
    { label: "Rename or archive…", icon: "ri-settings-3-line", onSelect: () => { setOpen(false); setManaging(true); } },
    sep,
    { label: "New company…", icon: "ri-add-line", onSelect: () => { setOpen(false); setName(""); setAdding(true); } },
  ].filter(Boolean) as MenuItem[];

  return (
    <div className="cosw" ref={box}>
      <button type="button" className={`company cosw-btn ${open ? "on" : ""}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
        onContextMenu={menu(() => (me ? rowMenu(me) : []))} title="Switch company">
        <CoBadge co={{ id: current, name: label }} />
        <span className="grow">{label}</span>
        {overview && (overview.paused
          ? <span className="chip warn">Paused</span>
          : <span className="chip up">{overview.tasks.running ? `${overview.tasks.running} working` : "Live"}</span>)}
        {waiting > 0 && <span className="cosw-dot" title={`${waiting} waiting in your other companies`} />}
        <i className="ri-expand-up-down-line cosw-chev" />
      </button>
      {open && (
        <div className="cosw-pop" role="menu">
          <div className="cosw-h">Your companies</div>
          {(list || []).filter((c) => !c.archived).map((c) => (
            <button key={c.id} type="button" role="menuitemradio" aria-checked={c.id === current} className={`cosw-i ${c.id === current ? "on" : ""}`}
              onClick={() => (c.id === current ? setOpen(false) : switchTo(c.id))} onContextMenu={menu(() => rowMenu(c))}>
              <CoBadge co={c} size={26} />
              <span className="t"><b>{c.id === current ? label : c.name}</b>
                <span className="small">{!c.onboarded ? "Setting up" : c.running ? `${c.running} working` : "Quiet"}{c.inbox ? ` · ${c.inbox} waiting` : ""}</span></span>
              {c.id === current ? <i className="ri-check-line" /> : c.inbox ? <span className="count">{c.inbox}</span> : null}
            </button>
          ))}
          <div className="cosw-sep" />
          <button type="button" className="cosw-i act" onClick={() => { setOpen(false); setName(""); setErr(null); setAdding(true); }}><i className="ri-add-line" />New company</button>
          <button type="button" className="cosw-i act" onClick={() => { setOpen(false); setErr(null); setManaging(true); }}><i className="ri-settings-3-line" />Manage companies</button>
        </div>
      )}

      <Drawer open={adding} onClose={() => setAdding(false)} icon={<i className="ri-building-line" />} title="New company"
        sub="A separate company with its own helpers, jobs, inbox, docs and Claude Code pool. Your login stays the same."
        footer={<><span className="sp" /><button className="btn" onClick={() => setAdding(false)}>Cancel</button>
          <button className="btn primary" disabled={!name.trim() || busy} onClick={create}>{busy ? "Creating…" : "Create and set it up"}</button></>}>
        <div className="dw-sec">
          <label style={{ marginTop: 0 }}>Company name</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Warung Kopi Bandung" maxLength={80}
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) create(); }} />
          <p className="dw-help">Next you set it up like the first one: what it does, and which helpers it hires. Nothing is shared with your other companies, so connect its AI, tools and folders on its own pages.</p>
        </div>
        <Err error={err} />
      </Drawer>

      <Drawer open={managing} onClose={() => { setManaging(false); setErr(null); }} icon={<i className="ri-building-line" />} title="Companies"
        sub="Rename a company, or archive one you no longer run. Archiving pauses its helpers and hides it; nothing is deleted."
        footer={<><button className="btn quiet" onClick={() => { setManaging(false); setName(""); setAdding(true); }}><i className="ri-add-line" />New company</button><span className="sp" />
          <button className="btn" onClick={() => setManaging(false)}>Done</button></>}>
        {managing && <ManageList list={list} current={current} onPatch={patch} onSwitch={(id) => switchTo(id)} />}
        <Err error={err} />
      </Drawer>
    </div>
  );
}

function ManageList({ list, current, onPatch, onSwitch }: { list: Co[] | null; current: string; onPatch: (id: string, b: Record<string, unknown>) => void; onSwitch: (id: string) => void }) {
  const [names, setNames] = useState<Record<string, string>>({});
  if (!list) return <p className="small">Loading…</p>;
  const active = list.filter((c) => !c.archived), archived = list.filter((c) => c.archived);
  const row = (c: Co) => {
    const v = names[c.id] ?? c.name;
    return (
      <div key={c.id} className="co-row">
        <CoBadge co={{ id: c.id, name: v || c.name }} size={30} />
        <input value={v} aria-label={`Name of ${c.name}`} onChange={(e) => setNames({ ...names, [c.id]: e.target.value })}
          onBlur={() => { if (v.trim() && v.trim() !== c.name) onPatch(c.id, { name: v.trim() }); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        {c.archived ? <button className="btn sm" onClick={() => onPatch(c.id, { archived: false })}>Bring back</button>
          : c.id === current ? <span className="chip up">Open now</span>
          : <button className="btn sm" onClick={() => onSwitch(c.id)}>Switch</button>}
        {!c.archived && c.id !== "main" && (
          <button className="iconbtn" aria-label={`Archive ${c.name}`} title="Archive" onClick={async () => { if (await confirmDialog({ title: `Archive ${c.name}?`, body: "Its helpers pause and it leaves the list. You can bring it back here.", confirm: "Archive", mood: "worried" })) onPatch(c.id, { archived: true }); }}>
            <i className="ri-archive-line" /></button>
        )}
      </div>
    );
  };
  return (
    <>
      <div className="dw-sec">{active.map(row)}</div>
      {archived.length > 0 && <div className="dw-sec"><h3>Archived</h3>{archived.map(row)}</div>}
      <p className="dw-help">The first company can be renamed but not archived; it also holds your login.</p>
    </>
  );
}
