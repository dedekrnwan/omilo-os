"use client";
import { useCallback, useEffect, useState } from "react";
import { Err } from "@/components/ui";
import { api } from "@/lib/api";

/* Computer: which folders on the machine running Saga OS your helpers may read, edit and run commands in. */

type Folder = { id: string; path: string; label: string; access: "read" | "write"; commands: boolean; default_on: boolean; exists: boolean };
type Fs = { path: string; parent: string | null; home: string; dirs: string[] };

export default function Computer() {
  const [list, setList] = useState<Folder[] | null>(null);
  const [fs, setFs] = useState<Fs | null>(null);
  const [path, setPath] = useState("");
  const [access, setAccess] = useState<"read" | "write">("write");
  const [commands, setCommands] = useState(false);
  const [def, setDef] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => { try { setList(await api<Folder[]>("/folders")); } catch (e: any) { setErr(e.message); } }, []);
  const browse = useCallback(async (p: string) => {
    try { const r = await api<Fs>(`/fs?path=${encodeURIComponent(p)}`); setFs(r); setPath(r.path); setErr(null); } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setErr(null);
    try { await api("/folders", { body: { path, access, commands, default_on: def } }); setFs(null); setPath(""); setCommands(false); setDef(false); load(); }
    catch (e: any) { setErr(e.message); }
  };
  const update = async (f: Folder, patch: Partial<Folder>) => {
    try { await api(`/folders/${f.id}`, { method: "PUT", body: { ...f, ...patch } }); load(); } catch (e: any) { setErr(e.message); }
  };
  const remove = async (f: Folder) => { if (!confirm(`Stop sharing ${f.path}?`)) return; await api(`/folders/${f.id}`, { method: "DELETE" }); load(); };

  return (
    <div>
      <h1>Computer</h1>
      <p className="sub">Share folders on this computer with your helpers, for example a code project they develop in. They only reach the folders you add here, and only in chats or jobs where the folder is switched on.</p>

      <div className="sec">
        <div className="sechead"><h2>Shared folders</h2></div>
        {list === null ? <p className="small">Loading…</p> : list.length === 0 ? (
          <div className="empty"><b>No folders shared</b><span>Add one below. Helpers then work in it like a developer on this machine.</span></div>
        ) : (
          <div className="tw"><table>
            <thead><tr><th>Folder</th><th>Helpers can</th><th className="hide-sm">Chats</th><th></th></tr></thead>
            <tbody>{list.map((f) => (
              <tr key={f.id}>
                <td><b style={{ fontWeight: 500 }}><i className="ri-folder-3-line" /> {f.label}</b><div className="small mono" style={{ wordBreak: "break-all" }}>{f.path}</div>
                  {!f.exists && <div className="small down">This folder is missing.</div>}</td>
                <td>
                  <div className="seg">
                    <button className={f.access === "read" ? "on" : ""} onClick={() => update(f, { access: "read" })}>Read</button>
                    <button className={f.access === "write" ? "on" : ""} onClick={() => update(f, { access: "write" })}>Read and edit</button>
                  </div>
                  <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={f.commands} onChange={(e) => update(f, { commands: e.target.checked })} />Run commands</label>
                </td>
                <td className="hide-sm"><label className="check" style={{ fontSize: 13, marginTop: 0 }}><input type="checkbox" checked={f.default_on} onChange={(e) => update(f, { default_on: e.target.checked })} />On everywhere</label></td>
                <td><button className="iconbtn" aria-label={`Stop sharing ${f.label}`} onClick={() => remove(f)}><i className="ri-delete-bin-line" /></button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="sec" style={{ marginTop: 28 }}>
        <h2>Add a folder</h2>
        <div className="grid2" style={{ alignItems: "start", marginTop: 8 }}>
          <div>
            <label style={{ marginTop: 0 }}>Folder</label>
            <div className="acts" style={{ flexWrap: "nowrap" }}>
              <input style={{ flex: 1 }} value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/Projects/my-app" />
              <button className="btn" onClick={() => browse(path)}><i className="ri-folder-open-line" />Browse</button>
            </div>
            {fs && (
              <div className="fsbox" style={{ marginTop: 8 }}>
                <div className="fsrow" style={{ background: "var(--soft)" }}>
                  <button className="iconbtn" aria-label="Home folder" onClick={() => browse(fs.home)}><i className="ri-home-4-line" /></button>
                  {fs.parent && <button className="iconbtn" aria-label="Up one folder" onClick={() => browse(fs.parent!)}><i className="ri-arrow-up-line" /></button>}
                  <span className="small mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fs.path}</span>
                </div>
                {fs.dirs.length === 0 && <div className="fsrow small">No folders inside.</div>}
                {fs.dirs.map((d) => (
                  <div key={d} className="fsrow"><i className="ri-folder-3-line" />
                    <button className="link" onClick={() => browse(`${fs.path.replace(/\/$/, "")}/${d}`)}>{d}</button></div>
                ))}
              </div>
            )}
            <label>Helpers can</label>
            <div className="seg">
              <button className={access === "read" ? "on" : ""} onClick={() => setAccess("read")}>Read</button>
              <button className={access === "write" ? "on" : ""} onClick={() => setAccess("write")}>Read and edit</button>
            </div>
            <label className="check"><input type="checkbox" checked={commands} onChange={(e) => setCommands(e.target.checked)} />Run commands in it (install, build, test, git), for development</label>
            <label className="check"><input type="checkbox" checked={def} onChange={(e) => setDef(e.target.checked)} />On in every chat and job (otherwise switch it on with + in a chat)</label>
            <div className="acts" style={{ marginTop: 16 }}><button className="btn primary" disabled={!path.trim()} onClick={add}><i className="ri-add-line" />Share folder</button></div>
            <Err error={err} />
          </div>
          <div className="soft">
            <b style={{ fontWeight: 500 }}>Good to know</b>
            <ul style={{ paddingLeft: 18, margin: "8px 0 0", fontSize: 14, lineHeight: 1.7 }}>
              <li>Helpers on the <b>Claude Code pool</b> get exactly these folders: reading, editing only where you allow it, and commands only where you tick it.</li>
              <li>Helpers on <b>Hermes</b> are told which folders to use, but Hermes has its own terminal, so it can reach more of this computer. Use the pool for strict limits.</li>
              <li>Even with commands on, deleting files, pushing code, publishing and deploying are blocked: helpers ask you in the Inbox instead.</li>
              <li>Running Saga OS in Docker? Only folders mounted into the container can be shared.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
