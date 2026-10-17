"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BASE, api } from "@/lib/api";

/* The "+" menu in the chat box: attach files or photos, and switch folders, connectors and skills on or off for this chat. */

export type Attached = { id: string; name: string; mime: string; size: number };
type Health = { ok: boolean | null; detail: string } | null;
type Item = { id: string; label: string; path?: string; access?: string; commands?: boolean; approval?: string; description?: string; kind?: string; health?: Health };
type Tools = Record<"folders" | "connectors" | "skills", { on: string[]; all: Item[] }>;

const toB64 = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] || "");
  r.onerror = rej;
  r.readAsDataURL(f);
});

export function useThreadTools(threadId: string | null) {
  const [tools, setTools] = useState<Tools | null>(null);
  const load = useCallback(async () => {
    if (!threadId) return;
    try { setTools(await api<Tools>(`/threads/${threadId}/tools`)); } catch { /* ignore */ }
  }, [threadId]);
  useEffect(() => { setTools(null); load(); }, [load]);
  const [health, setHealth] = useState<Record<string, Health>>({});
  useEffect(() => {
    if (!threadId) return;
    let off = false;
    const check = () => api<Record<string, Health>>("/connectors/check", { body: {} }).then((h) => { if (!off) setHealth(h); }).catch(() => {});
    check();
    const t = setInterval(check, 5 * 60_000);
    return () => { off = true; clearInterval(t); };
  }, [threadId]);
  const toggle = async (kind: keyof Tools, id: string) => {
    if (!tools || !threadId) return;
    const on = tools[kind].on.includes(id) ? tools[kind].on.filter((x) => x !== id) : [...tools[kind].on, id];
    setTools(await api<Tools>(`/threads/${threadId}/tools`, { method: "PUT", body: { [kind]: on } }));
  };
  if (tools) for (const c of tools.connectors.all) c.health = health[c.id] ?? c.health ?? null;
  return { tools, toggle, reload: load };
}

