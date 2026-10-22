"use client";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useOverview } from "@/components/Shell";
import { Err } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import KpiBoard from "@/components/KpiBoard";
import { usePageActions } from "@/components/PageActions";
import { ago, api } from "@/lib/api";
import { usePoll } from "@/lib/poll";

type File = { name: string; bytes: number; updated_at: string };

/* The knowledge your helpers lean on, as fixed categories (pen H8ZMEK). Each maps to a
   markdown file named <key>.md; extra files you add appear after these. */
const CANON: { key: string; label: string; desc: string; icon: string }[] = [
  { key: "company", label: "Company", desc: "Who you are and what you do", icon: "ri-building-line" },
  { key: "customers", label: "Customers", desc: "Who you serve and what they need", icon: "ri-user-heart-line" },
  { key: "goals", label: "Goals", desc: "What you want this quarter", icon: "ri-focus-3-line" },
  { key: "offer", label: "Offer", desc: "What you sell and for how much", icon: "ri-price-tag-3-line" },
  { key: "rules", label: "Rules", desc: "What helpers must never do", icon: "ri-shield-cross-line" },
  { key: "systems", label: "Systems", desc: "Tools, accounts and where things live", icon: "ri-stack-line" },
  { key: "voice", label: "Voice", desc: "How you sound to customers", icon: "ri-chat-voice-line" },
];
const baseKey = (name: string): string => (name.split("/").pop() || name).replace(/\.md$/, "").toLowerCase();

function fileLabel(name: string): string {
  const base = name.split("/").pop() || name;
  return base.replace(/\.md$/, "").replace(/[-_]/g, " ");
}

export default function Company() {
  const { overview } = useOverview();
  const [files, setFiles] = useState<File[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => setFiles(await api<File[]>("/knowledge")), []);
  usePoll(load, 60000, [load]);

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
  /* Open a canonical category: its file if present, otherwise create it and open. */
  const openCat = async (c: { key: string; label: string }, file?: File) => {
    if (file) return open(file.name);
    const n = `${c.key}.md`;
    try { await api(`/knowledge/${n}`, { method: "PUT", body: { content: `# ${c.label}\n` } }); await load(); open(n); } catch (e: any) { setErr(e.message); }
  };

  /* "New KPI" is the page's primary action; KpiBoard hands us its create-form opener through this ref. */
  const newKpiRef = useRef<(() => void) | null>(null);
  usePageActions({ primary: { label: "New KPI", icon: "ri-add-line", onSelect: () => newKpiRef.current?.() } }, []);

  /* Knowledge completeness: how many of the 7 canonical categories have a filled-in file. */
  const fileFor = (key: string) => files.find((f) => baseKey(f.name) === key);
  const isFilled = (f?: File) => !!f && f.bytes > 50;
  const filledCount = CANON.filter((c) => isFilled(fileFor(c.key))).length;
  const totalCount = CANON.length;
  const pct = Math.round((filledCount / totalCount) * 100);
  /* Any files that aren't one of the canonical categories still show up, so nothing is hidden. */
  const extras = files.filter((f) => !CANON.some((c) => c.key === baseKey(f.name)));

  return (
    <div className="company-v2">
      {/* Page Header v2 */}
      <div className="ph2">
        <div className="ph2-text">
          <h1 className="ph2-title">{overview?.company_name || "Company"}</h1>
          <p className="ph2-sub">The numbers you watch, and what your helpers know about your company.</p>
        </div>
        <div className="ph2-actions">
          <Link href="/settings" className="btn"><i className="ri-settings-3-line" />Company settings</Link>
          <button className="btn primary" onClick={() => newKpiRef.current?.()}><i className="ri-add-line" />New KPI</button>
        </div>
      </div>

      {/* KPI Board — unchanged behavior, v2 layout via KpiBoard component */}
      <KpiBoard openRef={newKpiRef} />

      {/* Section: What your helpers know */}
      <div className="sec">
        <div className="co2-know-head">
          <div className="co2-know-title-row">
            <h2>What your helpers know</h2>
            <span className="co2-know-count small">{filledCount} of {totalCount} filled in</span>
          </div>
          <div className="co2-know-meter">
            <div className="co2-know-fill" style={{ width: `${pct}%` }} />
          </div>
          <Link href="/docs" className="btn sm quiet co2-docs-link"><i className="ri-external-link-line" />Open in Docs</Link>
        </div>

        {/* Knowledge rows — fixed categories, then any extra files, then "add a note" */}
        <div className="co2-know-grid">
          {CANON.map((c) => {
            const f = fileFor(c.key);
            const filled = isFilled(f);
            return (
              <button key={c.key} className={`co2-krow${sel === f?.name ? " on" : ""}`} onClick={() => openCat(c, f)}>
                <span className="co2-krow-tile"><i className={c.icon} /></span>
                <span className="co2-krow-text">
                  <b>{c.label}</b>
                  <span className="small">{c.desc}</span>
                </span>
                {filled
                  ? <span className="co2-krow-meta small">{ago(f!.updated_at)}</span>
                  : <span className="chip co2-krow-fill"><i className="ri-pencil-line" />Fill in</span>}
              </button>
            );
          })}

          {extras.map((f) => (
            <button key={f.name} className={`co2-krow${sel === f.name ? " on" : ""}`} onClick={() => open(f.name)}>
              <span className="co2-krow-tile"><i className="ri-file-text-line" /></span>
              <span className="co2-krow-text">
                <b>{fileLabel(f.name)}</b>
                <span className="small">{f.bytes > 50 ? "Your note" : "Empty — add something"}</span>
              </span>
              {f.bytes > 50
                ? <span className="co2-krow-meta small">{ago(f.updated_at)}</span>
                : <span className="chip co2-krow-fill"><i className="ri-pencil-line" />Fill in</span>}
            </button>
          ))}

          {/* Add a knowledge note */}
          <div className="co2-krow co2-krow-add">
            <span className="co2-krow-tile"><i className="ri-add-line" /></span>
            <div className="co2-krow-add-field">
              <input
                placeholder="Add a knowledge note"
                value={newName}
                onChange={(e) => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9/_-]/g, "-"))}
                onKeyDown={(e) => { if (e.key === "Enter" && newName) create(); }}
              />
              {newName && <button className="btn sm primary" onClick={create}>Add</button>}
            </div>
          </div>
        </div>
      </div>

      {/* Knowledge editor / viewer (shown below grid when a file is selected) */}
      {sel && (
        <div className="sec co2-editor">
          <div className="co2-editor-head acts">
            <b>{sel}</b>
            <span className="sp" />
            {!editing && <button className="btn sm" onClick={() => setEditing(true)}><i className="ri-edit-line" />Edit</button>}
            <button className="btn sm quiet" onClick={() => { setSel(null); setEditing(false); }}><i className="ri-close-line" /></button>
          </div>
          {editing ? (
            <>
              <textarea rows={24} value={content} onChange={(e) => setContent(e.target.value)} style={{ marginTop: 8 }} />
              <div className="acts" style={{ marginTop: 8 }}>
                <button className="btn primary" onClick={save}>Save</button>
                <button className="btn" onClick={() => open(sel)}>Cancel</button>
              </div>
            </>
          ) : (
            <div className="paper" style={{ marginTop: 8 }}><Markdown text={content} /></div>
          )}
          <Err error={err} />
        </div>
      )}
      {!sel && err && <Err error={err} />}
    </div>
  );
}
