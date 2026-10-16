"use client";
import { useEffect, useRef, useState } from "react";
import { Mascot } from "@/components/Avatar";
import { BASE } from "@/lib/api";

/* The sign-in pages show a corner of the office with a few helpers going about their day: they walk (and sometimes
   run) between their desks, the plan board, the approvals desk and the sofa, sit and type, and chat with each other.
   Click the floor and the nearest one runs there; click one and it hops. This is a picture of the product, not live
   data (you are not signed in yet). On the account page, a new mascot with your name walks in and takes a desk. */

const T = 32;
const REG = { x: 0, y: 0, w: 768, h: 1024 };  // the part of the office map shown: Leadership, Marketing, the hall, Support, Engineering
type P = { x: number; y: number };
type Look = { color: string; shape: string; prop: string; image: null };
type W = {
  id: string; name: string; look: Look; lines: string[];
  pos: P; path: P[]; speed: number; state: "walk" | "sit" | "idle"; until: number; dir: 1 | -1; seat: P | null; home: P;
  el?: HTMLDivElement | null; bub?: HTMLSpanElement | null; glow?: HTMLSpanElement | null; bubbleUntil: number;
};
const L = (color: string, shape: string, prop: string): Look => ({ color, shape, prop, image: null });
const CREW: { id: string; name: string; look: Look; lines: string[] }[] = [
  { id: "chief", name: "Chief of Staff", look: L("#6366f1", "blob", "crown"), lines: ["Morning brief is ready", "Two things need your OK", "On it!", "Handing this to Marketing"] },
  { id: "marketing", name: "Marketing", look: L("#14b8a6", "blob", "megaphone"), lines: ["Draft post ready", "Posting at 9am?", "New caption idea!", "Can you review this?"] },
  { id: "sales", name: "Sales", look: L("#f97316", "box", "tie"), lines: ["New lead found", "Following up today", "Sent you a draft"] },
  { id: "support", name: "Support", look: L("#ec4899", "bean", "headset"), lines: ["3 tickets answered", "Updating the FAQ", "Happy customer!"] },
  { id: "finance", name: "Finance", look: L("#a16207", "bean", "coin"), lines: ["Revenue is up", "KPIs updated", "Invoice drafted"] },
  { id: "dev", name: "Dev", look: L("#0ea5e9", "box", "glasses"), lines: ["Build is green", "Fixed a bug", "Shipping soon"] },
];

type MapData = { grid: boolean[][]; seats: (P & { mx: number; my: number })[]; spots: P[]; zones: { id: string; title: string; x: number; y: number }[]; door: P };

async function loadMap(): Promise<MapData> {
  const m = await fetch(`${BASE}/office/hq.json`).then((r) => r.json());
  const solid = new Set<number>();
  for (const t of m.tilesets[0].tiles || []) if ((t.properties || []).some((p: any) => p.name === "collides" && p.value)) solid.add(t.id + 1);
  const layer = (n: string) => m.layers.find((l: any) => l.name === n);
  const walls = layer("walls").data as number[], furn = layer("furniture").data as number[];
  const grid = Array.from({ length: m.height }, (_, y) => Array.from({ length: m.width }, (_, x) => !solid.has(walls[y * m.width + x]) && !solid.has(furn[y * m.width + x])));
  const inReg = (o: P) => o.x >= REG.x + 8 && o.x <= REG.x + REG.w - 8 && o.y >= REG.y + 8 && o.y <= REG.y + REG.h - 8;
  const prop = (o: any, k: string) => (o.properties || []).find((p: any) => p.name === k)?.value;
  const objs = (n: string) => (layer(n)?.objects || []) as any[];
  const seats = objs("seats").filter(inReg).map((o) => ({ x: o.x, y: o.y, mx: prop(o, "monitor_x"), my: prop(o, "monitor_y") }));
  const spots = [...objs("spots").filter(inReg).map((o) => ({ x: o.x, y: o.y })),
    ...objs("interactive").filter((o) => inReg({ x: o.x + o.width / 2, y: o.y + o.height + 16 })).map((o) => ({ x: o.x + o.width / 2, y: o.y + o.height + 16 }))];
  const zones = objs("zones").filter((o) => inReg({ x: o.x + 20, y: o.y + 20 })).map((o) => ({ id: o.name, title: prop(o, "title") || o.name, x: o.x, y: o.y }));
  const lead = objs("zones").find((o) => o.name === "leadership");
  const door = lead ? { x: prop(lead, "door_x") * T + T / 2, y: (prop(lead, "door_y") + 1) * T + T / 2 } : { x: 200, y: 450 };
  return { grid, seats, spots, zones, door };
}

