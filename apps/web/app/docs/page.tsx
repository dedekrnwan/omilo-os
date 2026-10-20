"use client";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import Drawer from "@/components/Drawer";
import { Markdown } from "@/components/Markdown";
import { Err } from "@/components/ui";
import { ApiError, ago, api } from "@/lib/api";
import { MenuItem, copy, menu, sep } from "@/lib/menu";
import { usePoll } from "@/lib/poll";
import { confirmDialog } from "@/lib/dialog";

/* Docs: the shared notebook for you and your helpers, Obsidian-style. A tree of Markdown notes, [[links]] between them,
   backlinks, outline and history on the right, and a graph of how everything connects. Saves as you type. */

const Knowledge = dynamic(() => import("@/components/Knowledge"), { ssr: false, loading: () => <p className="small" style={{ padding: 20 }}>Loading the knowledge base…</p> });
const DocGraph = dynamic(() => import("@/components/DocGraph"), { ssr: false, loading: () => <p className="small" style={{ padding: 20 }}>Loading the graph…</p> });

type Who = { kind: "owner" | "agent" | "outside"; id: string; name: string };
type TreeDoc = { path: string; title: string; folder: string; version: number; updated_by: Who | null; company: boolean; mtime: number };
type Doc = { path: string; title: string; content: string; version: number; updated_by: Who; updated_at: string; company: boolean;
  links: { target: string; path: string | null }[]; backlinks: { path: string; title: string; snippet: string }[];
  suggestions: { id: number; by: Who; summary: string; proposal_id: string | null; at: string }[] };
type Version = { version: number; by: Who; summary: string; at: string; chars: number };
type Save = "saved" | "dirty" | "saving" | "conflict" | "error";

const LINK_RE = /\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
const docHref = (p: string, isNew = false) => `/docs/?path=${encodeURIComponent(p)}${isNew ? "&new=1" : "&l=1"}`;

function resolve(target: string, paths: string[]): string | null {
  const t = target.trim();
  const md = t.toLowerCase().endsWith(".md") ? t : `${t}.md`;
  const exact = paths.find((p) => p.toLowerCase() === md.toLowerCase());
  if (exact) return exact;
  const base = md.split("/").pop()!.toLowerCase();
  const hits = paths.filter((p) => p.split("/").pop()!.toLowerCase() === base).sort((a, b) => a.length - b.length);
  return hits[0] || null;
}
const title = (p: string) => p.split("/").pop()!.replace(/\.md$/, "");
const whoLabel = (w?: Who | null) => (!w ? "" : w.kind === "owner" ? "You" : w.kind === "outside" ? "Outside Omilo" : w.name);

function WhoBadge({ w }: { w?: Who | null }) {
  if (!w) return null;
  if (w.kind === "agent") return <span className="who-b"><Avatar who={{ id: w.id, name: w.name }} size={16} />{w.name}</span>;
  return <span className="who-b"><i className={w.kind === "owner" ? "ri-user-3-line" : "ri-external-link-line"} />{whoLabel(w)}</span>;
}

