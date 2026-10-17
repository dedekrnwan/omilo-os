"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WfBlock, WfEdge, WfGraph, WfNode, WfStep } from "@/lib/api";

/* The workflow canvas: steps as cards, lines between them, top to bottom. Drag a card to move it, drag from a dot at the
   bottom of a card onto another card to connect them, drag the empty floor to pan, Ctrl/⌘ + wheel (or the buttons) to
   zoom. Click a line to select it, then Delete (or the × on it) removes it. Run results show as badges on the cards. */

export const NODE_W = 248;
export const NODE_H = 66;

const PORT_LABEL: Record<string, string> = { true: "True", false: "False", approved: "Approved", rejected: "Rejected" };
const STEP_BADGE: Record<string, [string, string]> = {
  done: ["ok", "Completed"], running: ["run", "Running"], waiting: ["warn", "Waiting"], failed: ["bad", "Failed"], skipped: ["idle", "Skipped"],
};

export function outPorts(b: WfBlock | undefined) { return b?.ports?.length ? b.ports : ["out"]; }

function portXY(n: WfNode, port: string, b: WfBlock | undefined): [number, number] {
  const ports = outPorts(b);
  const i = Math.max(0, ports.indexOf(port));
  return [n.x + (NODE_W * (i + 1)) / (ports.length + 1), n.y + NODE_H];
}