function path(grid: boolean[][], a: P, b: P): P[] {
  const H = grid.length, Wd = grid[0].length;
  const sx = Math.floor(a.x / T), sy = Math.floor(a.y / T), ex = Math.floor(b.x / T), ey = Math.floor(b.y / T);
  const ok = (x: number, y: number) => x >= 0 && y >= 0 && x < Wd && y < H && (grid[y][x] || (x === ex && y === ey));
  const prev = new Int32Array(Wd * H).fill(-1);
  const q = [sy * Wd + sx]; prev[q[0]] = q[0];
  while (q.length) {
    const c = q.shift()!;
    if (c === ey * Wd + ex) break;
    const cx = c % Wd, cy = (c / Wd) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy, ni = ny * Wd + nx;
      if (ok(nx, ny) && prev[ni] < 0) { prev[ni] = c; q.push(ni); }
    }
  }
  if (prev[ey * Wd + ex] < 0) return [b];
  const cells: number[] = [];
  for (let c = ey * Wd + ex; c !== sy * Wd + sx; c = prev[c]) cells.push(c);
  return [...cells.reverse().map((c) => ({ x: (c % Wd) * T + T / 2, y: ((c / Wd) | 0) * T + T / 2 })).slice(0, -1), b];
}

const rnd = <X,>(xs: X[]) => xs[Math.floor(Math.random() * xs.length)];