export default function ComposerTools({ threadId, files, setFiles, disabled }: {
  threadId: string | null; files: Attached[]; setFiles: (f: Attached[]) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<"folders" | "connectors" | "skills" | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const { tools, toggle } = useThreadTools(threadId);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setSub(null); } };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true); setErr(null); setOpen(false);
    const added: Attached[] = [];
    try {
      for (const f of Array.from(list).slice(0, 10)) {
        if (f.size > 25 * 1024 * 1024) { setErr(`${f.name} is larger than 25 MB`); continue; }
        added.push(await api<Attached>("/files", { body: { name: f.name, data: await toB64(f) } }));
      }
    } catch (e: any) { setErr(e.message); }
    setFiles([...files, ...added]);
    setUploading(false);
    if (input.current) input.current.value = "";
  };

  const on = (k: "folders" | "connectors" | "skills") => (tools ? tools[k].all.filter((x) => tools[k].on.includes(x.id)) : []);
  const conns = on("connectors");
  const failing = conns.filter((c) => c.health && c.health.ok === false);
  const dot = !conns.length || conns.every((c) => !c.health) ? "" : failing.length === 0 ? "ok" : failing.length * 2 >= conns.length ? "bad" : "warn";
  const badges = [
    { k: "folders" as const, icon: "ri-folder-3-line", items: on("folders"), dot: "" },
    { k: "connectors" as const, icon: "ri-plug-line", items: conns, dot },
    { k: "skills" as const, icon: "ri-magic-line", items: on("skills"), dot: "" },
  ].filter((b) => b.items.length);
  const what = { folders: "folder", connectors: "connector", skills: "skill" };
  const tip = (b: (typeof badges)[number]) => `${b.items.length} ${what[b.k]}${b.items.length > 1 ? "s" : ""} on: ${b.items.map((x) => x.label).join(", ")}` +
    (b.k === "connectors" && failing.length ? ` · not reachable: ${failing.map((x) => x.label).join(", ")}` : "");
  const showSub = (k: "folders" | "connectors" | "skills") => { setOpen(true); setSub(k); };

  // slash commands drive the same menu: attach, open a list, or switch a skill/connector/folder on for this chat
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { action: string; kind?: "folders" | "connectors" | "skills"; id?: string };
      if (d.action === "attach") input.current?.click();
      else if (d.action === "open" && d.kind) showSub(d.kind);
      else if (d.action === "enable" && d.kind && d.id && tools && !tools[d.kind].on.includes(d.id)) toggle(d.kind, d.id);
    };
    window.addEventListener("omilo:composer", on);
    return () => window.removeEventListener("omilo:composer", on);
  });

  const menu = (kind: "folders" | "connectors" | "skills", empty: string, href: string, manage: string) => (
    <div className="menu sub">
      {(tools?.[kind].all || []).length === 0 && <div className="small" style={{ padding: "8px 12px" }}>{empty}</div>}
      {tools?.[kind].all.map((it) => (
        <button key={it.id} className="mi" onClick={() => toggle(kind, it.id)}>
          <span className="t"><b>{kind === "connectors" && it.health && <i className={`hdot ${it.health.ok ? "ok" : "bad"}`} />}{it.label}</b>
            {(it.path || it.description || it.approval) && <span>{it.health?.ok === false ? it.health.detail : it.path || it.description || (it.approval === "auto" ? "Uses tools directly" : "Asks you before changes")}</span>}</span>
          <span className={`switch ${tools[kind].on.includes(it.id) ? "on" : ""}`} aria-checked={tools[kind].on.includes(it.id)} role="switch"><i /></span>
        </button>
      ))}
      <div className="sep" />
      <Link className="mi" href={href}><i className="ri-settings-3-line" /><span className="t"><b>{manage}</b></span></Link>
    </div>
  );

  return (
    <div className="ctools" ref={box}>
      {(files.length > 0 || uploading) && (
        <div className="cchips">
          {files.map((f) => (
            <span key={f.id} className="cchip">
              {f.mime.startsWith("image/") ? <img src={`${BASE}/api/files/${f.id}`} alt="" /> : <i className="ri-file-3-line" />}
              <span>{f.name}</span>
              <button aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x.id !== f.id))}><i className="ri-close-line" /></button>
            </span>
          ))}
          {uploading && <span className="cchip"><span className="spin" style={{ width: 12, height: 12 }} />Uploading…</span>}
        </div>
      )}
      <input ref={input} type="file" multiple hidden onChange={(e) => pick(e.target.files)} />
      <button type="button" className="iconbtn plus" aria-label="Add files, folders, connectors or skills" disabled={disabled} onClick={() => { setOpen(!open); setSub(null); }}>
        <i className="ri-add-line" />
      </button>
      {badges.map((b) => (
        <button key={b.k} type="button" className={`cbadge ${sub === b.k && open ? "on" : ""}`} title={tip(b)} aria-label={tip(b)} onClick={() => showSub(b.k)}>
          <i className={b.icon} />{b.items.length}{b.dot && <i className={`hdot ${b.dot}`} />}
        </button>
      ))}
      {open && (
        <div className="menu">
          <button className="mi" onClick={() => input.current?.click()}><i className="ri-attachment-2" /><span className="t"><b>Add files or photos</b></span></button>
          <div className="sep" />
          <button className={`mi ${sub === "folders" ? "on" : ""}`} onMouseEnter={() => setSub("folders")} onClick={() => setSub("folders")}>
            <i className="ri-folder-3-line" /><span className="t"><b>Folders on this computer</b></span><i className="ri-arrow-right-s-line" /></button>
          <button className={`mi ${sub === "connectors" ? "on" : ""}`} onMouseEnter={() => setSub("connectors")} onClick={() => setSub("connectors")}>
            <i className="ri-plug-line" /><span className="t"><b>Connectors</b></span><i className="ri-arrow-right-s-line" /></button>
          <button className={`mi ${sub === "skills" ? "on" : ""}`} onMouseEnter={() => setSub("skills")} onClick={() => setSub("skills")}>
            <i className="ri-magic-line" /><span className="t"><b>Skills</b></span><i className="ri-arrow-right-s-line" /></button>
          <div className="sep" />
          <Link className="mi" href="/talent/"><i className="ri-user-add-line" /><span className="t"><b>Hire a specialist</b></span></Link>
          {sub === "folders" && menu("folders", "No folders connected yet.", "/computer/", "Connect a folder")}
          {sub === "connectors" && menu("connectors", "No connectors yet.", "/connectors/", "Manage connectors")}
          {sub === "skills" && menu("skills", "No skills yet.", "/skills/", "Manage skills")}
        </div>
      )}
      {err && <div className="error">{err}</div>}
    </div>
  );
}
