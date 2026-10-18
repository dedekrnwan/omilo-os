"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Err } from "@/components/ui";

/* Team → helper → Access: what this one helper may open and use on the computer running Omilo (folders, editing,
   terminal commands) and which connectors and skills it has. Company defaults come from the Computer, Connectors and
   Skills pages; a choice here is for this helper only, and wins over what a chat picks. */

type Level = { access: "none" | "read" | "write"; commands: boolean };
type FolderRow = { id: string; path: string; label: string; exists: boolean; company: { access: string; commands: boolean; default_on: boolean };
  default: Level; own: Level | null; effective: Level };
type Toggle = { id: string; label: string; description?: string; approval?: string; default: boolean; own: boolean | null; effective: boolean };
type View = { staff_id: string; name: string; uses_files: boolean; folders: FolderRow[]; connectors: Toggle[]; skills: Toggle[] };

const LEVEL_OPTS: [string, string][] = [["none", "No access"], ["read", "Read"], ["write", "Read and edit"], ["commands", "Read, edit and run commands"]];
const levelKey = (l: Level) => (l.access === "write" && l.commands ? "commands" : l.access);
const levelName = (l: Level) => LEVEL_OPTS.find(([k]) => k === levelKey(l))?.[1] || l.access;
const levelBody = (k: string): Level | null =>
  k === "" ? null : k === "commands" ? { access: "write", commands: true } : { access: k as Level["access"], commands: false };
const chipFor = (l: Level) => (l.access === "none" ? "idle" : l.commands ? "warn" : l.access === "write" ? "up" : "");

export default function HelperAccess({ id, name }: { id: string; name: string }) {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => api<View>(`/staff/${id}/access`).then(setV).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const put = async (key: string, body: Record<string, unknown>) => {
    setBusy(key); setErr(null);
    try { setV(await api<View>(`/staff/${id}/access`, { method: "PUT", body })); } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  if (!v) return <div className="sec" id="access"><h2>Access</h2><Err error={err} /></div>;

  const toggles = (kind: "connectors" | "skills", items: Toggle[], empty: React.ReactNode, href: string, what: string) => (
    <>
      {items.length === 0 ? <p className="small">{empty}</p> : (
        <div className="tw"><table className="access-t"><thead><tr><th>{what}</th><th>For {name}</th></tr></thead><tbody>
          {items.map((t) => (
            <tr key={t.id}>
              <td><b style={{ fontWeight: 500 }}>{t.label}</b>{t.description && <div className="small">{t.description}</div>}</td>
              <td><select aria-label={`${t.label} for ${name}`} disabled={busy === `${kind}:${t.id}`} value={t.own === null ? "" : t.own ? "on" : "off"}
                onChange={(e) => put(`${kind}:${t.id}`, { [kind]: { [t.id]: e.target.value === "" ? null : e.target.value === "on" } })}>
                <option value="">Team default ({t.default ? "on" : "off"})</option><option value="on">On</option><option value="off">Off</option>
              </select></td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      <p className="small" style={{ marginTop: 6 }}><Link href={href}>Manage {what.toLowerCase()} for the whole team</Link></p>
    </>
  );

  return (
    <div className="sec" id="access">
      <h2>Access</h2>
      <p className="small" style={{ marginTop: 0 }}>What {name} may open and use. Team defaults come from <Link href="/computer/">Computer</Link>, <Link href="/connectors/">Connectors</Link> and <Link href="/skills/">Skills</Link>;
        a choice here is for {name} only and wins over what a chat picks. Even with commands on, deleting files, pushing code, publishing and deploying still ask you first.</p>
      {!v.uses_files && (
        <div className="callout warn" style={{ marginBottom: 12 }}>{name} runs on an AI that can&apos;t open files or run commands. Pick a Claude Code option under <b>Job → AI</b> for folder work.</div>
      )}

      <h3 className="access-h"><i className="ri-folder-3-line" />Folders on this computer</h3>
      {v.folders.length === 0 ? (
        <p className="small">No folders are shared yet. <Link href="/computer/">Share a folder on Computer</Link>, then choose what {name} may do there.</p>
      ) : (
        <div className="tw"><table className="access-t"><thead><tr><th>Folder</th><th>For {name}</th><th className="hide-sm">Now</th></tr></thead><tbody>
          {v.folders.map((f) => (
            <tr key={f.id}>
              <td><b style={{ fontWeight: 500 }}>{f.label}</b>{!f.exists && <span className="chip down" style={{ marginLeft: 6 }}>missing</span>}
                <div className="small mono" title={f.path}>{f.path}</div></td>
              <td><select aria-label={`${f.label} for ${name}`} disabled={busy === `folder:${f.id}`} value={f.own ? levelKey(f.own) : ""}
                onChange={(e) => put(`folder:${f.id}`, { folders: { [f.id]: levelBody(e.target.value) } })}>
                <option value="">Team default ({levelName(f.default).toLowerCase()})</option>
                {LEVEL_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></td>
              <td className="hide-sm"><span className={`chip ${chipFor(f.effective)}`}>{f.effective.commands && <i className="ri-terminal-box-line" />}{levelName(f.effective)}</span></td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      <p className="small" style={{ marginTop: 6 }}>&quot;Team default&quot; is the folder&apos;s setting on Computer when it&apos;s on for every helper, otherwise no access (a chat can still add it). <Link href="/computer/">Share another folder</Link></p>

      <h3 className="access-h"><i className="ri-plug-line" />Connectors</h3>
      {toggles("connectors", v.connectors, <>No connectors yet.</>, "/connectors/", "Connectors")}
      <h3 className="access-h"><i className="ri-magic-line" />Skills</h3>
      {toggles("skills", v.skills, <>No skills yet.</>, "/skills/", "Skills")}
      <Err error={err} />
    </div>
  );
}
