"use client";
import { useEffect, useState } from "react";
import { BASE, api } from "@/lib/api";

/* Each helper gets its own little character: an original mascot drawn in SVG, always the same for that helper
   (colour and shape come from its id), with a prop that hints at its job. The owner can change colour, shape and
   prop, or upload a picture, on the helper's page. */

export type Look = { color?: string; shape?: string; prop?: string; image?: string | null };
type Who = { id: string; name?: string; role?: string; is_chief?: boolean };

export const COLORS = ["#6366f1", "#14b8a6", "#f97316", "#ec4899", "#8b5cf6", "#0ea5e9", "#65a30d", "#f59e0b", "#ef4444", "#64748b", "#a16207", "#06b6d4"];
export const SHAPES = ["blob", "box", "bean"] as const;
export const PROPS: Record<string, string> = {
  crown: "Crown", glasses: "Glasses", headset: "Headset", megaphone: "Megaphone", tie: "Tie", coin: "Coin", gear: "Gear",
  antenna: "Antenna", sprout: "Sprout", beret: "Beret", magnifier: "Magnifier", none: "Nothing",
};

const hash = (s: string) => {
  let h = 2166136261;
  for (const c of "f" + s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16; // mix, so similar ids get different colours
  return h >>> 0;
};

export function propFor(w: Who): string {
  if (w.is_chief) return "crown";
  const k = `${w.role || ""} ${w.name || ""}`.toLowerCase();
  const rules: [RegExp, string][] = [
    [/support|customer|success|help ?desk/, "headset"], [/market|brand|social|content|seo|growth hack|community/, "megaphone"],
    [/sales|account exec|deal|partner|business dev/, "tie"], [/financ|account|bookkeep|tax|invest|cfo/, "coin"],
    [/ops|operation|devops|infra|sre|platform|logistic/, "gear"], [/dev|engineer|code|frontend|backend|mobile|qa|test|security/, "glasses"],
    [/design|ux|ui|brand|creative|art/, "beret"], [/research|analy|data|insight|strateg/, "magnifier"],
    [/grow|garden|sustain/, "sprout"], [/build|maker|product/, "antenna"],
  ];
  for (const [re, p] of rules) if (re.test(k)) return p;
  return "antenna";
}

export function lookFor(w: Who, custom?: Look | null): Required<Omit<Look, "image">> & { image: string | null } {
  const h = hash(w.id || w.name || "x");
  return {
    color: custom?.color || COLORS[h % COLORS.length],
    shape: custom?.shape || SHAPES[(h >> 4) % SHAPES.length],
    prop: custom?.prop || propFor(w),
    image: custom?.image || null,
  };
}

/* ---------------------------------------------------------- custom looks (shared cache, one request per page load) */
let cache: Record<string, Look> | null = null;
let pending: Promise<Record<string, Look>> | null = null;
const subs = new Set<(c: Record<string, Look>) => void>();

export function useLooks(): Record<string, Look> {
  const [c, setC] = useState<Record<string, Look>>(cache || {});
  useEffect(() => {
    subs.add(setC);
    if (!cache) {
      pending = pending || api<Record<string, Look>>("/avatars").then((r) => { cache = r; return r; }).catch(() => ({}));
      pending.then((r) => setC(r));
    }
    return () => { subs.delete(setC); };
  }, []);
  return c;
}

export async function saveLook(id: string, look: Look | null) {
  const r = await api<Record<string, Look>>(`/staff/${id}/avatar`, { method: "PUT", body: look || {} });
  cache = r;
  subs.forEach((f) => f(r));
}

/* ---------------------------------------------------------- drawing */
function Body({ shape, color }: { shape: string; color: string }) {
  if (shape === "box") return <rect x="13" y="17" width="38" height="52" rx="13" fill={color} />;
  if (shape === "bean") return <ellipse cx="32" cy="44" rx="20" ry="27" fill={color} />;
  return <path d="M10 70 C10 34 19 16 32 16 C45 16 54 34 54 70 Z" fill={color} />;
}

function Face({ sleeping }: { sleeping: boolean }) {
  return (
    <g>
      {sleeping ? (
        <g stroke="#1c1917" strokeWidth="2.2" strokeLinecap="round" fill="none"><path d="M22 35 Q25 37.5 28 35" /><path d="M36 35 Q39 37.5 42 35" /></g>
      ) : (
        <g>
          <circle cx="25" cy="34" r="3.6" fill="#1c1917" /><circle cx="39" cy="34" r="3.6" fill="#1c1917" />
          <circle cx="26.2" cy="32.8" r="1.2" fill="#fff" /><circle cx="40.2" cy="32.8" r="1.2" fill="#fff" />
        </g>
      )}
      <path d={sleeping ? "M29.5 44 Q32 45.5 34.5 44" : "M27.5 42.5 Q32 47 36.5 42.5"} stroke="#1c1917" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <circle cx="20.5" cy="41" r="2.6" fill="#fff" opacity=".3" /><circle cx="43.5" cy="41" r="2.6" fill="#fff" opacity=".3" />
    </g>
  );
}

const INK = "#1c1917";
function Prop({ prop }: { prop: string }) {
  switch (prop) {
    case "crown": return <path d="M21 19 L23.5 8.5 L28.5 14 L32 7 L35.5 14 L40.5 8.5 L43 19 Z" fill="#facc15" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />;
    case "glasses": return <g stroke={INK} strokeWidth="2" fill="#fff" fillOpacity=".25"><circle cx="25" cy="34" r="6" /><circle cx="39" cy="34" r="6" /><path d="M31 34 h2" /></g>;
    case "headset": return <g stroke={INK} strokeWidth="2.6" fill="none" strokeLinecap="round"><path d="M14 36 A18 18 0 0 1 50 36" /><rect x="10.5" y="33" width="6" height="10" rx="3" fill={INK} /><rect x="47.5" y="33" width="6" height="10" rx="3" fill={INK} /><path d="M50 42 Q48 50 38 50" strokeWidth="2" /><circle cx="37" cy="50" r="2" fill={INK} /></g>;
    case "megaphone": return <g stroke={INK} strokeWidth="1.6" strokeLinejoin="round"><path d="M45 47 L58 40 L58 56 L45 50 Z" fill="#fff" /><rect x="41" y="46" width="5" height="6" rx="1.5" fill="#fff" /></g>;
    case "tie": return <path d="M29.5 51 h5 l-1 3 l3 9 l-4.5 4 l-4.5 -4 l3 -9 Z" fill="#dc2626" stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />;
    case "coin": return <g><circle cx="50" cy="52" r="8" fill="#facc15" stroke={INK} strokeWidth="1.6" /><text x="50" y="56" textAnchor="middle" fontSize="11" fontWeight="700" fill={INK} fontFamily="ui-sans-serif, system-ui">$</text></g>;
    case "gear": return <g transform="translate(50 52)"><path d="M-2 -9 h4 l1 3 l3 -1.5 l2.6 2.6 l-1.5 3 l3 1 v4 l-3 1 l1.5 3 l-2.6 2.6 l-3 -1.5 l-1 3 h-4 l-1 -3 l-3 1.5 l-2.6 -2.6 l1.5 -3 l-3 -1 v-4 l3 -1 l-1.5 -3 l2.6 -2.6 l3 1.5 Z" fill="#e7e5e4" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" /><circle r="2.6" fill={INK} /></g>;
    case "antenna": return <g><path d="M32 16 V8" stroke={INK} strokeWidth="2.2" strokeLinecap="round" /><circle cx="32" cy="7" r="3" fill="#f43f5e" stroke={INK} strokeWidth="1.4" /></g>;
    case "sprout": return <g stroke={INK} strokeWidth="1.5" strokeLinejoin="round"><path d="M32 17 V10" fill="none" strokeWidth="2" /><path d="M32 12 C26 12 23 8 23 5 C29 5 32 8 32 12 Z" fill="#4ade80" /><path d="M32 11 C37 11 40 7.5 40 5 C35 5 32 7.5 32 11 Z" fill="#22c55e" /></g>;
    case "beret": return <g><path d="M17 22 C17 13 47 11 49 20 C49 24 17 26 17 22 Z" fill="#1c1917" /><circle cx="33" cy="12.5" r="2" fill="#1c1917" /></g>;
    case "magnifier": return <g stroke={INK} strokeLinecap="round"><circle cx="49" cy="49" r="6.5" fill="#fff" fillOpacity=".7" strokeWidth="2.2" /><path d="M53.5 53.5 L59 59" strokeWidth="3" /></g>;
    default: return null;
  }
}

export function Mascot({ look, size = 32, sleeping = false, title }: { look: ReturnType<typeof lookFor>; size?: number; sleeping?: boolean; title?: string }) {
  if (look.image) return <img className="mascot img" src={look.image.startsWith("fil_") ? `${BASE}/api/files/${look.image}` : look.image} alt={title || ""} width={size} height={size} />;
  return (
    <svg className="mascot" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title || "helper"}>
      <defs><clipPath id="tile"><rect width="64" height="64" rx="18" /></clipPath></defs>
      <g clipPath="url(#tile)">
        <rect width="64" height="64" fill={look.color} opacity=".16" />
        <Body shape={look.shape} color={look.color} />
        <Face sleeping={sleeping} />
        <Prop prop={look.prop} />
      </g>
    </svg>
  );
}

/** A helper's avatar. `state` adds a working glow or sleeping eyes. */
export default function Avatar({ who, size = 32, state }: { who: Who | undefined | null; size?: number; state?: "working" | "sleeping" | null }) {
  const looks = useLooks();
  if (!who) return <span className="av-wrap" style={{ width: size, height: size }} />;
  const look = lookFor(who, looks[who.id]);
  return (
    <span className={`av-wrap ${state || ""}`} style={{ width: size, height: size }} title={who.name}>
      <Mascot look={look} size={size} sleeping={state === "sleeping"} title={who.name} />
      {state === "sleeping" && <span className="av-z">z</span>}
    </span>
  );
}
