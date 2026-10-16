"use client";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { useEffect, useMemo, useRef, useState } from "react";

/* The graph view: every doc is a dot, every [[link]] a line. Colour shows who changed the doc last (you, a helper,
   or outside Saga OS); hollow dots are links to docs that do not exist yet. Drag to move, scroll to zoom, click to open. */

export type GNode = { id: string; title: string; folder: string; degree: number; by: string; missing?: boolean };
export type GEdge = { source: string; target: string };
type N = GNode & SimulationNodeDatum;
type L = { source: N; target: N };

// first three categorical slots (validated all-pairs); missing = hollow neutral
export const BY_COLOR: Record<string, string> = { owner: "#2a78d6", agent: "#eb6834", outside: "#1baf7a", missing: "#a8a29e" };
export const BY_LABEL: Record<string, string> = { owner: "You", agent: "A helper", outside: "Outside Saga OS", missing: "Not written yet" };

export default function DocGraph({ nodes, edges, current, onOpen }: { nodes: GNode[]; edges: GEdge[]; current?: string | null; onOpen: (n: GNode) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [, setTick] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const sim = useRef<ReturnType<typeof forceSimulation<N>> | null>(null);
  const drag = useRef<{ node?: N; pan?: { x: number; y: number; vx: number; vy: number }; moved?: boolean } | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver((e) => setSize({ w: Math.max(300, e[0].contentRect.width), h: Math.max(320, e[0].contentRect.height) }));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => {
    const ns: N[] = nodes.map((n) => ({ ...n }));
    const byId = new Map(ns.map((n) => [n.id, n]));
    const ls: L[] = edges.filter((e) => byId.has(e.source) && byId.has(e.target)).map((e) => ({ source: byId.get(e.source)!, target: byId.get(e.target)! }));
    return { ns, ls, byId };
  }, [nodes, edges]);

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of data.ls) {
      (m.get(l.source.id) || m.set(l.source.id, new Set()).get(l.source.id)!).add(l.target.id);
      (m.get(l.target.id) || m.set(l.target.id, new Set()).get(l.target.id)!).add(l.source.id);
    }
    return m;
  }, [data]);

  useEffect(() => {
    const s = forceSimulation<N>(data.ns)
      .force("link", forceLink<N, any>(data.ls).id((d: any) => d.id).distance(70).strength(0.6))
      .force("charge", forceManyBody().strength(-320))
      .force("collide", forceCollide<N>().radius((d) => 22 + Math.sqrt(d.degree) * 3))
      .force("x", forceX(0).strength(0.04)).force("y", forceY(0).strength(0.06))
      .force("center", forceCenter(0, 0))
      .alphaDecay(0.03)
      .on("tick", () => setTick((t) => t + 1));
    sim.current = s;
    return () => { s.stop(); };
  }, [data]);

  const r = (n: N) => 4 + Math.min(10, Math.sqrt(n.degree) * 2.4);
  const toWorld = (cx: number, cy: number) => {
    const rect = box.current!.getBoundingClientRect();
    return { x: (cx - rect.left - size.w / 2 - view.x) / view.k, y: (cy - rect.top - size.h / 2 - view.y) / view.k };
  };
  const hit = (cx: number, cy: number) => {
    const p = toWorld(cx, cy);
    let best: N | undefined, bd = Infinity;
    for (const n of data.ns) {
      const d = Math.hypot((n.x || 0) - p.x, (n.y || 0) - p.y);
      if (d < Math.max(12, r(n) + 6) / Math.min(1, view.k) && d < bd) { best = n; bd = d; }
    }
    return best;
  };

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const n = hit(e.clientX, e.clientY);
    if (n) { drag.current = { node: n, moved: false }; n.fx = n.x; n.fy = n.y; sim.current?.alphaTarget(0.25).restart(); }
    else drag.current = { pan: { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y } };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) { setHover(hit(e.clientX, e.clientY)?.id || null); return; }
    if (d.node) { const p = toWorld(e.clientX, e.clientY); d.node.fx = p.x; d.node.fy = p.y; d.moved = true; }
    else if (d.pan) setView((v) => ({ ...v, x: d.pan!.vx + e.clientX - d.pan!.x, y: d.pan!.vy + e.clientY - d.pan!.y }));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.node) {
      sim.current?.alphaTarget(0);
      d.node.fx = null; d.node.fy = null;
      if (!d.moved) onOpen(d.node);
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    const k = Math.max(0.3, Math.min(3, view.k * (e.deltaY < 0 ? 1.12 : 0.89)));
    setView((v) => ({ ...v, k }));
  };

  const focus = hover || current || null;
  const near = focus ? neighbors.get(focus) || new Set<string>() : null;
  const dim = (id: string) => !!near && id !== focus && !near.has(id);
  const labels = view.k >= 0.8 || data.ns.length < 40;

  return (
    <div className="dgraph" ref={box} onWheel={onWheel}>
      <svg width={size.w} height={size.h} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { setHover(null); if (drag.current?.pan) drag.current = null; }}
        role="img" aria-label={`Graph of ${data.ns.length} docs and ${data.ls.length} links`} style={{ cursor: hover ? "pointer" : drag.current?.pan ? "grabbing" : "grab" }}>
        <g transform={`translate(${size.w / 2 + view.x},${size.h / 2 + view.y}) scale(${view.k})`}>
          {data.ls.map((l, i) => (
            <line key={i} x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y}
              className={`dg-e ${focus && (l.source.id === focus || l.target.id === focus) ? "on" : ""} ${focus && !(l.source.id === focus || l.target.id === focus) ? "dim" : ""}`} />
          ))}
          {data.ns.map((n) => (
            <g key={n.id} transform={`translate(${n.x || 0},${n.y || 0})`} className={`dg-n ${dim(n.id) ? "dim" : ""} ${n.id === current ? "cur" : ""}`}>
              <circle r={r(n)} fill={n.missing ? "#fff" : BY_COLOR[n.by] || BY_COLOR.owner} stroke={n.missing ? BY_COLOR.missing : "#fff"}
                strokeWidth={n.missing ? 1.5 : 2} strokeDasharray={n.missing ? "2 2" : undefined} />
              {n.id === current && <circle r={r(n) + 4} fill="none" stroke="#0c0a09" strokeWidth={1.5} />}
              {(labels || n.id === focus || near?.has(n.id)) && (
                <text y={r(n) + 12} textAnchor="middle" className="dg-t">{n.title.length > 28 ? n.title.slice(0, 27) + "…" : n.title}</text>
              )}
            </g>
          ))}
        </g>
      </svg>
      <div className="dg-legend">
        {Object.entries(BY_LABEL).map(([k, l]) => (
          <span key={k} className="lg-i"><span className="dg-k" style={k === "missing" ? { border: `1.5px dashed ${BY_COLOR.missing}` } : { background: BY_COLOR[k] }} />{l}</span>
        ))}
        <span className="small">· colour = who changed it last</span>
      </div>
      <div className="dg-zoom">
        <button className="iconbtn" aria-label="Zoom in" onClick={() => setView((v) => ({ ...v, k: Math.min(3, v.k * 1.25) }))}><i className="ri-add-line" /></button>
        <button className="iconbtn" aria-label="Zoom out" onClick={() => setView((v) => ({ ...v, k: Math.max(0.3, v.k / 1.25) }))}><i className="ri-subtract-line" /></button>
        <button className="iconbtn" aria-label="Fit" onClick={() => setView({ x: 0, y: 0, k: 1 })}><i className="ri-focus-3-line" /></button>
      </div>
      {data.ns.length === 0 && <div className="chart-empty" style={{ inset: 0 }}>No docs yet.</div>}
    </div>
  );
}
