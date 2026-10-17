"use client";
import { Mascot } from "@/components/Avatar";

/* The Omilo mark: Omilo, the house mascot. Drawn exactly like the helpers (the same body, face and tile), in the
   Chief of Staff's indigo, with a warm spark on top instead of a crown: the one who keeps the company going. */

export const OMILO_LOOK = { color: "#6366f1", shape: "blob", prop: "spark", image: null } as const;

export function OmiloMascot({ size = 24, tile = true, title = "Omilo", mood }: { size?: number; tile?: boolean; title?: string; mood?: "sad" | "worried" | null }) {
  return <Mascot look={OMILO_LOOK as any} size={size} title={title} bare={!tile} mood={mood} />;
}

/** The mark next to the product or company name. */
export function Mark({ size = 24 }: { size?: number }) {
  return <span className="mark" aria-hidden><OmiloMascot size={size} /></span>;
}
