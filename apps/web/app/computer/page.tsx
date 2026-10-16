"use client";
import { useCallback, useEffect, useState } from "react";
import Drawer from "@/components/Drawer";
import { Err } from "@/components/ui";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/poll";
import { copy, menu, sep } from "@/lib/menu";

/* Computer: which folders on the machine running Saga OS your helpers may read, edit and run commands in.
   Sharing and changing a folder happen in a drawer on the right, with a folder browser. */

type Folder = { id: string; path: string; label: string; access: "read" | "write"; commands: boolean; default_on: boolean; exists: boolean };
type Fs = { path: string; parent: string | null; home: string; dirs: string[] };
type Form = { id?: string; path: string; label: string; access: "read" | "write"; commands: boolean; default_on: boolean };

const blank: Form = { path: "", label: "", access: "write", commands: false, default_on: false };

export default function Computer() {
  const [list, setList] = useState<Folder[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [fs, setFs] = useState<Fs | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => { try { setList(await api<Folder[]>("/folders")); } catch (e: any) { setErr(e.message); } }, []);
  usePoll(load, 60000, [load]);
  const browse = useCallback(async (p: string) => {
    try { const r = await api<Fs>(`/fs?path=${encodeURIComponent(p)}`); setFs(r); setForm((f) => (f && !f.id ? { ...f, path: r.path } : f)); setErr(null); }
    catch (e: any) { setErr(e.message); }
  }, []);
  const close = useCallback(() => { setForm(null); setFs(null); setErr(null); }, []);
  const startNew = () => { setErr(null); setForm({ ...blank }); browse(""); };
  const edit = (f: Folder) => { setErr(null); setFs(null); setForm({ id: f.id, path: f.path, label: f.label, access: f.access, commands: f.commands, default_on: f.default_on }); };
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const save = async () => {
    if (!form) return;
    setBusy(true); setErr(null);
    try {
      await api(form.id ? `/folders/${form.id}` : "/folders", { method: form.id ? "PUT" : "POST", body: form });
      close(); load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!form?.id || !confirm(`Stop sharing ${form.path}? Nothing in the folder is deleted.`)) return;
    await api(`/folders/${form.id}`, { method: "DELETE" }); close(); load();
  };
  const put = async (f: Folder, patch: Partial<Form>) => { try { await api(`/folders/${f.id}`, { method: "PUT", body: { path: f.path, label: f.label, access: f.access, commands: f.commands, default_on: f.default_on, ...patch } }); load(); } catch (e: any) { setErr(e.message); } };
  const items = (f: Folder) => [
    { heading: f.label },
    { label: "Edit", icon: "ri-edit-line", onSelect: () => edit(f) },
    { label: "Helpers may edit files", icon: "ri-edit-box-line", checked: f.access === "write", onSelect: () => put(f, { access: f.access === "write" ? "read" : "write" }) },
    { label: "Helpers may run commands", icon: "ri-terminal-box-line", checked: f.commands, onSelect: () => put(f, { commands: !f.commands }) },
    { label: "On in every chat", icon: "ri-chat-check-line", checked: f.default_on, onSelect: () => put(f, { default_on: !f.default_on }) },
    sep,
    { label: "Copy the path", icon: "ri-file-copy-line", onSelect: () => copy(f.path) },
    sep,
    { label: "Stop sharing", icon: "ri-forbid-line", danger: true, onSelect: async () => { if (!confirm(`Stop sharing ${f.path}? Nothing in the folder is deleted.`)) return; await api(`/folders/${f.id}`, { method: "DELETE" }); load(); } },
  ];
  const name = (p: string) => p.split("/").filter(Boolean).pop() || p;

  return (
    <div>
      <div className="sechead" style={{ alignItems: "flex-start" }}>
        <div><h1>Computer</h1>
          <p className="sub" style={{ marginBottom: 0 }}>Share folders on this computer with your helpers, for example a code project they develop in. They only reach the folders you add here, and only in chats or jobs where the folder is switched on.</p></div>
        <span className="sp" />
        <button className="btn primary" onClick={startNew}><i className="ri-folder-add-line" />Share a folder</button>
      </div>

      <div className="sec" style={{ marginTop: 20 }}>
        {list === null ? <p className="small">Loading…</p> : list.length === 0 ? (
          <div className="empty"><b>No folders shared</b><span>Share one and helpers can work in it like a developer on this machine.</span>
            <div style={{ marginTop: 12 }}><button className="btn primary" onClick={startNew}><i className="ri-folder-add-line" />Share a folder</button></div></div>
        ) : (
          <div className="grid2">
            {list.map((f) => (
              <div key={f.id} className="card" role="button" tabIndex={0} style={{ cursor: "pointer" }} onClick={() => edit(f)} onKeyDown={(e) => { if (e.key === "Enter") edit(f); }} onContextMenu={menu(() => items(f))}>
                <b style={{ fontWeight: 500 }}><i className="ri-folder-3-line" /> {f.label}</b>
                <div className="small mono" style={{ wordBreak: "break-all" }}>{f.path}</div>
                <div className="acts" style={{ gap: 6 }}>
                  <span className="chip">{f.access === "write" ? "Read and edit" : "Read only"}</span>
                  {f.commands && <span className="chip">Runs commands</span>}
                  <span className="chip idle">{f.default_on ? "On everywhere" : "Per chat"}</span>
                  {!f.exists && <span className="chip down">Missing</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="soft" style={{ marginTop: 24 }}>
        <b style={{ fontWeight: 500 }}>Good to know</b>
        <ul style={{ paddingLeft: 18, margin: "8px 0 0", fontSize: 14, lineHeight: 1.7 }}>
          <li>Helpers on <b>Claude Code</b> (your API key or the pool) get exactly these folders: reading, editing only where you allow it, and commands only where you tick it.</li>
          <li>Helpers on <b>built-in Claude</b> can't open files at all; use Claude Code (your key or the pool) for folder work.</li>
          <li>Even with commands on, deleting files, pushing code, publishing and deploying are blocked: helpers ask you in the Inbox instead.</li>
          <li>Running Saga OS in Docker? Only folders mounted into the container can be shared.</li>
        </ul>
      </div>
      {!form && <Err error={err} />}

      <Drawer open={!!form} onClose={close} icon={<i className={form?.id ? "ri-folder-3-line" : "ri-folder-add-line"} />}
        title={form?.id ? form.label || name(form.path) : "Share a folder"} sub={form?.id ? <span className="mono">{form.path}</span> : "Pick a folder, then choose what helpers may do in it."}
        footer={form && (
          <>
            {form.id && <button className="btn quiet" onClick={remove}><i className="ri-delete-bin-line" />Stop sharing</button>}
            <span className="sp" />
            <button className="btn" onClick={close}>Cancel</button>
            <button className="btn primary" disabled={!form.path.trim() || busy || (!form.id && !!fs && form.path === fs.home)} onClick={save}>
              {busy ? "Saving…" : form.id ? "Save changes" : fs && form.path === fs.home ? "Open a folder first" : `Share ${name(form.path) || "folder"}`}</button>
          </>
        )}>
        {form && (
          <>
            {!form.id && (
              <div className="dw-sec">
                <h3>Folder</h3>
                <div className="acts" style={{ flexWrap: "nowrap", marginTop: 6 }}>
                  <input className="mono" style={{ flex: 1 }} value={form.path} onChange={(e) => set({ path: e.target.value })} placeholder="~/Projects/my-app"
                    onKeyDown={(e) => { if (e.key === "Enter") browse(form.path); }} />
                  <button className="btn" onClick={() => browse(form.path)}><i className="ri-folder-open-line" />Go</button>
                </div>
                {fs && (
                  <div className="fsbox" style={{ marginTop: 8, maxHeight: 300 }}>
                    <div className="fsrow" style={{ background: "var(--soft)", position: "sticky", top: 0 }}>
                      <button className="iconbtn" aria-label="Home folder" onClick={() => browse(fs.home)}><i className="ri-home-4-line" /></button>
                      {fs.parent && <button className="iconbtn" aria-label="Up one folder" onClick={() => browse(fs.parent!)}><i className="ri-arrow-up-line" /></button>}
                      <span className="small mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fs.path}</span>
                    </div>
                    {fs.dirs.length === 0 && <div className="fsrow small">No folders inside.</div>}
                    {fs.dirs.map((d) => (
                      <div key={d} className="fsrow" onContextMenu={menu(() => [{ heading: d }, { label: "Open", icon: "ri-folder-open-line", onSelect: () => browse(`${fs.path.replace(/\/$/, "")}/${d}`) },
                        { label: "Copy the path", icon: "ri-file-copy-line", onSelect: () => copy(`${fs.path.replace(/\/$/, "")}/${d}`) }])}><i className="ri-folder-3-line" />
                        <button className="link" onClick={() => browse(`${fs.path.replace(/\/$/, "")}/${d}`)}>{d}</button></div>
                    ))}
                  </div>
                )}
                <p className="dw-help">Open the folder you want, then share it. Your whole home folder can't be shared, only a folder inside it.</p>
              </div>
            )}
            <div className="dw-sec">
              <h3>Helpers can</h3>
              <div className="opt2" style={{ marginTop: 8 }}>
                <button type="button" className={form.access === "read" ? "on" : ""} onClick={() => set({ access: "read" })}><b><i className="ri-eye-line" />Read</b><span>Look, search, summarise</span></button>
                <button type="button" className={form.access === "write" ? "on" : ""} onClick={() => set({ access: "write" })}><b><i className="ri-edit-line" />Read and edit</b><span>Also create and change files</span></button>
              </div>
              <div className="togrow" style={{ marginTop: 8 }} onClick={() => set({ commands: !form.commands })}>
                <span className="t"><b>Run commands</b><span>Install, build, test and git, for development. Deleting, pushing and deploying stay blocked.</span></span>
                <span className={`switch ${form.commands ? "on" : ""}`} role="switch" aria-checked={form.commands}><i /></span>
              </div>
              <div className="togrow" onClick={() => set({ default_on: !form.default_on })}>
                <span className="t"><b>On in every chat and job</b><span>Otherwise switch it on per chat with +</span></span>
                <span className={`switch ${form.default_on ? "on" : ""}`} role="switch" aria-checked={form.default_on}><i /></span>
              </div>
            </div>
            <Err error={err} />
          </>
        )}
      </Drawer>
    </div>
  );
}
