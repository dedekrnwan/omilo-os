"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BASE, api } from "@/lib/api";

/* The "+" menu in the chat box: attach files or photos, and switch folders, connectors and skills on or off for this chat. */

export type Attached = { id: string; name: string; mime: string; size: number };
type Item = { id: string; label: string; path?: string; access?: string; commands?: boolean; approval?: string; description?: string };
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
  const toggle = async (kind: keyof Tools, id: string) => {
    if (!tools || !threadId) return;
    const on = tools[kind].on.includes(id) ? tools[kind].on.filter((x) => x !== id) : [...tools[kind].on, id];
    setTools(await api<Tools>(`/threads/${threadId}/tools`, { method: "PUT", body: { [kind]: on } }));
  };
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

  const active = tools ? [
    ...tools.folders.all.filter((f) => tools.folders.on.includes(f.id)).map((f) => ({ k: "folders" as const, id: f.id, icon: "ri-folder-3-line", text: `${f.label}${f.access === "write" ? " · edit" : ""}${f.commands ? " · run" : ""}` })),
    ...tools.connectors.all.filter((c) => tools.connectors.on.includes(c.id)).map((c) => ({ k: "connectors" as const, id: c.id, icon: "ri-plug-line", text: c.label })),
    ...tools.skills.all.filter((s) => tools.skills.on.includes(s.id)).map((s) => ({ k: "skills" as const, id: s.id, icon: "ri-magic-line", text: s.label })),
  ] : [];

  const menu = (kind: "folders" | "connectors" | "skills", empty: string, href: string, manage: string) => (
    <div className="menu sub">
      {(tools?.[kind].all || []).length === 0 && <div className="small" style={{ padding: "8px 12px" }}>{empty}</div>}
      {tools?.[kind].all.map((it) => (
        <button key={it.id} className="mi" onClick={() => toggle(kind, it.id)}>
          <span className="t"><b>{it.label}</b>{(it.path || it.description || it.approval) && <span>{it.path || it.description || (it.approval === "auto" ? "Uses tools directly" : "Asks you before changes")}</span>}</span>
          <span className={`switch ${tools[kind].on.includes(it.id) ? "on" : ""}`} aria-checked={tools[kind].on.includes(it.id)} role="switch"><i /></span>
        </button>
      ))}
      <div className="sep" />
      <Link className="mi" href={href}><i className="ri-settings-3-line" /><span className="t"><b>{manage}</b></span></Link>
    </div>
  );

  return (
    <div className="ctools" ref={box}>
      {(files.length > 0 || active.length > 0 || uploading) && (
        <div className="cchips">
          {files.map((f) => (
            <span key={f.id} className="cchip">
              {f.mime.startsWith("image/") ? <img src={`${BASE}/api/files/${f.id}`} alt="" /> : <i className="ri-file-3-line" />}
              <span>{f.name}</span>
              <button aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x.id !== f.id))}><i className="ri-close-line" /></button>
            </span>
          ))}
          {uploading && <span className="cchip"><span className="spin" style={{ width: 12, height: 12 }} />Uploading…</span>}
          {active.map((a) => (
            <span key={`${a.k}${a.id}`} className="cchip soft"><i className={a.icon} /><span>{a.text}</span>
              <button aria-label={`Turn off ${a.text}`} onClick={() => toggle(a.k, a.id)}><i className="ri-close-line" /></button></span>
          ))}
        </div>
      )}
      <input ref={input} type="file" multiple hidden onChange={(e) => pick(e.target.files)} />
      <button type="button" className="iconbtn plus" aria-label="Add files, folders, connectors or skills" disabled={disabled} onClick={() => { setOpen(!open); setSub(null); }}>
        <i className="ri-add-line" />
      </button>
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
