"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import Drawer from "@/components/Drawer";
import { Markdown } from "@/components/Markdown";
import { Err } from "@/components/ui";
import { BASE, api } from "@/lib/api";
import { confirmDialog } from "@/lib/dialog";
import { menu } from "@/lib/menu";
import { openTask, openThread } from "@/lib/open";
import { usePoll } from "@/lib/poll";

/* Docs → Knowledge: everything the helpers can find with `recall`, stored in Postgres with pgvector.
   - Map: every piece of knowledge as a dot, placed by meaning (the two main directions of the embeddings), so related
     things sit together. Search, and the query lands on the map with lines to what a helper would get back.
   - Sources: each doc, job, chat, approved proposal, file, web page and connector entry, with its pieces.
   - Searches: what helpers (and workflows) looked up, and what came back.
   Settings choose the embedding model: on this computer (default), Voyage AI or OpenAI. */

type Kind = { kind: string; label: string; icon: string; count: number };
type Stats = { sources: number; chunks: number; embedded: number; pending: number; by_kind: Kind[]; searches_7d: number; error: string | null;
  embedder: { ok: boolean; provider?: string; model?: string; dim?: number; label?: string; error?: string } };
type Source = { id: string; kind: string; kind_label: string; ref: string; title: string; url: string; staff_id: string; staff_name?: string; meta: any;
  chars: number; chunks: number; status: string; error: string; updated_at: string | null; indexed_at: string | null };
type Detail = Source & { chunk_list: { id: number; ord: number; heading: string; text: string; embedded: boolean }[]; related: (Source & { similarity: number })[];
  retrieved: { query: string; who: string; at: string; via: string }[] };
type Hit = { chunk_id: number; source_id: string; kind: string; title: string; ref: string; url: string; heading: string; text: string; score: number;
  meaning: number | null; words: number | null };
type MapData = { points: { id: number; s: string; o: number; h: string; t: string; x: number; y: number }[]; sources: Record<string, { title: string; kind: string; ref: string }>;
  error?: string; model?: string };
type Query = { id: string; at: string; who: string; who_name: string; task_id: string; via: string; query: string; mode: string; ms: number;
  results: { source_id: string; title: string; kind: string; score: number }[] };

