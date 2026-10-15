"use client";
import { useCallback, useEffect, useState } from "react";
import { useOverview } from "@/components/Shell";
import { Empty, Err, Markdown } from "@/components/ui";
import { ago, api } from "@/lib/api";

type File = { name: string; bytes: number; updated_at: string };

export default function Company() {
  const { overview } = useOverview();
  const [files, setFiles] = useState<File[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => setFiles(await api<File[]>("/knowledge")), []);
  useEffect(() => { load(); }, [load]);
  const open = async (name: string) => {
    setSel(name); setEditing(false);
    try { setContent((await api<{ content: string }>(`/knowledge/${name}`)).content); } catch (e: any) { setErr(e.message); }
  };
  const save = async () => {
    try { await api(`/knowledge/${sel}`, { method: "PUT", body: { content } }); setEditing(false); load(); } catch (e: any) { setErr(e.message); }
  };
  const create = async () => {
    const n = newName.endsWith(".md") ? newName : `${newName}.md`;
    try { await api(`/knowledge/${n}`, { method: "PUT", body: { content: `# ${newName}\n` } }); setNewName(""); await load(); open(n); } catch (e: any) { setErr(e.message); }
  };
  const kpis = Object.entries(overview?.kpis || {});

  return (
    <div>
      <div className="eyebrow">What every agent knows</div>
      <h1>{overview?.company_name || "Company"}</h1>
      <div className="sec" style={{ marginTop: 16 }}>
        <h2>KPIs</h2>
        {kpis.length === 0 ? <p className="small">No KPIs yet. The Finance agent records them with their source.</p> : (
          <div className="stats">{kpis.slice(0, 8).map(([k, v]) => (
            <div className="stat" key={k}><div className="label">{k}</div><div className="num">{v.value.toLocaleString()}</div>
              <span className="small">{v.period} · {v.source}</span></div>
          ))}</div>
        )}
      </div>
      <div className="sec">
        <h2>Knowledge</h2>
        <div className="grid2" style={{ gridTemplateColumns: "240px 1fr", marginTop: 12 }}>
          <div className="threads">
            {files.map((f) => (
              <button key={f.name} className={sel === f.name ? "on" : ""} onClick={() => open(f.name)}>{f.name}<div className="small">{ago(f.updated_at)}</div></button>
            ))}
            <div style={{ padding: "10px 0" }}>
              <input placeholder="new-file" value={newName} onChange={(e) => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"))} />
              <button className="btn" style={{ marginTop: 6 }} disabled={!newName} onClick={create}>Add file</button>
            </div>
          </div>
          <div>
            {!sel ? <Empty title="Pick a file" text="Agents read these before every task." /> : editing ? (
              <>
                <textarea rows={24} value={content} onChange={(e) => setContent(e.target.value)} />
                <div className="acts" style={{ marginTop: 8 }}><button className="btn primary" onClick={save}>Save</button><button className="btn" onClick={() => open(sel)}>Cancel</button></div>
              </>
            ) : (
              <>
                <div className="acts" style={{ marginBottom: 8 }}><b>{sel}</b><span className="sp" /><button className="btn" onClick={() => setEditing(true)}>Edit</button></div>
                <div className="paper"><Markdown text={content} /></div>
              </>
            )}
            <Err error={err} />
          </div>
        </div>
      </div>
    </div>
  );
}
