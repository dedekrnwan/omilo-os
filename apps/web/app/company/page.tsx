"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useOverview } from "@/components/Shell";
import { Err } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import KpiBoard from "@/components/KpiBoard";
import { usePageActions } from "@/components/PageActions";
import { ago, api } from "@/lib/api";
import { usePoll } from "@/lib/poll";

type File = { name: string; bytes: number; updated_at: string };

/* Derive folder name from filename: "company/overview.md" → "company", "overview.md" → root */
function folder(name: string): string {
  const parts = name.split("/");
  return parts.length > 1 ? parts[0] : "";
}

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

  /* Company has no single topbar primary action. The pen shows "New KPI" as the primary
     button but KpiBoard owns that trigger via its own internal edit() state; there is no
     external ref to call it from here. The inline button inside KpiBoard is the canonical
     entry point. Clear any stale page actions so the topbar is empty for this page. */
  usePageActions(null, []);

  /* Knowledge completeness: count files with meaningful content (> 50 bytes) */
  const filledCount = files.filter((f) => f.bytes > 50).length;
  const totalCount = files.length;
  const pct = totalCount > 0 ? Math.round((filledCount / totalCount) * 100) : 0;

  return (
    <div className="company-v2">
      {/* Page Header v2 */}
      <div className="ph2">
        <div className="ph2-text">
          <h1 className="ph2-title">{overview?.company_name || "Company"}</h1>
          <p className="ph2-sub">The numbers, context and rules your helpers need to do good work for your company.</p>
        </div>
        <div className="ph2-actions">
          <Link href="/settings" className="btn"><i className="ri-settings-3-line" />Company settings</Link>
        </div>
      </div>

      {/* KPI Board — unchanged behavior, v2 layout via KpiBoard component */}
      <KpiBoard />

      {/* Section: What your helpers know */}
      <div className="sec">
        <div className="co2-know-head">
          <div className="co2-know-title-row">
            <h2>What your helpers know</h2>
            {totalCount > 0 && (
              <span className="co2-know-count small">{filledCount} of {totalCount} filled in</span>
            )}
          </div>
          {totalCount > 0 && (
            <div className="co2-know-meter">
              <div className="co2-know-fill" style={{ width: `${pct}%` }} />
            </div>
          )}
          <Link href="/docs" className="btn sm quiet co2-docs-link"><i className="ri-external-link-line" />Open in Docs</Link>
        </div>

        {/* Knowledge tiles grid */}
        <div className="co2-know-grid">
          {files.map((f) => {
            const label = fileLabel(f.name);
            const isFilled = f.bytes > 50;
            return (
              <button
                key={f.name}
                className={`co2-tile${sel === f.name ? " on" : ""}${!isFilled ? " co2-tile-empty" : ""}`}
                onClick={() => open(f.name)}
              >
                <div className="co2-tile-top">
                  <span className="co2-tile-label">{label}</span>
                  {!isFilled && <span className="chip idle co2-tile-chip">Fill in</span>}
                </div>
                <div className="co2-tile-meta small">{isFilled ? ago(f.updated_at) : folder(f.name) || "—"}</div>
              </button>
            );
          })}

          {/* Add a knowledge note */}
          <div className="co2-tile-add">
            <div className="co2-tile-add-field">
              <i className="ri-add-line" />
              <input
                placeholder="Add a knowledge note"
                value={newName}
                onChange={(e) => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9/_-]/g, "-"))}
                onKeyDown={(e) => { if (e.key === "Enter" && newName) create(); }}
              />
            </div>
            {newName && (
              <button className="btn sm primary" style={{ marginTop: 6 }} onClick={create}>Add file</button>
            )}
          </div>
        </div>

        {files.length === 0 && (
          <div className="empty" style={{ marginTop: 12 }}>
            <b>No knowledge files yet</b>
            <span>Add notes for your helpers: company context, rules, offer, customer profiles.</span>
          </div>
        )}
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
