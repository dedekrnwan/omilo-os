"use client";
import { usePageActions } from "@/components/PageActions";
import Link from "next/link";
import { useCallback, useState } from "react";
import Drawer from "@/components/Drawer";
import Avatar from "@/components/Avatar";
import { Err } from "@/components/ui";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/poll";
import { copy, menu, sep } from "@/lib/menu";
import { confirmDialog } from "@/lib/dialog";

/* Computer: which folders on the machine running Omilo your helpers may read, edit and run commands in.
   Sharing and changing a folder happen in a drawer on the right, with a folder browser. */

type Own = { id: string; name: string; access: "none" | "read" | "write"; commands: boolean };
type Folder = { id: string; path: string; label: string; access: "read" | "write"; commands: boolean; default_on: boolean; exists: boolean; helpers?: Own[] };
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
    if (!form?.id || !(await confirmDialog({ title: "Stop sharing this folder?", body: <><code>{form.path}</code><br />Helpers lose access. Nothing in the folder is deleted.</>, confirm: "Stop sharing", danger: true }))) return;
    await api(`/folders/${form.id}`, { method: "DELETE" }); close(); load();
  };
  const put = async (f: Folder, patch: Partial<Form>) => { try { await api(`/folders/${f.id}`, { method: "PUT", body: { path: f.path, label: f.label, access: f.access, commands: f.commands, default_on: f.default_on, ...patch } }); load(); } catch (e: any) { setErr(e.message); } };
  const items = (f: Folder) => [
    { heading: f.label },
    { label: "Edit", icon: "ri-edit-line", onSelect: () => edit(f) },
    { label: "Helpers may edit files", icon: "ri-edit-box-line", checked: f.access === "write", onSelect: () => put(f, { access: f.access === "write" ? "read" : "write" }) },
    { label: "Helpers may run commands", icon: "ri-terminal-box-line", checked: f.commands, onSelect: () => put(f, { commands: !f.commands }) },
    { label: "Every helper gets it", icon: "ri-team-line", checked: f.default_on, onSelect: () => put(f, { default_on: !f.default_on }) },
    sep,
    { label: "Copy the path", icon: "ri-file-copy-line", onSelect: () => copy(f.path) },
    sep,
    { label: "Stop sharing", icon: "ri-forbid-line", danger: true, onSelect: async () => { if (!(await confirmDialog({ title: "Stop sharing this folder?", body: <><code>{f.path}</code><br />Helpers lose access. Nothing in the folder is deleted.</>, confirm: "Stop sharing", danger: true }))) return; await api(`/folders/${f.id}`, { method: "DELETE" }); load(); } },
  ];
  const name = (p: string) => p.split("/").filter(Boolean).pop() || p;

  usePageActions({ primary: { label: "Share a folder", icon: "ri-folder-add-line", onSelect: startNew } }, []);
  return (
    <div>
      {/* Page Header v2 */}
      <div className="ph2">
        <div className="ph2-text">
          <h1 className="ph2-title">Folders</h1>
          <p className="ph2-sub">Folders on this computer your helpers can work in, such as a code project.</p>
        </div>
        <div className="ph2-actions">
          <button className="btn primary" onClick={startNew}><i className="ri-folder-add-line" />Share a folder</button>
        </div>
      </div>

      {/* Two-column layout: main (shared folders) + side (blocked actions info) */}
      <div className="fol2-cols">
        <div className="fol2-main">
          {/* Section header */}
          <div className="fol2-sec">
            <span className="fol2-sec-label">Shared</span>
            {list !== null && list.length > 0 && <span className="chip fol2-count">{list.length}</span>}
          </div>

          {list === null ? <p className="small">Loading…</p> : list.length === 0 ? (
            <div className="empty"><b>No folders shared</b><span>Share one and helpers can work in it like a developer on this machine.</span>
              <div style={{ marginTop: 12 }}><button className="btn primary" onClick={startNew}><i className="ri-folder-add-line" />Share a folder</button></div></div>
          ) : (
            <div className="fol2-list">
              {list.map((f) => (
                <div key={f.id} className="card fol2-card" onContextMenu={menu(() => items(f))}>
                  <div className="fol2-card-top" role="button" tabIndex={0} onClick={() => edit(f)} onKeyDown={(e) => { if (e.key === "Enter") edit(f); }}>
                    <span className="fol2-card-tile"><i className="ri-folder-3-line" /></span>
                    <div className="fol2-card-text">
                      <b className="fol2-card-name">{f.label}{!f.exists && <span className="chip down fol2-missing">Missing</span>}</b>
                      <span className="small mono fol2-card-path">{f.path}</span>
                    </div>
                    <button className="iconbtn fol2-card-more" aria-label="More" onClick={(e) => { e.stopPropagation(); menu(() => items(f))(e); }}><i className="ri-more-2-fill" /></button>
                  </div>
                  <div className="fol2-row">
                    <div className="fol2-row-text"><b>Read and edit files</b><span>Helpers can open and change files here.</span></div>
                    <button className={`switch ${f.access === "write" ? "on" : ""}`} role="switch" aria-checked={f.access === "write"} aria-label="Read and edit files" onClick={() => put(f, { access: f.access === "write" ? "read" : "write" })}><i /></button>
                  </div>
                  <div className="fol2-row">
                    <div className="fol2-row-text"><b>Run commands</b><span>Tests, builds and scripts. Risky commands still ask.</span></div>
                    <button className={`switch ${f.commands ? "on" : ""}`} role="switch" aria-checked={f.commands} aria-label="Run commands" onClick={() => put(f, { commands: !f.commands })}><i /></button>
                  </div>
                  <div className="fol2-row fol2-who">
                    <div className="fol2-row-text"><b>Who can use it</b><span>Change it for one helper on that helper&apos;s page.</span></div>
                    <div className="fol2-who-right">
                      {(f.helpers || []).filter((h) => h.access !== "none").slice(0, 4).map((h) => (
                        <Link key={h.id} href={`/staff/?id=${h.id}#access`} className="fol2-who-av" title={h.name}><Avatar who={{ id: h.id, name: h.name }} size={24} /></Link>
                      ))}
                      <span className="small">{f.default_on ? "Every helper" : `${(f.helpers || []).filter((h) => h.access !== "none").length} helper${(f.helpers || []).filter((h) => h.access !== "none").length === 1 ? "" : "s"}`}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!form && <Err error={err} />}
        </div>

        {/* Side column — "Always asks you first" */}
        <div className="fol2-side">
          <div className="fol2-sec">
            <span className="fol2-sec-label">Always asks you first</span>
          </div>
          <div className="fol2-blocked">
            <div className="fol2-blocked-item"><i className="ri-lock-line" /><span>Deleting files</span></div>
            <div className="fol2-blocked-item"><i className="ri-lock-line" /><span>Pushing code</span></div>
            <div className="fol2-blocked-item"><i className="ri-lock-line" /><span>Publishing anything</span></div>
            <div className="fol2-blocked-item"><i className="ri-lock-line" /><span>Deploying</span></div>
            <p className="fol2-blocked-note">Even with commands on, these wait for you in Inbox.</p>
          </div>
          <div className="fol2-note soft">
            <i className="ri-information-line" />
            <p>Only helpers on Claude Code (the pool or your own key) can open folders. Built-in Claude can&apos;t.</p>
          </div>
          <div className="fol2-note soft">
            <i className="ri-information-line" />
            <p>Running Omilo in Docker? Only folders mounted into the container can be shared.</p>
          </div>
        </div>
      </div>

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
                <span className="t"><b>Every helper gets it</b><span>In every chat and job. Otherwise switch it on per chat with +, or for one helper on its page (Access)</span></span>
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