export default function OfficeLobby({ you, sign }: { you?: string; sign?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapData | null>(null);
  const [view, setView] = useState({ s: 1, ox: 0, oy: 0 });
  const walkers = useRef<W[]>([]);
  const [, setTick] = useState(0);
  const youRef = useRef<W | null>(null);

  useEffect(() => { loadMap().then(setMap).catch(() => {}); }, []);
  // cover the panel with the region, centred
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const s = Math.max(el.clientWidth / REG.w, el.clientHeight / REG.h);
      setView({ s, ox: (el.clientWidth - REG.w * s) / 2, oy: (el.clientHeight - REG.h * s) / 2 });
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the crew, each with its own desk
  useEffect(() => {
    if (!map || walkers.current.length) return;
    const seats = [...map.seats].sort(() => Math.random() - 0.5);
    walkers.current = CREW.map((c, i) => {
      const seat = seats[i % seats.length];
      return { ...c, pos: { x: seat.x, y: seat.y }, path: [], speed: 70, state: "sit" as const, until: performance.now() + 1500 + Math.random() * 5000, dir: 1 as const,
        seat, home: seat, bubbleUntil: 0 };
    });
    setTick((n) => n + 1);
  }, [map]);

  // you: on the account page, a new mascot with your name walks in from the hall and takes a desk
  useEffect(() => {
    if (!map) return;
    const name = (you || "").trim();
    if (!name) { if (youRef.current) { walkers.current = walkers.current.filter((w) => w !== youRef.current); youRef.current = null; setTick((n) => n + 1); } return; }
    if (youRef.current) { youRef.current.name = name; if (youRef.current.el) (youRef.current.el.querySelector(".lw-tag") as HTMLElement).textContent = name; return; }
    const taken = new Set(walkers.current.map((w) => `${w.home.x},${w.home.y}`));
    const seat = map.seats.find((s) => !taken.has(`${s.x},${s.y}`)) || map.seats[0];
    const w: W = { id: "you", name, look: L("#f59e0b", "bean", "sprout"), lines: ["Hello, team!", "Nice desk!"], pos: { ...map.door }, path: path(map.grid, map.door, seat),
      speed: 90, state: "walk", until: 0, dir: 1, seat: null, home: seat, bubbleUntil: 0 };
    youRef.current = w;
    walkers.current = [...walkers.current, w];
    setTick((n) => n + 1);
    setTimeout(() => say(w, "Hello, team!", 2600), 300);
  }, [you, map]);

  const say = (w: W, text: string, ms = 2400) => {
    if (!w.bub) return;
    w.bub.textContent = text; w.bub.classList.add("on"); w.bubbleUntil = performance.now() + ms;
  };

  // the life loop
  useEffect(() => {
    if (!map) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, last = performance.now();
    const pickNext = (w: W, now: number) => {
      const r = Math.random();
      const others = walkers.current.filter((o) => o !== w);
      let target: P;
      if (r < 0.42) target = w.home;
      else if (r < 0.62) target = rnd(map.spots);
      else if (r < 0.8 && others.length) { const o = rnd(others); target = { x: o.pos.x + (Math.random() < 0.5 ? T : -T), y: o.pos.y + T }; }
      else {
        let t: P | null = null;
        for (let k = 0; k < 20 && !t; k++) {
          const x = Math.floor((REG.x + 32 + Math.random() * (REG.w - 64)) / T), y = Math.floor((REG.y + 32 + Math.random() * (REG.h - 64)) / T);
          if (map.grid[y]?.[x]) t = { x: x * T + T / 2, y: y * T + T / 2 };
        }
        target = t || w.home;
      }
      w.path = path(map.grid, w.pos, target);
      w.speed = Math.random() < 0.2 ? 150 : 62 + Math.random() * 20;
      w.state = "walk"; w.seat = null;
      if (Math.random() < 0.35) say(w, rnd(w.lines));
      void now;
    };
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      for (const w of walkers.current) {
        if (w.state === "walk") {
          const p = w.path[0];
          if (!p) {
            const atHome = Math.hypot(w.pos.x - w.home.x, w.pos.y - w.home.y) < 4;
            w.state = atHome ? "sit" : "idle"; w.seat = atHome ? w.home : null;
            w.until = now + (atHome ? 4000 + Math.random() * 7000 : 1800 + Math.random() * 3200);
            if (!atHome && Math.random() < 0.5) say(w, rnd(w.lines));
          } else {
            const dx = p.x - w.pos.x, dy = p.y - w.pos.y, d = Math.hypot(dx, dy), step = w.speed * dt;
            if (Math.abs(dx) > 0.5) w.dir = dx > 0 ? 1 : -1;
            if (d <= step) { w.pos = { ...p }; w.path.shift(); } else { w.pos = { x: w.pos.x + (dx / d) * step, y: w.pos.y + (dy / d) * step }; }
          }
        } else if (now > w.until && !reduce) pickNext(w, now);
        if (w.el) {
          w.el.style.transform = `translate(${w.pos.x}px, ${w.pos.y}px)`;
          w.el.style.zIndex = String(10 + Math.round(w.pos.y));
          w.el.dataset.state = w.state === "walk" ? (w.speed > 120 ? "run" : "walk") : w.state;
          w.el.style.setProperty("--dir", String(w.dir));
        }
        if (w.glow) {
          const s = w.state === "sit" ? map.seats.find((x) => x.x === w.home.x && x.y === w.home.y) : null;
          w.glow.style.opacity = s ? "1" : "0";
          if (s) w.glow.style.transform = `translate(${s.mx - 10}px, ${s.my - 4}px)`;
        }
        if (w.bub && w.bubbleUntil && now > w.bubbleUntil) { w.bub.classList.remove("on"); w.bubbleUntil = 0; }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const vis = () => { last = performance.now(); };
    document.addEventListener("visibilitychange", vis);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", vis); };
  }, [map]);

  // click the floor: the nearest helper runs there
  const onFloor = (e: React.MouseEvent) => {
    if (!map || (e.target as HTMLElement).closest(".lw")) return;
    const r = box.current!.getBoundingClientRect();
    const x = (e.clientX - r.left - view.ox) / view.s + REG.x, y = (e.clientY - r.top - view.oy) / view.s + REG.y;
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    const ring = document.createElement("span");
    ring.className = "lw-ring"; ring.style.transform = `translate(${x}px, ${y}px)`;
    box.current!.querySelector(".lw-world")?.appendChild(ring);
    setTimeout(() => ring.remove(), 600);
    if (!map.grid[ty]?.[tx]) return;
    const near = [...walkers.current].sort((a, b) => Math.hypot(a.pos.x - x, a.pos.y - y) - Math.hypot(b.pos.x - x, b.pos.y - y))[0];
    if (!near) return;
    near.path = path(map.grid, near.pos, { x: tx * T + T / 2, y: ty * T + T / 2 });
    near.speed = 160; near.state = "walk"; near.seat = null;
    say(near, "On it!", 1600);
  };
  const onWalker = (w: W) => say(w, rnd(w.lines));

  return (
    <div className="lobby" ref={box} onClick={onFloor} aria-hidden>
      <div className="lw-world" style={{ width: REG.w, height: REG.h, transform: `translate(${view.ox}px, ${view.oy}px) scale(${view.s})`,
        backgroundImage: `url(${BASE}/office/hq.png)`, backgroundPosition: `${-REG.x}px ${-REG.y}px` }}>
        {map?.zones.map((z) => <span key={z.id} className="lw-zone" style={{ left: z.x + 8, top: z.y + 6 }}>{z.id === "leadership" && sign ? sign : z.title}</span>)}
        {walkers.current.map((w) => (
          <span key={`g-${w.id}`} className="lw-glow" ref={(el) => { w.glow = el; }} />
        ))}
        {walkers.current.map((w) => (
          <div key={w.id} className={`lw ${w.id === "you" ? "you" : ""}`} ref={(el) => { w.el = el; }} onClick={() => onWalker(w)}>
            <span className="lw-shadow" />
            <span className="lw-feet"><i /><i /></span>
            <span className="lw-body"><Mascot look={w.look as any} size={44} bare /></span>
            <span className="lw-tag">{w.name}</span>
            <span className="lw-bub" ref={(el) => { w.bub = el; }} />
          </div>
        ))}
      </div>
    </div>
  );
}