export const KIND_COLOR: Record<string, string> = {
  doc: "#2563eb", memory: "#9333ea", context: "#0f766e", job: "#ea580c", chat: "#0891b2", proposal: "#16a34a",
  file: "#a16207", web: "#db2777", connector: "#4f46e5", workflow: "#7c3aed", note: "#64748b",
};
const KIND_ICON: Record<string, string> = {
  doc: "ri-file-text-line", memory: "ri-brain-line", context: "ri-building-2-line", job: "ri-briefcase-4-line", chat: "ri-chat-3-line",
  proposal: "ri-checkbox-circle-line", file: "ri-attachment-2", web: "ri-global-line", connector: "ri-plug-line", workflow: "ri-flow-chart", note: "ri-sticky-note-line",
};
const plain = (t: string) => t.replace(/\*\*|__|`|^#+\s*/gm, "").replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2");
const ago = (iso: string | null) => {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};

function KMap({ data, hits, point, kinds, onOpen }: { data: MapData; hits: Hit[] | null; point: { x: number; y: number } | null; kinds: Set<string>;
  onOpen: (sid: string) => void }) {
  const [hover, setHover] = useState<{ p: MapData["points"][0]; x: number; y: number } | null>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const hitChunks = useMemo(() => new Set((hits || []).map((h) => h.chunk_id)), [hits]);
  const W = 1000, H = 640, pad = 40;
  const sx = (x: number) => pad + ((x + 1) / 2) * (W - pad * 2), sy = (y: number) => pad + ((1 - y) / 2) * (H - pad * 2);
  const shown = data.points.filter((p) => !kinds.size || kinds.has(data.sources[p.s]?.kind));
  const byChunk = useMemo(() => Object.fromEntries(data.points.map((p) => [p.id, p])), [data.points]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
      setView((v) => {
        const k = Math.min(8, Math.max(1, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  if (!data.points.length) {
    return <div className="km-empty"><i className="ri-bubble-chart-line" /><b>The map appears once there is some knowledge</b>
      <span>{data.error || "Write docs, finish jobs, upload files or save web pages. Each piece becomes a dot here, placed by what it means."}</span></div>;
  }
  return (
    <div ref={box} className="km" onMouseLeave={() => setHover(null)}
      onPointerDown={(e) => { drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !box.current) return;
        const r = box.current.getBoundingClientRect();
        setView((v) => ({ ...v, x: d.ox + ((e.clientX - d.sx) / r.width) * W, y: d.oy + ((e.clientY - d.sy) / r.height) * H }));
      }}
      onPointerUp={() => { drag.current = null; }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Map of the knowledge base by meaning">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {point && hits && hits.map((h) => {
            const p = byChunk[h.chunk_id];
            return p ? <line key={`l${h.chunk_id}`} className="km-ray" x1={sx(point.x)} y1={sy(point.y)} x2={sx(p.x)} y2={sy(p.y)} strokeWidth={1.4 / view.k} /> : null;
          })}
          {shown.map((p) => {
            const kind = data.sources[p.s]?.kind || "doc";
            const hit = hitChunks.has(p.id);
            return (
              <circle key={p.id} cx={sx(p.x)} cy={sy(p.y)} r={(hit ? 7 : 4.2) / Math.sqrt(view.k)} fill={KIND_COLOR[kind] || "#64748b"}
                className={`km-dot ${hits && !hit ? "dim" : ""} ${hit ? "hit" : ""}`}
                onMouseEnter={(e) => setHover({ p, x: e.clientX, y: e.clientY })} onMouseMove={(e) => setHover({ p, x: e.clientX, y: e.clientY })}
                onClick={(e) => { e.stopPropagation(); onOpen(p.s); }} />
            );
          })}
          {point && (
            <g transform={`translate(${sx(point.x)} ${sy(point.y)}) scale(${1 / Math.sqrt(view.k)})`} className="km-q">
              <circle r="11" /><path d="M0 -6 L1.8 -1.8 L6 0 L1.8 1.8 L0 6 L-1.8 1.8 L-6 0 L-1.8 -1.8 Z" />
            </g>
          )}
        </g>
      </svg>
      {hover && box.current && (() => {
        const r = box.current.getBoundingClientRect();
        const s = data.sources[hover.p.s];
        return (
          <div className="km-tip" style={{ left: Math.min(hover.x - r.left + 14, r.width - 290), top: Math.min(hover.y - r.top + 14, r.height - 120) }}>
            <b><i className={KIND_ICON[s?.kind] || "ri-file-line"} style={{ color: KIND_COLOR[s?.kind] }} />{s?.title}</b>
            {hover.p.h && hover.p.h !== s?.title && <em>{hover.p.h}</em>}
            <span>{plain(hover.p.t)}…</span>
          </div>
        );
      })()}
      <div className="km-legend small">Closer dots mean similar meaning · scroll to zoom, drag to move{view.k > 1 && <> · <button className="linkbtn" onClick={() => setView({ k: 1, x: 0, y: 0 })}>reset</button></>}</div>
    </div>
  );
}

function Settings({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [s, setS] = useState<any>(null);
  const [form, setForm] = useState<{ provider: string; model: string; api_key: string }>({ provider: "local", model: "", api_key: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<any>("/kb/settings").then((x) => { setS(x); setForm({ provider: x.current.provider || "local", model: x.current.model || "", api_key: "" }); }).catch((e) => setErr(e.message));
  }, []);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api("/kb/settings", { method: "PUT", body: { provider: form.provider, model: form.model || null, api_key: form.api_key || null } }); onChanged(); onClose(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const reindex = async () => {
    if (!(await confirmDialog({ title: "Re-embed all knowledge?", body: "Every piece is embedded again in the background. Search keeps working by words meanwhile.", confirm: "Re-embed" }))) return;
    await api("/kb/reindex", { body: {} }); onChanged();
  };
  const p = s?.providers?.[form.provider];
  return (
    <Drawer open onClose={onClose} icon={<i className="ri-settings-3-line" />} title="Knowledge settings" sub="How text becomes vectors for search by meaning."
      footer={<><button className="btn quiet" onClick={reindex}><i className="ri-refresh-line" />Re-embed everything</button><span className="sp" />
        <button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !s} onClick={save}>{busy ? "Checking…" : "Save"}</button></>}>
      {!s ? <div className="dw-sec"><p className="small">Loading…</p><Err error={err} /></div> : (
        <div className="dw-sec">
          <label style={{ marginTop: 0 }}>Embedding model runs</label>
          {Object.entries(s.providers as Record<string, any>).filter(([k]) => k !== "hash" || form.provider === "hash").map(([k, v]) => (
            <div key={k} className="togrow" onClick={() => setForm({ provider: k, model: Object.keys(v.models)[0], api_key: "" })}>
              <span className="t"><b>{v.label}</b><span>{k === "local" ? "Free and private. Downloads once (~220 MB), then works offline. Understands Indonesian."
                : k === "voyage" ? "Anthropic's recommended embeddings. Best quality; billed by Voyage per token." : k === "openai" ? "text-embedding-3. Cheap and good; billed by OpenAI." : "Word matching only."}</span></span>
              <span className={`switch ${form.provider === k ? "on" : ""}`} role="radio" aria-checked={form.provider === k}><i /></span>
            </div>
          ))}
          {p && (
            <>
              <label>Model</label>
              <select value={form.model || Object.keys(p.models)[0]} onChange={(e) => setForm({ ...form, model: e.target.value })}>
                {Object.entries(p.models as Record<string, string>).map(([m, l]) => <option key={m} value={m}>{l}</option>)}
              </select>
              {p.needs_key && (
                <>
                  <label>API key</label>
                  <input type="password" autoComplete="off" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                    placeholder={s.keys[form.provider] ? `Saved: …${s.keys[form.provider]}` : "Paste the key"} />
                  <p className="dw-help">Stored encrypted; only the last 4 characters are shown again.</p>
                </>
              )}
            </>
          )}
          {s.current.provider === "local" && s.current.local?.error && <div className="error" style={{ marginTop: 12 }}>{s.current.local.error}</div>}
          <p className="dw-help" style={{ marginTop: 14 }}>Switching re-embeds everything in the background; search by words keeps working meanwhile.
            Now: <b>{s.current.provider}</b> · {s.current.model}{s.current.dim ? ` · ${s.current.dim} dims` : ""}</p>
          <Err error={err} />
        </div>
      )}
    </Drawer>
  );
}

export default function Knowledge({ onOpenDoc, initialSource }: { onOpenDoc: (path: string) => void; initialSource?: string | null }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [tab, setTab] = useState<"map" | "sources" | "searches">("map");
  const [kinds, setKinds] = useState<Set<string>>(new Set());
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [sources, setSources] = useState<{ total: number; sources: Source[] } | null>(null);
  const [queries, setQueries] = useState<Query[] | null>(null);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ mode: string; results: Hit[]; ms: number; point?: { x: number; y: number } | null } | null>(null);
  const [open, setOpen] = useState<Detail | null>(null);
  const [adding, setAdding] = useState<"web" | "note" | null>(null);
  const [form, setForm] = useState({ url: "", title: "", text: "" });
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const fileIn = useRef<HTMLInputElement>(null);

  const kindParam = [...kinds].join(",");
  const loadStats = useCallback(() => api<Stats>("/kb/stats").then(setStats).catch((e) => setErr(e.message)), []);
  const loadTab = useCallback(() => {
    if (tab === "map") api<MapData>("/kb/map").then(setMapData).catch((e) => setErr(e.message));
    if (tab === "sources") api<{ total: number; sources: Source[] }>(`/kb/sources?limit=200${kindParam ? `&kind=${kindParam}` : ""}${filter ? `&q=${encodeURIComponent(filter)}` : ""}`).then(setSources).catch((e) => setErr(e.message));
    if (tab === "searches") api<Query[]>("/kb/queries?limit=100").then(setQueries).catch((e) => setErr(e.message));
  }, [tab, kindParam, filter]);
  usePoll(loadStats, () => (stats?.pending ? 3000 : 20000), [loadStats]);
  useEffect(() => { loadTab(); }, [loadTab]);
  useEffect(() => { if (stats && stats.pending === 0 && tab === "map") loadTab(); }, [stats?.pending]); // eslint-disable-line react-hooks/exhaustive-deps
  const openSource = useCallback(async (sid: string) => {
    try { setOpen(await api<Detail>(`/kb/sources/${sid}`)); } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { if (initialSource) openSource(initialSource); }, [initialSource, openSource]);

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!q.trim()) { setRes(null); return; }
    setBusy("search");
    try { setRes(await api(`/kb/search?q=${encodeURIComponent(q)}&k=8&project=true${kindParam ? `&kinds=${kindParam}` : ""}`)); setTab((t) => (t === "searches" ? "map" : t)); }
    catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy("file"); setErr(null);
    try {
      for (const f of Array.from(files)) {
        const data = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = bad; r.readAsDataURL(f); });
        await api("/kb/files", { body: { name: f.name, data } });
      }
      loadStats(); loadTab();
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); if (fileIn.current) fileIn.current.value = ""; }
  };
  const add = async () => {
    setBusy("add"); setErr(null);
    try {
      const s = adding === "web" ? await api<Source>("/kb/web", { body: { url: form.url } }) : await api<Source>("/kb/notes", { body: { title: form.title, text: form.text } });
      setAdding(null); setForm({ url: "", title: "", text: "" }); loadStats(); loadTab(); openSource(s.id);
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  const origin = (s: Source) => {
    if (["doc", "memory", "context"].includes(s.kind)) return { label: "Open the doc", icon: "ri-file-text-line", go: () => onOpenDoc(s.ref) };
    if (s.kind === "job") return { label: "Open the job", icon: "ri-briefcase-4-line", go: () => openTask(s.ref) };
    if (s.kind === "chat") return { label: "Open the chat", icon: "ri-chat-3-line", go: () => openThread(s.ref) };
    if (s.kind === "proposal" && s.meta?.task_id) return { label: "Open the job", icon: "ri-briefcase-4-line", go: () => openTask(s.meta.task_id, "approvals") };
    if (s.url && /^https?:/.test(s.url)) return { label: "Open the page", icon: "ri-external-link-line", go: () => window.open(s.url, "_blank", "noopener") };
    if (s.kind === "file" && s.url) return { label: "Download", icon: "ri-download-2-line", go: () => window.open(`${BASE}${s.url}?download=true`, "_blank") };
    return null;
  };
  const remove = async (s: Source) => {
    if (!(await confirmDialog({ title: `Forget “${s.title}”?`, body: "Helpers won't find it any more. The original (file, page, job) is not touched.", confirm: "Forget it", danger: true }))) return;
    try { await api(`/kb/sources/${s.id}`, { method: "DELETE" }); setOpen(null); loadStats(); loadTab(); } catch (e: any) { setErr(e.message); }
  };
  const toggleKind = (k: string) => setKinds((s) => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x; });
  const pct = stats && stats.chunks ? Math.round((stats.embedded / stats.chunks) * 100) : 0;

  return (
    <div className="kb">
      <div className="kb-top">
        <div className="kb-stats">
          <div><b>{stats?.sources ?? "–"}</b><span>sources</span></div>
          <div><b>{stats?.chunks ?? "–"}</b><span>pieces</span></div>
          <div title={`${stats?.embedded ?? 0} of ${stats?.chunks ?? 0} pieces have an embedding`}><b>{stats ? `${pct}%` : "–"}</b><span>by meaning</span>
            {stats && stats.pending > 0 && <i className="kb-bar"><i style={{ width: `${pct}%` }} /></i>}</div>
          <div><b>{stats?.searches_7d ?? "–"}</b><span>searches this week</span></div>
        </div>
        <span className="sp" />
        {stats && (
          <button className={`chip ${stats.embedder.ok && !stats.error ? "outline" : "warn"} kb-model`} onClick={() => setSettings(true)} title="Embedding settings">
            <i className={stats.embedder.ok && !stats.error ? "ri-cpu-line" : "ri-error-warning-line"} />
            {stats.embedder.ok ? `${stats.embedder.label} · ${(stats.embedder.model || "").split("/").pop()}` : "Embeddings off"}
            {stats.pending > 0 && <span className="spin" style={{ width: 10, height: 10, borderWidth: 1.5 }} />}
          </button>
        )}
        <button className="btn sm" onClick={menu(() => [
          { heading: "Add knowledge" },
          { label: "Upload files (PDF, Word, text, CSV)", icon: "ri-upload-2-line", onSelect: () => fileIn.current?.click() },
          { label: "Save a web page", icon: "ri-global-line", onSelect: () => setAdding("web") },
          { label: "Write a note", icon: "ri-sticky-note-line", onSelect: () => setAdding("note") },
        ])} disabled={!!busy}><i className="ri-add-line" />{busy === "file" ? "Reading…" : "Add"}</button>
        <input ref={fileIn} type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.csv,.json,.html,.htm,.yaml,.yml,.log" onChange={(e) => upload(e.target.files)} />
      </div>
      {(stats?.error || (stats && !stats.embedder.ok)) && (
        <div className="callout warn kb-warn"><i className="ri-error-warning-line" /><span>{stats.error || stats.embedder.error} Search still works by words.</span>
          <span className="sp" /><button className="btn sm" onClick={() => setSettings(true)}>Settings</button></div>
      )}

      <form className="kb-search" onSubmit={search}>
        <i className="ri-search-2-line" />
        <input value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setRes(null); }} placeholder="Search like a helper would: “why do customers cancel?”" aria-label="Search the knowledge base" />
        {res && <button type="button" className="iconbtn" aria-label="Clear" onClick={() => { setQ(""); setRes(null); }}><i className="ri-close-line" /></button>}
        <button className="btn sm primary" disabled={busy === "search" || !q.trim()}>Search</button>
      </form>

      <div className="kb-kinds">
        {(stats?.by_kind || []).filter((k) => k.count).map((k) => (
          <button key={k.kind} className={`kb-kind ${kinds.has(k.kind) ? "on" : ""} ${kinds.size && !kinds.has(k.kind) ? "off" : ""}`} onClick={() => toggleKind(k.kind)}>
            <i className="kb-sw" style={{ background: KIND_COLOR[k.kind] }} /><i className={k.icon} />{k.label}<span>{k.count}</span></button>
        ))}
        {kinds.size > 0 && <button className="linkbtn small" onClick={() => setKinds(new Set())}>show all</button>}
        <span className="sp" />
        <div className="seg">
          {([["map", "Map", "ri-bubble-chart-line"], ["sources", "Sources", "ri-list-unordered"], ["searches", "Searches", "ri-history-line"]] as const).map(([k, l, ic]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}><i className={ic} /> {l}</button>))}
        </div>
      </div>
      <Err error={err} />

      <div className={`kb-body ${res ? "with-res" : ""}`}>
        <div className="kb-main">
          {tab === "map" && (mapData ? <KMap data={mapData} hits={res?.results || null} point={res?.point || null} kinds={kinds} onOpen={openSource} /> : <p className="small">Loading the map…</p>)}
          {tab === "sources" && (
            <div className="kb-list">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by title or address" aria-label="Filter sources" />
              {!sources ? <p className="small">Loading…</p> : sources.sources.length === 0 ? <p className="small" style={{ padding: 12 }}>Nothing here yet.</p> : sources.sources.map((s) => (
                <button key={s.id} className="kb-src" onClick={() => openSource(s.id)} onContextMenu={menu(() => {
                  const o = origin(s);
                  return [{ heading: s.title }, { label: "Open", icon: "ri-eye-line", onSelect: () => openSource(s.id) }, o && { label: o.label, icon: o.icon, onSelect: o.go },
                    !["doc", "memory", "context"].includes(s.kind) && { label: "Forget it", icon: "ri-delete-bin-line", danger: true, onSelect: () => remove(s) }];
                })}>
                  <i className={KIND_ICON[s.kind]} style={{ color: KIND_COLOR[s.kind] }} />
                  <span className="t"><b>{s.title}</b><span>{s.kind_label}{s.staff_name ? ` · ${s.staff_name}` : ""} · {s.chunks} piece{s.chunks === 1 ? "" : "s"} · {ago(s.updated_at)}</span></span>
                  {s.status !== "ready" && <span className={`chip ${s.status === "failed" ? "down" : "idle"}`}>{s.status === "pending" ? "Embedding…" : s.status}</span>}
                </button>
              ))}
              {sources && sources.total > sources.sources.length && <p className="small">Showing {sources.sources.length} of {sources.total}. Filter to find more.</p>}
            </div>
          )}
          {tab === "searches" && (
            <div className="kb-list">
              {!queries ? <p className="small">Loading…</p> : queries.length === 0 ? <p className="small" style={{ padding: 12 }}>No searches yet. Helpers search with recall before they start a job.</p> : queries.map((x) => (
                <div key={x.id} className="kb-qrow">
                  <div className="kb-qh">
                    {x.who === "owner" ? <i className="ri-user-line" /> : x.who.startsWith("workflow:") ? <i className="ri-flow-chart" /> : <Avatar who={{ id: x.who, name: x.who_name } as any} size={18} />}
                    <b>{x.who_name}</b><span className="kb-qq">“{x.query}”</span><span className="sp" />
                    <span className="small">{x.mode === "words" ? "words only" : "meaning + words"} · {x.ms} ms · {ago(x.at)}</span>
                    {x.task_id && <button className="iconbtn" aria-label="Open the job" onClick={() => openTask(x.task_id)}><i className="ri-briefcase-4-line" /></button>}
                    <button className="iconbtn" aria-label="Search again" title="Search again" onClick={() => { setQ(x.query); setTimeout(() => document.querySelector<HTMLFormElement>(".kb-search")?.requestSubmit(), 0); }}><i className="ri-search-2-line" /></button>
                  </div>
                  <div className="kb-qres">{x.results.length === 0 ? <span className="small">Found nothing</span> : x.results.map((r, i) => (
                    <button key={i} className="kb-chipsrc" onClick={() => openSource(r.source_id)}><i className={KIND_ICON[r.kind]} style={{ color: KIND_COLOR[r.kind] }} />{r.title}</button>))}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {res && (
          <aside className="kb-res">
            <div className="kb-res-h"><b>What a helper would get</b><span className="small">{res.results.length} pieces · {res.mode === "hybrid" ? "meaning + words" : "words only"} · {res.ms} ms</span></div>
            {res.results.length === 0 ? <p className="small">Nothing found. Try other words.</p> : res.results.map((h, i) => (
              <button key={h.chunk_id} className="kb-hit" onClick={() => openSource(h.source_id)}>
                <span className="kb-hit-n">{i + 1}</span>
                <span className="t">
                  <b><i className={KIND_ICON[h.kind]} style={{ color: KIND_COLOR[h.kind] }} />{h.title}</b>
                  {h.heading && h.heading !== h.title && <em>{h.heading.replace(`${h.title} › `, "")}</em>}
                  <span>{plain(h.text).slice(0, 220)}{h.text.length > 220 ? "…" : ""}</span>
                  <span className="kb-score">{h.meaning != null && <span title="Similarity in meaning (cosine)"><i className="ri-bubble-chart-line" />{h.meaning.toFixed(2)}</span>}
                    {h.words != null && <span title="Word match rank"><i className="ri-text" />{h.words.toFixed(2)}</span>}</span>
                </span>
              </button>
            ))}
          </aside>
        )}
      </div>

      <Drawer open={!!open} onClose={() => setOpen(null)} wide icon={open ? <i className={KIND_ICON[open.kind]} style={{ color: KIND_COLOR[open.kind] }} /> : null}
        title={open?.title || ""} sub={open ? `${open.kind_label}${open.staff_name ? ` · ${open.staff_name}` : ""} · ${open.chunks} pieces · ${open.chars.toLocaleString()} characters` : ""}
        footer={open && <>
          {!["doc", "memory", "context"].includes(open.kind) && <button className="btn quiet" onClick={() => remove(open)}><i className="ri-delete-bin-line" />Forget</button>}
          <button className="btn quiet" onClick={async () => { await api(`/kb/sources/${open.id}/reindex`, { body: {} }); loadStats(); openSource(open.id); }}><i className="ri-refresh-line" />Re-embed</button>
          <span className="sp" />
          {(() => { const o = origin(open); return o ? <button className="btn" onClick={o.go}><i className={o.icon} />{o.label}</button> : null; })()}
          <button className="btn" onClick={() => setOpen(null)}>Close</button></>}>
        {open && (
          <>
            {open.retrieved.length > 0 && (
              <div className="dw-sec"><h3 style={{ margin: "0 0 8px" }}>Found by</h3>
                {open.retrieved.slice(0, 6).map((r, i) => <p key={i} className="small" style={{ margin: "2px 0" }}><b>{r.who === "owner" ? "You" : r.who}</b> searching “{r.query}” · {ago(r.at)}</p>)}</div>
            )}
            {open.related.length > 0 && (
              <div className="dw-sec"><h3 style={{ margin: "0 0 8px" }}>Close in meaning</h3>
                <div className="kb-rel">{open.related.map((r) => (
                  <button key={r.id} className="kb-chipsrc" onClick={() => openSource(r.id)} title={`similarity ${r.similarity}`}>
                    <i className={KIND_ICON[r.kind]} style={{ color: KIND_COLOR[r.kind] }} />{r.title}<em>{Math.round(r.similarity * 100)}%</em></button>))}</div>
              </div>
            )}
            <div className="dw-sec">
              <h3 style={{ margin: "0 0 8px" }}>Pieces <span className="small">(what search returns)</span></h3>
              {open.chunk_list.map((c) => (
                <div key={c.id} className="kb-chunk">
                  <div className="kb-chunk-h"><span className="mono">#{c.ord + 1}</span>{c.heading && c.heading !== open.title && <b>{c.heading.replace(`${open.title} › `, "")}</b>}
                    <span className="sp" /><span className={`bc-dot ${c.embedded ? "ok" : "off"}`} title={c.embedded ? "Embedded" : "Waiting to be embedded"} /></div>
                  <div className="kb-chunk-t"><Markdown text={c.text} /></div>
                </div>
              ))}
            </div>
          </>
        )}
      </Drawer>

      <Drawer open={!!adding} onClose={() => setAdding(null)} icon={<i className={adding === "web" ? "ri-global-line" : "ri-sticky-note-line"} />}
        title={adding === "web" ? "Save a web page" : "Write a note"} sub={adding === "web" ? "Its readable text is saved; helpers find it with recall." : "Facts, policies, answers: anything helpers should know."}
        footer={<><span className="sp" /><button className="btn" onClick={() => setAdding(null)}>Cancel</button>
          <button className="btn primary" disabled={busy === "add" || (adding === "web" ? !/^https?:\/\//.test(form.url) : !form.title.trim() || !form.text.trim())} onClick={add}>{busy === "add" ? "Saving…" : "Save"}</button></>}>
        <div className="dw-sec">
          {adding === "web" ? (
            <><label style={{ marginTop: 0 }}>Address</label><input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" /></>
          ) : (
            <><label style={{ marginTop: 0 }}>Title</label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Return policy" />
              <label>Text</label><textarea rows={10} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></>
          )}
          <Err error={err} />
        </div>
      </Drawer>
      {settings && <Settings onClose={() => setSettings(false)} onChanged={() => { loadStats(); loadTab(); }} />}
    </div>
  );
}