/* ---------------------------------------------------------------- the tree */
function Tree({ docs, current, q, onOpen, noteMenu, folderMenu }: { docs: TreeDoc[]; current: string | null; q: string; onOpen: (p: string) => void;
  noteMenu: (d: TreeDoc) => MenuItem[]; folderMenu: (folder: string, collapsed: boolean, toggle: () => void) => MenuItem[] }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const ql = q.trim().toLowerCase();
  const shown = ql ? docs.filter((d) => d.path.toLowerCase().includes(ql)) : docs;
  const groups = useMemo(() => {
    const m = new Map<string, TreeDoc[]>();
    for (const d of shown) (m.get(d.folder) || m.set(d.folder, []).get(d.folder)!).push(d);
    const keys = [...m.keys()].sort((a, b) => (a === "Company" ? -1 : b === "Company" ? 1 : a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
    return keys.map((k) => ({ folder: k, docs: m.get(k)!.sort((a, b) => a.title.localeCompare(b.title)) }));
  }, [shown]);
  const toggle = (f: string) => setClosed((s) => { const x = new Set(s); if (x.has(f)) x.delete(f); else x.add(f); return x; });
  const sectionLabel = (f: string) => f === "Company" ? "COMPANY" : f === "Memory" ? "WHAT HELPERS LEARNED" : f.split("/")[0].toUpperCase();
  const folderIcon = (f: string) => f === "Company" ? "ri-building-2-line" : f === "Memory" ? "ri-brain-line" : "ri-folder-3-line";
  return (
    <div className="dtree">
      {groups.map((g) => {
        const depth = g.folder ? g.folder.split("/").length - 1 : 0;
        const isTopFolder = g.folder && depth === 0;
        return (
          <div key={g.folder || "(root)"}>
            {g.folder && isTopFolder && (
              <div className="dt-section" onContextMenu={menu(() => folderMenu(g.folder, closed.has(g.folder), () => toggle(g.folder)))}>
                <span className="dt-section-label">{sectionLabel(g.folder)}</span>
              </div>
            )}
            {g.folder && !isTopFolder && (
              <button className="dt-f" onClick={() => toggle(g.folder)} onContextMenu={menu(() => folderMenu(g.folder, closed.has(g.folder), () => toggle(g.folder)))} style={{ paddingLeft: 8 + depth * 12 }}>
                <i className={closed.has(g.folder) && !ql ? "ri-arrow-right-s-line" : "ri-arrow-down-s-line"} />
                <i className={folderIcon(g.folder)} />
                <span>{g.folder.split("/").pop()}</span>
              </button>
            )}
            {g.folder && isTopFolder && (
              <button className="dt-f dt-f-top" onClick={() => toggle(g.folder)} onContextMenu={menu(() => folderMenu(g.folder, closed.has(g.folder), () => toggle(g.folder)))} style={{ paddingLeft: 8 }}>
                <i className={closed.has(g.folder) && !ql ? "ri-arrow-right-s-line" : "ri-arrow-down-s-line"} />
                <i className={folderIcon(g.folder)} />
                <span>{g.folder === "Company" ? "Company knowledge" : g.folder === "Memory" ? "Memory (what helpers learned)" : g.folder}</span>
              </button>
            )}
            {(!closed.has(g.folder) || ql) && g.docs.map((d) => (
              <button key={d.path} className={`dt-d ${d.path === current ? "on" : ""}`} onClick={() => onOpen(d.path)} onContextMenu={menu(() => noteMenu(d))}
                style={{ paddingLeft: (g.folder ? 30 + depth * 12 : 12) }} title={d.path}>
                <i className="ri-file-text-line" /><span>{d.title}</span>
                {d.updated_by?.kind === "agent" && <span className="dt-by" title={`Last changed by ${d.updated_by.name}`}><Avatar who={{ id: d.updated_by.id, name: d.updated_by.name }} size={14} /></span>}
              </button>
            ))}
          </div>
        );
      })}
      {shown.length === 0 && <p className="small" style={{ padding: "8px 12px" }}>No notes match.</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- [[ link suggestions in the editor */
function useLinkSuggest(text: string, caret: number, paths: string[]) {
  const before = text.slice(0, caret);
  const m = /\[\[([^\]\n]*)$/.exec(before);
  const query = m ? m[1].toLowerCase() : null;
  const items = useMemo(() => {
    if (query === null) return [];
    return paths.filter((p) => p.toLowerCase().includes(query)).sort((a, b) => title(a).toLowerCase().indexOf(query) - title(b).toLowerCase().indexOf(query)).slice(0, 8);
  }, [query, paths]);
  return { open: query !== null && items.length > 0, items, start: m ? caret - m[1].length : caret, query };
}

/* ---------------------------------------------------------------- page */
function DocsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const path = params.get("path");
  const kbMode = params.get("kb") === "1";
  const graphMode = params.get("graph") === "1" || kbMode;

  const [tree, setTree] = useState<{ docs: TreeDoc[]; vault: string } | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [text, setText] = useState("");
  const [base, setBase] = useState<number | null>(null);
  const [save, setSave] = useState<Save>("saved");
  const [conflict, setConflict] = useState<{ version: number; content: string; updated_by: Who } | null>(null);
  const [remote, setRemote] = useState<Who | null>(null);
  const [mode, setMode] = useState<"edit" | "preview" | "split">("split");
  const [tab, setTab] = useState<"links" | "related" | "outline" | "history">("links");
  const [related, setRelated] = useState<{ path: string; items: any[]; source: any } | null>(null);
  const [hist, setHist] = useState<Version[] | null>(null);
  const [oldV, setOldV] = useState<{ version: number; content: string } | null>(null);
  const [graph, setGraph] = useState<{ nodes: any[]; edges: any[] } | null>(null);
  const [gview, setGview] = useState<"all" | "memory" | "notes">("all");
  const shown = (() => {
    if (!graph || gview === "all") return graph;
    const keep = (id: string) => (gview === "memory" ? id.startsWith("Memory/") : !id.startsWith("Memory/"));
    const nodes = graph.nodes.filter((n) => keep(n.id) || (n.missing && gview === "notes"));
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  })();
  const [q, setQ] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [side, setSide] = useState(true);
  const [creating, setCreating] = useState<{ name: string; folder: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ path: string; name: string; folder: string } | null>(null);
  const [caret, setCaret] = useState(0);
  const [sIdx, setSIdx] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ text, base, path, save });
  latest.current = { text, base, path, save };

  const paths = useMemo(() => (tree?.docs || []).map((d) => d.path), [tree]);
  const folders = useMemo(() => [...new Set((tree?.docs || []).map((d) => d.folder).filter((f) => f && f !== "Company"))].sort(), [tree]);
  const go = useCallback((q: Record<string, string>) => { router.push(`/docs/?${new URLSearchParams(q)}`); setListOpen(false); }, [router]);

  const loadTree = useCallback(async () => { try { setTree(await api("/vault")); } catch (e: any) { setErr(e.message); } }, []);
  const loadDoc = useCallback(async (p: string) => {
    try {
      const d = await api<Doc>(`/vault/read?path=${encodeURIComponent(p)}`);
      setDoc(d); setText(d.content); setBase(d.version); setSave("saved"); setConflict(null); setRemote(null); setOldV(null); setHist(null); setErr(null);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 404) { setDoc(null); setErr(null); } else setErr(e.message);
    }
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);
  useEffect(() => {
    if (kbMode) return;
    if (graphMode) { api<{ nodes: any[]; edges: any[] }>("/vault/graph").then(setGraph).catch((e) => setErr(e.message)); return; }
    if (!path) { if (tree && tree.docs.length) go({ path: tree.docs.find((d) => d.path === "Welcome.md")?.path || tree.docs[0].path }); return; }
    if (params.get("new") === "1" && tree && !tree.docs.some((d) => d.path.toLowerCase() === (path.endsWith(".md") ? path : `${path}.md`).toLowerCase())) {
      const t = path.replace(/\.md$/, "");
      api<{ path: string }>("/vault/write", { method: "PUT", body: { path: t, content: `# ${t.split("/").pop()}\n\n`, summary: "Created from a link" } })
        .then((r) => { loadTree(); go({ path: r.path }); }).catch((e) => setErr(e.message));
      return;
    }
    loadDoc(path);
  }, [path, graphMode, tree === null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tab !== "related" || !doc || related?.path === doc.path) return;
    api<{ source: any; related: any[] }>(`/kb/related-doc?path=${encodeURIComponent(doc.path)}`)
      .then((r) => setRelated({ path: doc.path, items: r.related, source: r.source })).catch(() => setRelated({ path: doc.path, items: [], source: null }));
  }, [tab, doc?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // save as you type (1.2 s after the last key), with the version this edit started from
  const doSave = useCallback(async (force = false) => {
    const { text: t, base: b, path: p } = latest.current;
    if (!p || !doc) return;
    setSave("saving");
    try {
      const r = await api<{ version: number; path: string }>("/vault/write", { method: "PUT", body: { path: p, content: t, base_version: force ? conflict?.version ?? b : b } });
      setBase(r.version); setConflict(null);
      setSave(latest.current.text === t ? "saved" : "dirty");
      loadTree();
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 409) {
        try { setConflict(JSON.parse(e.message).current); } catch { setConflict(null); }
        setSave("conflict");
      } else { setErr(e.message); setSave("error"); }
    }
  }, [doc, conflict, loadTree]);
  const edit = (v: string) => {
    setText(v); setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (latest.current.save !== "conflict") doSave(); }, 1200);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (latest.current.save === "dirty" || latest.current.save === "saving") { e.preventDefault(); } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // someone else (a helper, or Obsidian) changed the open doc
  usePoll(async () => {
    const t = await api<{ docs: TreeDoc[]; vault: string }>("/vault");
    setTree(t);
    const cur = latest.current;
    const d = t.docs.find((x) => x.path === cur.path);
    if (d && cur.base != null && d.version > cur.base) {
      if (cur.save === "saved") { await loadDoc(d.path); setRemote(d.updated_by); setTimeout(() => setRemote(null), 6000); }
      else setRemote(d.updated_by);
    }
  }, 8000, [loadDoc], (n) => n?.kind === "doc");

  useEffect(() => { if (tab === "history" && doc && !hist) api<Version[]>(`/vault/history?path=${encodeURIComponent(doc.path)}`).then(setHist).catch(() => {}); }, [tab, doc, hist]);

  // [[ suggestions
  const sug = useLinkSuggest(text, caret, paths);
  useEffect(() => setSIdx(0), [sug.query]);
  const insertLink = (p: string) => {
    const t = title(p);
    const name = paths.filter((x) => title(x).toLowerCase() === t.toLowerCase()).length > 1 ? p.replace(/\.md$/, "") : t;
    const after = text.slice(caret).startsWith("]]") ? text.slice(caret + 2) : text.slice(caret);
    const next = text.slice(0, sug.start) + name + "]]" + after;
    edit(next);
    const pos = sug.start + name.length + 2;
    setTimeout(() => { area.current?.focus(); area.current?.setSelectionRange(pos, pos); setCaret(pos); }, 0);
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); doSave(); return; }
    if (!sug.open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSIdx((i) => (i + 1) % sug.items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSIdx((i) => (i - 1 + sug.items.length) % sug.items.length); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertLink(sug.items[sIdx]); }
  };

  // preview: [[links]] become in-app links (dashed when the note does not exist yet)
  const previewText = useMemo(() => text.replace(LINK_RE, (_m, target: string, _h, alias?: string) => {
    const r = resolve(target, paths);
    const label = (alias || target).trim().replace(/[[\]]/g, "");
    return r ? `[${label}](${docHref(r)})` : `[${label}](${docHref(target.trim(), true)})`;
  }), [text, paths]);
  const onPreviewClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href") || "";
    if (href.startsWith("/docs/?")) { e.preventDefault(); e.stopPropagation(); router.push(href); }
  };
  const outline = useMemo(() => text.split("\n").map((l, i) => ({ m: /^(#{1,4})\s+(.+)/.exec(l), i })).filter((x) => x.m).map((x) => ({ level: x.m![1].length, text: x.m![2].replace(/[*`]/g, ""), line: x.i })), [text]);
  const jumpTo = (line: number) => {
    const el = area.current; if (!el) return;
    const pos = text.split("\n").slice(0, line).join("\n").length + (line ? 1 : 0);
    if (mode === "preview") setMode("split");
    setTimeout(() => { el.focus(); el.setSelectionRange(pos, pos); el.scrollTop = Math.max(0, (line - 3) * 21); }, 0);
  };

  const create = async () => {
    if (!creating?.name.trim()) return;
    const p = (creating.folder ? `${creating.folder.replace(/\/$/, "")}/` : "") + creating.name.trim();
    try {
      const r = await api<{ path: string }>("/vault/write", { method: "PUT", body: { path: p, content: `# ${creating.name.trim()}\n\n`, summary: "Created" } });
      setCreating(null); await loadTree(); go({ path: r.path });
    } catch (e: any) { setErr(e.message); }
  };
  const rename = async (newTitle: string) => {
    setRenaming(null);
    if (!doc || !newTitle.trim() || newTitle.trim() === doc.title) return;
    const folder = doc.path.includes("/") ? doc.path.slice(0, doc.path.lastIndexOf("/") + 1) : "";
    try { const r = await api<{ path: string; links_updated: number }>("/vault/move", { body: { path: doc.path, to: folder + newTitle.trim() } }); await loadTree(); go({ path: r.path }); }
    catch (e: any) { setErr(e.message); }
  };
  const remove = async () => {
    if (!doc || !(await confirmDialog({ title: `Delete “${doc.title}”?`, body: "It moves to the vault’s .trash folder, so you can still get it back.", confirm: "Delete", danger: true }))) return;
    await api("/vault/delete", { body: { path: doc.path } }); setDoc(null); await loadTree(); router.push("/docs/");
  };
  const restore = async (v: { version: number; content: string }) => {
    if (!doc) return;
    try {
      const r = await api<{ version: number }>("/vault/write", { method: "PUT", body: { path: doc.path, content: v.content, base_version: base, summary: `Restored version ${v.version}` } });
      setText(v.content); setBase(r.version); setOldV(null); setHist(null); setSave("saved"); loadTree();
    } catch (e: any) { setErr(e.message); }
  };

  // ---- actions on any note (right-click menus)
  const folderOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const moveNote = async () => {
    if (!moving || !moving.name.trim()) return;
    const to = (moving.folder.trim() ? `${moving.folder.trim().replace(/\/$/, "")}/` : "") + moving.name.trim();
    try {
      const r = await api<{ path: string }>("/vault/move", { body: { path: moving.path, to } });
      setMoving(null); await loadTree(); if (doc?.path === moving.path) go({ path: r.path });
    } catch (e: any) { setErr(e.message); }
  };
  const duplicate = async (p: string) => {
    try {
      const d = await api<Doc>(`/vault/read?path=${encodeURIComponent(p)}`);
      const r = await api<{ path: string }>("/vault/write", { method: "PUT", body: { path: `${folderOf(p) ? folderOf(p) + "/" : ""}${title(p)} copy`, content: d.content, summary: `Copy of ${title(p)}` } });
      await loadTree(); go({ path: r.path });
    } catch (e: any) { setErr(e.message); }
  };
  const deleteNote = async (p: string) => {
    if (!(await confirmDialog({ title: `Delete “${title(p)}”?`, body: "It moves to the vault’s .trash folder, so you can still get it back.", confirm: "Delete", danger: true }))) return;
    try { await api("/vault/delete", { body: { path: p } }); await loadTree(); if (doc?.path === p) { setDoc(null); router.push("/docs/"); } } catch (e: any) { setErr(e.message); }
  };
  const linkText = (p: string) => `[[${paths.filter((x) => title(x).toLowerCase() === title(p).toLowerCase()).length > 1 ? p.replace(/\.md$/, "") : title(p)}]]`;
  const noteMenu = (p: string, company = p.startsWith("Company/")): MenuItem[] => [
    { heading: title(p) },
    { label: "Open", icon: "ri-file-text-line", onSelect: () => go({ path: p }) },
    { label: "Open in a new tab", icon: "ri-external-link-line", onSelect: () => window.open(docHref(p), "_blank") },
    sep,
    { label: "Rename…", icon: "ri-edit-line", disabled: company, onSelect: () => setMoving({ path: p, name: title(p), folder: folderOf(p) }) },
    { label: "Move to folder…", icon: "ri-folder-transfer-line", disabled: company, onSelect: () => setMoving({ path: p, name: title(p), folder: folderOf(p) }) },
    { label: "Duplicate", icon: "ri-file-copy-2-line", onSelect: () => duplicate(p) },
    sep,
    { label: "Copy link", icon: "ri-links-line", hint: "[[ ]]", onSelect: () => copy(linkText(p)) },
    { label: "Copy path", icon: "ri-file-copy-line", onSelect: () => copy(p) },
    { label: "Show history", icon: "ri-history-line", onSelect: () => { go({ path: p }); setTab("history"); setSide(true); } },
    { label: "Show links", icon: "ri-arrow-left-right-line", onSelect: () => { go({ path: p }); setTab("links"); setSide(true); } },
    { label: "Show in graph", icon: "ri-share-circle-line", onSelect: () => router.push(`/docs/?graph=1&path=${encodeURIComponent(p)}`) },
    sep,
    { label: "Delete", icon: "ri-delete-bin-line", danger: true, disabled: company, onSelect: () => deleteNote(p) },
  ];
  const folderMenu = (f: string, collapsed: boolean, toggle: () => void): MenuItem[] => [
    { heading: f === "Company" ? "Company knowledge" : f },
    { label: "New note here", icon: "ri-file-add-line", onSelect: () => setCreating({ name: "", folder: f }) },
    { label: collapsed ? "Expand" : "Collapse", icon: collapsed ? "ri-arrow-down-s-line" : "ri-arrow-right-s-line", onSelect: toggle },
    { label: "Copy folder path", icon: "ri-file-copy-line", onSelect: () => copy(f) },
  ];
  const missingMenu = (t: string): MenuItem[] => [
    { heading: t },
    { label: "Create this note", icon: "ri-file-add-line", onSelect: () => go({ path: t, new: "1" }) },
    { label: "Copy link", icon: "ri-links-line", onSelect: () => copy(`[[${t}]]`) },
  ];

  const saveLabel = { saved: base ? `Saved · v${base}` : "Saved", dirty: "Editing…", saving: "Saving…", conflict: "Changed by someone else", error: "Not saved" }[save];

  return (
    <div className="ws docs">
      <div className="topbar topbar-v2">
        <button className="iconbtn hide-lg" aria-label="Show notes" onClick={() => setListOpen(!listOpen)}><i className="ri-menu-2-line" /></button>
        <span className="crumb">
          <i className="ri-book-2-line" />
          <span className="crumb-title">Docs</span>
          {doc && !graphMode && <span className="meta">· {doc.path.replace(/\.md$/, "").split("/").join(" / ")}</span>}
          {graphMode && <span className="meta">· {kbMode ? "Knowledge" : "Graph"}</span>}
        </span>
        <span className="sp" />
        {!graphMode && doc && (
          <span className={`dsave ${save}`}><i className={save === "saved" ? "ri-check-line" : save === "saving" ? "ri-loader-4-line" : save === "conflict" || save === "error" ? "ri-error-warning-line" : "ri-edit-line"} />{saveLabel}</span>
        )}
        <div className="seg" role="tablist" aria-label="Docs view">
          <button role="tab" aria-selected={!graphMode} className={!graphMode ? "on" : ""} onClick={() => go(doc ? { path: doc.path } : {})}><i className="ri-file-text-line" /> Notes</button>
          <button role="tab" aria-selected={graphMode && !kbMode} className={graphMode && !kbMode ? "on" : ""} onClick={() => go({ graph: "1" })}><i className="ri-share-circle-line" /> Graph</button>
          <button role="tab" aria-selected={kbMode} className={kbMode ? "on" : ""} onClick={() => go({ kb: "1" })}><i className="ri-database-2-line" /> Knowledge</button>
        </div>
        {!graphMode && doc && <button className="iconbtn" aria-label={side ? "Hide side panel" : "Show side panel"} onClick={() => setSide(!side)}><i className={side ? "ri-side-bar-fill" : "ri-side-bar-line"} /></button>}
      </div>

      <div className={`ws-body docs-body ${side && !graphMode && doc ? "panel" : ""}`}>
        <nav className={`ws-list docs-list-v2 ${listOpen ? "open" : ""}`} onContextMenu={menu(() => [{ label: "New note", icon: "ri-file-add-line", onSelect: () => setCreating({ name: "", folder: "" }) },
          { label: "Graph", icon: "ri-share-circle-line", onSelect: () => go({ graph: "1" }) }])}>
          <div className="dt-top dt-top-v2">
            <i className="ri-search-line dt-search-ic" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a note…" aria-label="Find a note" />
            <button className="iconbtn" aria-label="New note" title="New note" onClick={() => setCreating({ name: "", folder: doc?.path.includes("/") && !doc.company ? doc.path.slice(0, doc.path.lastIndexOf("/")) : "" })}><i className="ri-file-add-line" /></button>
          </div>
          {tree ? <Tree docs={tree.docs} current={doc?.path || null} q={q} onOpen={(p) => go({ path: p })} noteMenu={(d) => noteMenu(d.path, d.company)} folderMenu={folderMenu} /> : <p className="small" style={{ padding: 12 }}>Loading…</p>}
          {tree && <div className="dt-foot small" title={tree.vault}><i className="ri-folder-open-line" /><span className="mono">{tree.vault.split("/").slice(-2).join("/")}</span> · Obsidian</div>}
        </nav>

        <section className="ws-main docs-main">
          {kbMode ? (
            <Knowledge onOpenDoc={(p) => go({ path: p })} initialSource={params.get("source")} />
          ) : graphMode ? (
            <div className="docs-graph">
              <div className="seg dg-view" role="tablist" aria-label="Show">
                {([["all", "Everything"], ["memory", "Memory"], ["notes", "Notes only"]] as const).map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={gview === k} className={gview === k ? "on" : ""} onClick={() => setGview(k)}>
                    {k === "memory" && <i className="ri-brain-line" />}{l}</button>))}
              </div>
              {shown ? <DocGraph nodes={shown.nodes} edges={shown.edges} current={path} onOpen={(n) => go(n.missing ? { path: n.title, new: "1" } : { path: n.id })}
              onNodeMenu={(n) => (n.missing ? missingMenu(n.title) : noteMenu(n.id))} /> : <p className="small" style={{ padding: 20 }}>Loading…</p>}</div>
          ) : !doc ? (
            <div className="ws-inner"><div className="empty"><b>{path ? "This note does not exist" : "No note open"}</b><span>Pick one on the left, or start a new one.</span>
              <div style={{ marginTop: 12 }}><button className="btn primary" onClick={() => setCreating({ name: path ? title(path) : "", folder: "" })}><i className="ri-file-add-line" />New note</button></div></div></div>
          ) : (
            <div className="deditor">
              <div className="dhead dhead-v2">
                <div className="dhead-meta">
                  <div className="dmeta small">
                    <WhoBadge w={doc.updated_by} /><span>· {ago(doc.updated_at)}</span>
                    {doc.company && <span className="chip" style={{ marginLeft: 6 }}><i className="ri-building-2-line" />Company knowledge</span>}
                  </div>
                  <span className="sp" />
                  <div className="seg hide-sm dhead-seg" role="tablist" aria-label="Editor view">
                    {(["edit", "split", "preview"] as const).map((m) => <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{m === "edit" ? "Edit" : m === "split" ? "Both" : "Read"}</button>)}
                  </div>
                  {!doc.company && <button className="iconbtn" aria-label="Delete note" title="Delete" onClick={remove}><i className="ri-delete-bin-line" /></button>}
                </div>
                {renaming !== null ? (
                  <input className="dtitle-in" autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} onBlur={() => rename(renaming)}
                    onKeyDown={(e) => { if (e.key === "Enter") rename(renaming); if (e.key === "Escape") setRenaming(null); }} />
                ) : <h1 className="dtitle" title="Click to rename" onClick={() => !doc.company && setRenaming(doc.title)} onContextMenu={menu(() => noteMenu(doc.path, doc.company))}>{doc.title}</h1>}
                {conflict && (
                  <div className="callout warn dbanner"><i className="ri-error-warning-line" /><span><b>{whoLabel(conflict.updated_by)}</b> changed this note while you were editing.</span><span className="sp" />
                    <button className="btn sm" onClick={() => { setText(conflict.content); setBase(conflict.version); setConflict(null); setSave("saved"); }}>Use theirs</button>
                    <button className="btn sm primary" onClick={() => doSave(true)}>Keep mine</button></div>
                )}
                {remote && !conflict && (
                  <div className={`callout ${save === "saved" ? "" : "warn"} dbanner`}><i className="ri-refresh-line" />
                    <span>{save === "saved" ? <>Updated by <b>{whoLabel(remote)}</b>.</> : <><b>{whoLabel(remote)}</b> just changed this note. Saving now would conflict.</>}</span><span className="sp" />
                    {save !== "saved" && <button className="btn sm" onClick={() => loadDoc(doc.path)}>Load their version</button>}
                    <button className="iconbtn" aria-label="Dismiss" onClick={() => setRemote(null)}><i className="ri-close-line" /></button></div>
                )}
                {doc.suggestions.length > 0 && (
                  <div className="callout dbanner"><i className="ri-lightbulb-line" /><span>{doc.suggestions.length} suggested change{doc.suggestions.length > 1 ? "s" : ""} from {doc.suggestions.map((s) => s.by.name).join(", ")} wait{doc.suggestions.length > 1 ? "" : "s"} for your approval.</span><span className="sp" />
                    <button className="btn sm" onClick={() => router.push("/")}>Review in Inbox</button></div>
                )}
              </div>
              <div className={`dpanes ${mode}`}>
                {mode !== "preview" && (
                  <div className="dwrite">
                    <textarea ref={area} value={text} spellCheck onChange={(e) => { edit(e.target.value); setCaret(e.target.selectionStart); }}
                      onKeyDown={onKey} onKeyUp={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)} onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
                      placeholder="Write in Markdown. Type [[ to link another note." aria-label="Note text" />
                    {sug.open && (
                      <div className="lsug" role="listbox" aria-label="Link to a note">
                        <div className="lsug-h">Link to…</div>
                        {sug.items.map((p, i) => (
                          <button key={p} role="option" aria-selected={i === sIdx} className={`lsug-i ${i === sIdx ? "on" : ""}`} onMouseDown={(e) => { e.preventDefault(); insertLink(p); }} onMouseEnter={() => setSIdx(i)}>
                            <i className="ri-file-text-line" /><b>{title(p)}</b><span>{p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ""}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {mode !== "edit" && <div className="dread" onClickCapture={onPreviewClick} onContextMenuCapture={(e) => {
                  const a = (e.target as HTMLElement).closest("a"); const href = a?.getAttribute("href") || "";
                  if (!href.startsWith("/docs/?")) return;
                  const p = new URLSearchParams(href.split("?")[1]).get("path") || "";
                  menu(() => (href.includes("new=1") ? missingMenu(p) : noteMenu(p)))(e);
                }}><Markdown text={previewText} /></div>}
              </div>
            </div>
          )}
          <Err error={err} />
        </section>

        {side && !graphMode && doc && (
          <aside className="ws-panel dside docs-context-v2">
            <div className="ptabs docs-ptabs-v2">
              <div className="seg">
                <button className={tab === "links" ? "on" : ""} onClick={() => setTab("links")}>Links</button>
                <button className={tab === "outline" ? "on" : ""} onClick={() => setTab("outline")}>Outline</button>
                <button className={tab === "related" ? "on" : ""} onClick={() => setTab("related")} title="Knowledge close in meaning">Related</button>
                <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>History</button>
              </div>
            </div>
            <div className="pbody">
              {tab === "links" && (
                <>
                  <div className="ds-h">Links from here <span className="bcol-n" style={{ position: "static" }}>{doc.links.length}</span></div>
                  {doc.links.length === 0 ? <p className="small">No links yet. Type [[ in the note.</p> : doc.links.map((l) => (
                    <button key={l.target} className={`ds-link ${l.path ? "" : "missing"}`} onClick={() => go(l.path ? { path: l.path } : { path: l.target, new: "1" })}
                      onContextMenu={menu(() => (l.path ? noteMenu(l.path) : missingMenu(l.target)))}>
                      <b><i className={l.path ? "ri-file-text-line" : "ri-file-add-line"} />{l.path ? title(l.path) : l.target}</b>{!l.path && <span>Not written yet — click to create</span>}
                    </button>
                  ))}
                  <div className="ds-h" style={{ marginTop: 16 }}>Linked here <span className="bcol-n" style={{ position: "static" }}>{doc.backlinks.length}</span></div>
                  {doc.backlinks.length === 0 ? <p className="small">No other note links here yet. Type [[{doc.title}]] in any note.</p> : doc.backlinks.map((b) => (
                    <button key={b.path} className="ds-link" onClick={() => go({ path: b.path })} onContextMenu={menu(() => noteMenu(b.path))}><b><i className="ri-file-text-line" />{b.title}</b><span>{b.snippet}</span></button>
                  ))}
                </>
              )}
              {tab === "related" && (
                !related || related.path !== doc.path ? <p className="small">Looking…</p> : (
                  <>
                    <p className="small" style={{ marginTop: 0 }}>Knowledge close in meaning to this note: other docs, past jobs, chats, files and pages helpers would find with it.</p>
                    {related.items.length === 0 ? <p className="small">{related.source?.status === "pending" ? "This note is still being embedded." : "Nothing close yet."}</p> : related.items.map((r) => (
                      <button key={r.id} className="ds-link" onClick={() => (["doc", "memory", "context"].includes(r.kind) ? go({ path: r.ref }) : go({ kb: "1", source: r.id }))}>
                        <b><i className={{ doc: "ri-file-text-line", memory: "ri-brain-line", context: "ri-building-2-line", job: "ri-briefcase-4-line", chat: "ri-chat-3-line",
                          proposal: "ri-checkbox-circle-line", file: "ri-attachment-2", web: "ri-global-line", connector: "ri-plug-line", workflow: "ri-flow-chart", note: "ri-sticky-note-line" }[r.kind as string] || "ri-file-line"} />{r.title}</b>
                        <span>{r.kind_label} · {Math.round(r.similarity * 100)}% similar</span>
                        <i className="ds-sim"><i style={{ width: `${Math.max(4, Math.round(r.similarity * 100))}%` }} /></i>
                      </button>
                    ))}
                    {related.source && <button className="btn sm quiet" style={{ marginTop: 6 }} onClick={() => go({ kb: "1", source: related.source.id })}><i className="ri-database-2-line" />See it in Knowledge</button>}
                  </>
                )
              )}
              {tab === "outline" && (outline.length === 0 ? <p className="small">Headings (#, ##) show up here.</p> : (
                <div className="ds-outline">{outline.map((h, i) => <button key={i} style={{ paddingLeft: (h.level - 1) * 12 + 6 }} onClick={() => jumpTo(h.line)}>{h.text}</button>)}</div>
              ))}
              {tab === "history" && (
                oldV ? (
                  <div>
                    <div className="acts" style={{ marginBottom: 8 }}>
                      <button className="btn sm" onClick={() => setOldV(null)}><i className="ri-arrow-left-line" />All versions</button><span className="sp" />
                      <button className="btn sm primary" onClick={() => restore(oldV)}>Restore v{oldV.version}</button>
                    </div>
                    <div className="ds-old"><Markdown text={oldV.content} /></div>
                  </div>
                ) : !hist ? <p className="small">Loading…</p> : (
                  <div className="ds-hist">{hist.map((v) => (
                    <button key={v.version} className="ds-v" onClick={() => api<{ content: string }>(`/vault/version?path=${encodeURIComponent(doc.path)}&version=${v.version}`).then((r) => setOldV({ version: v.version, content: r.content }))}>
                      <span className="ds-vn mono">v{v.version}</span>
                      <span className="t"><b><WhoBadge w={v.by} /></b><span>{v.summary}</span></span>
                      <span className="small">{ago(v.at)}</span>
                    </button>
                  ))}</div>
                )
              )}
            </div>
          </aside>
        )}
      </div>

      <Drawer open={!!moving} onClose={() => setMoving(null)} icon={<i className="ri-folder-transfer-line" />} title={moving ? `Rename or move "${title(moving.path)}"` : ""}
        sub="Links to it in other notes update automatically."
        footer={<><span className="sp" /><button className="btn" onClick={() => setMoving(null)}>Cancel</button><button className="btn primary" disabled={!moving?.name.trim()} onClick={moveNote}>Save</button></>}>
        {moving && (
          <div className="dw-sec">
            <label style={{ marginTop: 0 }}>Name</label>
            <input value={moving.name} onChange={(e) => setMoving({ ...moving, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") moveNote(); }} />
            <label>Folder</label>
            <input list="doc-folders" value={moving.folder} onChange={(e) => setMoving({ ...moving, folder: e.target.value })} placeholder="(top level)" />
          </div>
        )}
      </Drawer>

      <Drawer open={!!creating} onClose={() => setCreating(null)} icon={<i className="ri-file-add-line" />} title="New note"
        footer={<><span className="sp" /><button className="btn" onClick={() => setCreating(null)}>Cancel</button><button className="btn primary" disabled={!creating?.name.trim()} onClick={create}>Create note</button></>}>
        {creating && (
          <div className="dw-sec">
            <label style={{ marginTop: 0 }}>Name</label>
            <input value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} placeholder="e.g. Launch plan" onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
            <label>Folder</label>
            <input list="doc-folders" value={creating.folder} onChange={(e) => setCreating({ ...creating, folder: e.target.value })} placeholder="(top level) or e.g. Projects" />
            <datalist id="doc-folders">{["Company", ...folders].map((f) => <option key={f} value={f} />)}</datalist>
            <p className="dw-help">Type a new folder name to make a folder. Notes in <b>Company</b> are company knowledge: every helper reads them, and helpers need your approval to change them.</p>
          </div>
        )}
      </Drawer>
    </div>
  );
}

export default function Docs() {
  return <Suspense fallback={<p className="small" style={{ padding: 24 }}>Loading…</p>}><DocsInner /></Suspense>;
}
