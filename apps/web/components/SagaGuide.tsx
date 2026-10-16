"use client";
import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { SagaMascot } from "@/components/Logo";

/* The left side of onboarding: Saga, the house mascot, guides each step. It says something about what you just
   filled in (and hops when it does), your team appears as you pick helpers, and a meter shows how much your helpers
   will know. Everything here comes from your answers; nothing is made up. */

export type GuideMember = { id: string; name: string; role?: string; is_chief?: boolean };

export default function SagaGuide({ line, tone = "warm", team, known, onKnown }: {
  line: string; tone?: "warm" | "cool" | "fresh";
  team: GuideMember[];
  known: { score: number; items: Record<string, boolean> } | null;
  onKnown?: (i: number) => void;
}) {
  const [shown, setShown] = useState(line);
  const [typed, setTyped] = useState(line.length);
  const hop = useRef<HTMLDivElement>(null);

  // a new line: Saga hops and "types" it out
  useEffect(() => {
    if (line === shown) return;
    setShown(line); setTyped(0);
    const el = hop.current?.querySelector("svg.mascot");
    if (el) { el.classList.remove("hop"); void (el as any).getBoundingClientRect(); el.classList.add("hop"); setTimeout(() => el.classList.remove("hop"), 520); }
  }, [line, shown]);
  useEffect(() => {
    if (typed >= shown.length) return;
    const t = setTimeout(() => setTyped((n) => Math.min(shown.length, n + 2)), 16);
    return () => clearTimeout(t);
  }, [typed, shown]);

  return (
    <div className={`sg mf-${tone}`}>
      <div className="mf" aria-hidden><i className="mf-blob b1" /><i className="mf-blob b2" /><i className="mf-blob b3" /></div>
      <div className="sg-saga" ref={hop}>
        <div className="sg-bubble" aria-live="polite"><span>{shown.slice(0, typed)}</span><span className="sg-ghost">{shown.slice(typed)}</span></div>
        <div className="sg-tile"><SagaMascot size={104} tile={false} /></div>
        <span className="sg-name">Saga</span>
      </div>
      {team.length > 0 && (
        <div className="sg-sec">
          <span className="sg-h">Your team so far</span>
          <div className="sg-team">
            {team.map((m) => (
              <span key={m.id} className="sg-mem" title={m.name}>
                <Avatar who={m} size={34} /><span>{m.is_chief ? "Chief" : m.name.split(" ")[0]}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {known && (
        <div className="sg-sec">
          <span className="sg-h">What your helpers will know <b>{known.score}%</b></span>
          <span className="sg-bar"><i style={{ width: `${known.score}%` }} /></span>
          <div className="sg-know">
            {Object.entries(known.items).map(([k, ok], i) => (
              <button key={k} type="button" className={ok ? "ok" : ""} onClick={() => onKnown?.(i)} title={ok ? `${k}: filled in` : `${k}: not yet, click to add`}>
                <i className={ok ? "ri-checkbox-circle-fill" : "ri-checkbox-blank-circle-line"} />{k}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
