"use client";
import { ReactNode, forwardRef } from "react";
import { SagaMascot } from "@/components/Logo";

/* The setup card: the current step as a card with a small tab (icon + name), the next step peeking out behind it,
   an artwork panel on the left with a short line, and the form on the right with one big button at the bottom.
   Used by account creation, sign-in and onboarding. The artwork is drawn here (no image files). */

export type Tone = "green" | "orange" | "blue" | "violet" | "rose" | "teal" | "amber" | "ink";

const TONES: Record<Tone, { deep: string; mid: string; light: string; icon: string }> = {
  green: { deep: "#04210a", mid: "#2f8f24", light: "#b7f0a0", icon: "#22a447" },
  orange: { deep: "#2a0f02", mid: "#d9601c", light: "#ffd3a8", icon: "#eb6834" },
  blue: { deep: "#04122b", mid: "#2563c9", light: "#b8d6ff", icon: "#2a78d6" },
  violet: { deep: "#150828", mid: "#7044d4", light: "#dccbff", icon: "#7c4ddb" },
  rose: { deep: "#2a0614", mid: "#d6336c", light: "#ffc4d8", icon: "#e0457b" },
  teal: { deep: "#03201f", mid: "#14968c", light: "#a9f0e6", icon: "#0f9d8f" },
  amber: { deep: "#261702", mid: "#d08a06", light: "#ffe3a3", icon: "#d99400" },
  ink: { deep: "#0c0a09", mid: "#44403c", light: "#d6d3d1", icon: "#44403c" },
};

/** Flowing shapes in one colour family with a fine halftone over them. `seed` varies the composition per step. */
export function StepArt({ tone = "green", seed = 0, caption, mascot }: { tone?: Tone; seed?: number; caption?: ReactNode; mascot?: boolean }) {
  const c = TONES[tone];
  const s = (seed % 5) * 9;
  const id = `art-${tone}-${seed}`;
  return (
    <div className="sc-art" style={{ background: c.deep }} aria-hidden={!caption}>
      <svg viewBox="0 0 300 420" preserveAspectRatio="xMidYMid slice" className="sc-art-svg">
        <defs>
          <linearGradient id={`${id}-a`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={c.mid} /><stop offset=".55" stopColor={c.light} /><stop offset="1" stopColor={c.mid} />
          </linearGradient>
          <radialGradient id={`${id}-b`} cx=".7" cy=".25" r=".8">
            <stop offset="0" stopColor={c.light} stopOpacity=".9" /><stop offset=".45" stopColor={c.mid} stopOpacity=".8" /><stop offset="1" stopColor={c.deep} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-c`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={c.deep} /><stop offset="1" stopColor={c.deep} stopOpacity="0" />
          </linearGradient>
          <filter id={`${id}-blur`}><feGaussianBlur stdDeviation="6" /></filter>
        </defs>
        <rect width="300" height="420" fill={`url(#${id}-b)`} />
        <path d={`M-40 ${150 + s} C 60 ${90 + s}, 170 ${120 - s}, 340 ${40 + s} L 340 ${110 + s} C 200 ${170 - s}, 120 ${160 + s}, -40 ${260 + s} Z`} fill={`url(#${id}-a)`} opacity=".95" />
        <path d={`M-30 ${330 - s} C 40 ${200 + s}, 150 ${170}, 240 ${210 - s} C 300 ${235}, 320 ${320 - s}, 340 ${300} L 340 440 L -30 440 Z`} fill={c.deep} opacity=".92" />
        <path d={`M150 ${235 - s} C 210 ${200}, 280 ${210 + s}, 330 ${250} C 270 ${240 + s}, 210 ${250}, 150 ${235 - s} Z`} fill={c.light} opacity=".55" filter={`url(#${id}-blur)`} />
        <path d={`M-20 ${380 - s} C 80 ${330}, 200 ${360 + s}, 330 ${330} L 330 440 L -20 440 Z`} fill={c.mid} opacity=".35" />
        <rect width="300" height="420" fill={`url(#${id}-c)`} opacity=".55" />
      </svg>
      <div className="sc-dots" />
      {mascot && <div className="sc-mascot"><SagaMascot size={96} tile={false} /></div>}
      {caption && <div className="sc-cap">{caption}</div>}
    </div>
  );
}

type Props = {
  icon: string; title: string; tone?: Tone; seed?: number; caption?: ReactNode; mascot?: boolean;
  next?: { icon: string; title: string; tone?: Tone } | null; meta?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean;
};

/** One step as a card. `children` is the scrolling form; `footer` sits at the bottom of the form column (the Next button). */
const StepCard = forwardRef<HTMLDivElement, Props>(function StepCard({ icon, title, tone = "green", seed = 0, caption, mascot, next, meta, children, footer, wide }, ref) {
  return (
    <div className={`sc-stack ${wide ? "wide" : ""}`}>
      {next && (
        <div className="sc-peek" aria-hidden>
          <i className={next.icon} style={{ color: TONES[next.tone || "orange"].icon }} />{next.title}
        </div>
      )}
      <section className="sc-card" aria-label={title}>
        <div className="sc-tab"><i className={icon} style={{ color: TONES[tone].icon }} /><span>{title}</span><span className="sp" />{meta}</div>
        <div className="sc-body">
          <StepArt tone={tone} seed={seed} caption={caption} mascot={mascot} />
          <div className="sc-form">
            <div className="sc-scroll" ref={ref}>{children}</div>
            {footer && <div className="sc-foot">{footer}</div>}
          </div>
        </div>
      </section>
    </div>
  );
});

export default StepCard;

/** The quiet page around a step card. */
export function StepPage({ children, top }: { children: ReactNode; top?: ReactNode }) {
  return (
    <div className="sc-page">
      {top && <div className="sc-top">{top}</div>}
      <main className="sc-center">{children}</main>
      <footer className="sc-copy">© {new Date().getFullYear()} Saga OS</footer>
    </div>
  );
}