function curve(x1: number, y1: number, x2: number, y2: number) {
  const dy = Math.max(36, Math.abs(y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
}

export function summary(n: WfNode, b: WfBlock | undefined): string {
  const c = n.config || {};
  if (n.note) return n.note;
  switch (n.type) {
    case "trigger.schedule": return `Schedule · ${c.cron || ""}`;
    case "trigger.event": return `When ${String(c.event || "job.done").replace(".", " ")}`;
    case "app.http": return `${c.method || "GET"} ${c.url || "(no address)"}`;
    case "app.connector": return c.connector ? `${c.connector} · ${c.tool || "pick a tool"}` : "Pick a connector";
    case "ai.helper": return c.staff_id ? `Helper: ${c.staff_id}` : "Pick a helper";
    case "logic.if": {
      const op: Record<string, string> = { equals: "=", not_equals: "≠", gt: ">", lt: "<", contains: "contains", empty: "is empty", not_empty: "is not empty", matches: "matches" };
      const short = (v: any) => String(v ?? "").replace(/\{\{\s*|\s*\}\}/g, "").replace(/^steps\.|\.output/g, "");
      return `${short(c.left) || "?"} ${op[c.op || "equals"] || c.op} ${c.op === "empty" || c.op === "not_empty" ? "" : short(c.right)}`.trim();
    }
    case "saga.doc": return `Doc: ${c.path || "(pick a doc)"}`;
    case "saga.kpi": return `KPI: ${c.name || "(pick one)"}`;
    default: return b?.label || n.type;
  }
}

type Props = {
  graph: WfGraph; blocks: Record<string, WfBlock>; steps?: Record<string, WfStep>; selected?: string | null;
  onSelect?: (id: string | null) => void; onChange?: (g: WfGraph) => void; readOnly?: boolean; onDropBlock?: (type: string, x: number, y: number) => void;
  height?: number | string; fitKey?: string;
};

export default function Canvas({ graph, blocks, steps, selected, onSelect, onChange, readOnly, onDropBlock, height = "100%", fitKey }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 40, y: 30, k: 1 });
  const [edgeSel, setEdgeSel] = useState<number | null>(null);
  const [linking, setLinking] = useState<{ from: string; port: string; x: number; y: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ kind: "pan" | "node"; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const byId = useMemo(() => Object.fromEntries(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  const toWorld = useCallback((cx: number, cy: number) => {
    const r = box.current!.getBoundingClientRect();
    return [(cx - r.left - view.x) / view.k, (cy - r.top - view.y) / view.k] as [number, number];
  }, [view]);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el || !graph.nodes.length) return;
    const xs = graph.nodes.map((n) => n.x), ys = graph.nodes.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs) + NODE_W, minY = Math.min(...ys) - 26, maxY = Math.max(...ys) + NODE_H + 30;
    const r = el.getBoundingClientRect();
    const k = Math.min(1.1, Math.max(0.35, Math.min((r.width - 60) / (maxX - minX), (r.height - 60) / (maxY - minY))));
    setView({ k, x: (r.width - (maxX - minX) * k) / 2 - minX * k, y: Math.max(20, (r.height - (maxY - minY) * k) / 2) - minY * k });
  }, [graph.nodes]);
  // fit once per workflow (and when the box first gets a size)
  const fitted = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (fitted.current === (fitKey ?? "x") || !graph.nodes.length) return;
    fitted.current = fitKey ?? "x";
    requestAnimationFrame(fit);
  }, [fitKey, fit, graph.nodes.length]);

  useEffect(() => {
    if (readOnly) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && edgeSel !== null) {
        e.preventDefault();
        onChange?.({ ...graph, edges: graph.edges.filter((_, i) => i !== edgeSel) });
        setEdgeSel(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [edgeSel, graph, onChange, readOnly]);

  // wheel: pan; Ctrl/⌘ + wheel or pinch: zoom around the cursor
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        setView((v) => {
          const k = Math.min(2, Math.max(0.3, v.k * Math.exp(-e.deltaY * 0.01)));
          return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
        });
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  const down = (e: React.PointerEvent, id?: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const n = id ? byId[id] : null;
    drag.current = { kind: n && !readOnly ? "node" : "pan", id, sx: e.clientX, sy: e.clientY, ox: n && !readOnly ? n.x : view.x, oy: n && !readOnly ? n.y : view.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (!id) setEdgeSel(null);
  };
  const move = (e: React.PointerEvent) => {
    if (linking) {
      const [x, y] = toWorld(e.clientX, e.clientY);
      setLinking({ ...linking, x, y });
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-node]");
      setHover(el?.dataset.node && el.dataset.node !== linking.from ? el.dataset.node : null);
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.kind === "pan") setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    else if (d.id && d.moved) {
      const nx = Math.round((d.ox + dx / view.k) / 8) * 8, ny = Math.round((d.oy + dy / view.k) / 8) * 8;
      onChange?.({ ...graph, nodes: graph.nodes.map((n) => (n.id === d.id ? { ...n, x: nx, y: ny } : n)) });
    }
  };
  const up = (e: React.PointerEvent) => {
    if (linking) {
      const to = hover;
      if (to && !blocks[byId[to]?.type]?.trigger && !graph.edges.some((x) => x.from === linking.from && x.port === linking.port && x.to === to)) {
        onChange?.({ ...graph, edges: [...graph.edges, { from: linking.from, port: linking.port, to }] });
      }
      setLinking(null); setHover(null);
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) onSelect?.(d.id ?? null);
    void e;
  };
  const startLink = (e: React.PointerEvent, n: WfNode, port: string) => {
    if (readOnly || e.button !== 0) return;
    e.stopPropagation();
    box.current?.setPointerCapture?.(e.pointerId);
    const [x, y] = portXY(n, port, blocks[n.type]);
    setLinking({ from: n.id, port, x, y });
  };

  const zoom = (f: number) => setView((v) => {
    const r = box.current!.getBoundingClientRect();
    const px = r.width / 2, py = r.height / 2, k = Math.min(2, Math.max(0.3, v.k * f));
    return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
  });

  const edgeState = (e: WfEdge) => {
    const s = steps?.[e.from];
    if (!s || s.status !== "done") return "";
    return s.port === e.port ? "lit" : "dim";
  };

  return (
    <div ref={box} className={`wfc ${readOnly ? "ro" : ""} ${linking ? "linking" : ""}`} style={{ height }}
      onPointerDown={(e) => down(e)} onPointerMove={move} onPointerUp={up}
      onDragOver={(e) => { if (onDropBlock && e.dataTransfer.types.includes("application/x-saga-block")) e.preventDefault(); }}
      onDrop={(e) => {
        const t = e.dataTransfer.getData("application/x-saga-block");
        if (!t || !onDropBlock) return;
        e.preventDefault();
        const [x, y] = toWorld(e.clientX, e.clientY);
        onDropBlock(t, Math.round((x - NODE_W / 2) / 8) * 8, Math.round((y - NODE_H / 2) / 8) * 8);
      }}>
      <div className="wfc-grid" style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${20 * view.k}px ${20 * view.k}px` }} />
      <div className="wfc-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="wfc-lines" width="1" height="1" style={{ overflow: "visible" }}>
          {graph.edges.map((e, i) => {
            const a = byId[e.from], b = byId[e.to];
            if (!a || !b) return null;
            const [x1, y1] = portXY(a, e.port, blocks[a.type]);
            const x2 = b.x + NODE_W / 2, y2 = b.y;
            const d = curve(x1, y1, x2, y2);
            const st = edgeState(e);
            return (
              <g key={i} className={`wfc-edge ${edgeSel === i ? "sel" : ""} ${st}`}>
                <path d={d} className="hit" onPointerDown={(ev) => { ev.stopPropagation(); if (!readOnly) setEdgeSel(i); }} />
                <path d={d} className="ln" markerEnd="url(#wf-arrow)" />
                {edgeSel === i && !readOnly && (
                  <g className="wfc-x" transform={`translate(${(x1 + x2) / 2}, ${(y1 + y2) / 2})`}
                    onPointerDown={(ev) => { ev.stopPropagation(); onChange?.({ ...graph, edges: graph.edges.filter((_, j) => j !== i) }); setEdgeSel(null); }}>
                    <circle r="9" /><path d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5" />
                  </g>
                )}
              </g>
            );
          })}
          {linking && (() => {
            const a = byId[linking.from];
            const [x1, y1] = portXY(a, linking.port, blocks[a.type]);
            return <path className="wfc-temp" d={curve(x1, y1, linking.x, linking.y)} />;
          })()}
          <defs>
            <marker id="wf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
        </svg>
        {graph.nodes.map((n) => {
          const b = blocks[n.type];
          const s = steps?.[n.id];
          const badge = s ? (b?.trigger && s.status === "done" ? ["run", "Triggered"] : STEP_BADGE[s.status]) : null;
          const ports = outPorts(b);
          return (
            <div key={n.id} data-node={n.id} className={`wfn c-${b?.color || "slate"} ${selected === n.id ? "sel" : ""} ${hover === n.id ? "drop" : ""} ${s ? `st-${s.status}` : ""}`}
              style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
              onPointerDown={(e) => down(e, n.id)} title={s?.error || undefined}>
              {badge && <span className={`wfn-badge ${badge[0]}`}>{s?.status === "running" && <span className="spin" />}{badge[1]}</span>}
              {!b?.trigger && <span className="wfn-in" />}
              <span className="wfn-ic"><i className={b?.icon || "ri-question-line"} /></span>
              <span className="wfn-t">
                <b>{n.label || b?.label}</b>
                <span>{s?.status === "failed" && s.error ? s.error : s?.status === "waiting" ? `Waiting for ${s.waiting_for || "you"}` : summary(n, b)}</span>
              </span>
              {b?.ai && <span className="wfn-ai" title="Uses AI (costs tokens)"><i className="ri-sparkling-2-fill" /></span>}
              {ports.map((p) => {
                const i = ports.indexOf(p);
                return (
                  <span key={p} className={`wfn-out ${p !== "out" ? "named" : ""} ${s?.port === p && s.status === "done" ? "taken" : ""}`}
                    style={{ left: `${((i + 1) * 100) / (ports.length + 1)}%` }}
                    onPointerDown={(e) => startLink(e, n, p)} title={readOnly ? undefined : "Drag to connect"}>
                    {p !== "out" && <em>{PORT_LABEL[p] || p}</em>}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="wfc-zoom" onPointerDown={(e) => e.stopPropagation()}>
        <button className="iconbtn" aria-label="Zoom in" onClick={() => zoom(1.2)}><i className="ri-add-line" /></button>
        <button className="iconbtn" aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}><i className="ri-subtract-line" /></button>
        <button className="iconbtn" aria-label="Fit" onClick={fit}><i className="ri-fullscreen-line" /></button>
      </div>
      {!readOnly && <div className="wfc-hint">Drag from a dot to connect · Ctrl/⌘ + scroll to zoom</div>}
    </div>
  );
}
