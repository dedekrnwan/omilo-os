"use client";
import { ReactNode, forwardRef } from "react";
import { MascotField } from "@/components/AuthShell";
import { OmiloMascot } from "@/components/Logo";

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

const MOOD: Record<Tone, "warm" | "cool" | "fresh"> = { green: "fresh", orange: "warm", blue: "cool", violet: "cool", rose: "warm", teal: "fresh", amber: "warm", ink: "cool" };

/** The artwork panel: a soft room in the step's colour with Omilo's helpers floating in it (they react to the cursor). */
export function StepArt({ tone = "green", caption, mascot }: { tone?: Tone; seed?: number; caption?: ReactNode; mascot?: boolean }) {
  return (
    <div className="sc-art sc-art-soft" aria-hidden={!caption}>
      <MascotField tone={MOOD[tone]} />
      {mascot && <div className="sc-mascot"><span className="sg-tile"><OmiloMascot size={96} tile={false} /></span></div>}
      {caption && <div className="sc-cap">{caption}</div>}
    </div>
  );
}

type Props = {
  icon: string; title: string; tone?: Tone; seed?: number; caption?: ReactNode; mascot?: boolean;
  next?: { icon: string; title: string; tone?: Tone } | null; meta?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean;
  art?: ReactNode;  // replaces the artwork panel (onboarding puts Omilo's guide there)
};

/** One step as a card. `children` is the scrolling form; `footer` sits at the bottom of the form column (the Next button). */
const StepCard = forwardRef<HTMLDivElement, Props>(function StepCard({ icon, title, tone = "green", seed = 0, caption, mascot, next, meta, children, footer, wide, art }, ref) {
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
          {art ?? <StepArt tone={tone} seed={seed} caption={caption} mascot={mascot} />}
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
      <footer className="sc-copy">© {new Date().getFullYear()} Omilo</footer>
    </div>
  );
}
