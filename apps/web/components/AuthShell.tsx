"use client";
import { ReactNode } from "react";
import { Mascot } from "@/components/Avatar";
import { OmiloMascot } from "@/components/Logo";
import OfficeLobby from "@/components/OfficeLobby";

/* The sign-in and account pages: on the left a corner of the office where helpers walk, run, sit and type (click
   the floor and one runs over), with a short line on a glass card; on the right a calm form. Mobile shows a strip of
   the office above the form. MascotField (floating mascots) is still used by the setup cards. */

type Look = { color: string; shape: string; prop: string; image: null };
const L = (color: string, shape: string, prop: string): Look => ({ color, shape, prop, image: null });
const CAST: { x: number; y: number; s: number; look: Look; d: number; t: number }[] = [
  { x: 8, y: 9, s: 46, look: L("#65a30d", "bean", "sprout"), d: 0, t: 7 },
  { x: 40, y: 6, s: 76, look: L("#6366f1", "blob", "spark"), d: 1.2, t: 8 },
  { x: 78, y: 12, s: 52, look: L("#f97316", "box", "megaphone"), d: 0.6, t: 6.5 },
  { x: 22, y: 22, s: 36, look: L("#0ea5e9", "box", "glasses"), d: 2.1, t: 7.5 },
  { x: 5, y: 46, s: 42, look: L("#14b8a6", "blob", "headset"), d: 1.6, t: 8.5 },
  { x: 86, y: 44, s: 44, look: L("#a16207", "bean", "coin"), d: 0.3, t: 7 },
  { x: 12, y: 80, s: 50, look: L("#3b82f6", "box", "gear"), d: 2.4, t: 9 },
  { x: 76, y: 78, s: 54, look: L("#8b5cf6", "bean", "beret"), d: 1.1, t: 7.8 },
  { x: 44, y: 88, s: 40, look: L("#f59e0b", "blob", "tie"), d: 0.9, t: 6.8 },
  { x: 92, y: 90, s: 34, look: L("#ec4899", "blob", "antenna"), d: 1.9, t: 8.2 },
];

export function MascotField({ tone = "warm", dense = false }: { tone?: "warm" | "cool" | "fresh"; dense?: boolean }) {
  const cast = dense ? CAST : CAST.filter((_, i) => i % 3 !== 2);
  return (
    <div className={`mf mf-${tone}`} aria-hidden>
      <i className="mf-blob b1" /><i className="mf-blob b2" /><i className="mf-blob b3" />
      {cast.map((c, i) => (
        <span key={i} className="mf-tile" style={{ left: `${c.x}%`, top: `${c.y}%`, width: c.s + 14, height: c.s + 14,
          animationDelay: `${-c.d}s`, animationDuration: `${c.t}s`, ["--r" as any]: `${(i % 2 ? 1 : -1) * (2 + (i % 3))}deg` }}>
          <Mascot look={c.look} size={c.s} bare />
        </span>
      ))}
    </div>
  );
}

export default function AuthShell({ headline, body, children, side, you, sign }: { headline: ReactNode; body: ReactNode; children: ReactNode; side?: ReactNode; you?: string; sign?: string }) {
  return (
    <div className="au">
      <aside className="au-side">
        <OfficeLobby you={you} sign={sign} />
        <div className="au-glass">
          <div className="au-brand"><OmiloMascot size={24} /><b>Omilo</b></div>
          <h2>{headline}</h2>
          <p>{body}</p>
          {side}
          <span className="au-hint"><i className="ri-cursor-line" />Click the floor: someone runs over.</span>
        </div>
      </aside>
      <main className="au-main">
        <div className="au-mobile-top" aria-hidden>
          <OfficeLobby you={you} sign={sign} />
        </div>
        <div className="au-form">{children}</div>
        <footer className="au-copy">© {new Date().getFullYear()} Omilo · runs on your own computer</footer>
      </main>
    </div>
  );
}

/** An input with an icon inside it (and an optional button on the right, e.g. show password). */
export function Field({ icon, right, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { icon: string; right?: ReactNode }) {
  return (
    <div className="au-field">
      <i className={icon} aria-hidden />
      <input {...p} />
      {right}
    </div>
  );
}
