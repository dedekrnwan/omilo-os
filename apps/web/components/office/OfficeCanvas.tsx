"use client";
import { useEffect, useRef } from "react";
import type { Bridge } from "./engine";

/* Mounts the Phaser office in a div. Phaser is imported here, inside an effect, so it never runs during the
   static build or on the server; the page loads this component with next/dynamic (ssr: false). */
export default function OfficeCanvas({ bridge }: { bridge: Omit<Bridge, "base"> & { base: string } }) {
  const el = useRef<HTMLDivElement>(null);
  const b = useRef(bridge); b.current = bridge;
  useEffect(() => {
    let stop: (() => void) | null = null, dead = false;
    import("./engine").then(({ startOffice }) => {
      if (dead || !el.current) return;
      // the bridge forwards to the latest callbacks, so React re-renders never restart the game
      stop = startOffice(el.current, {
        base: b.current.base,
        lookOf: (a) => b.current.lookOf(a),
        onSelect: (id) => b.current.onSelect(id),
        onOpen: (a) => b.current.onOpen(a),
        onHover: (h) => b.current.onHover(h),
        onReady: (api) => b.current.onReady(api),
        onZoom: (z) => b.current.onZoom?.(z),
      });
    });
    return () => { dead = true; stop?.(); };
  }, []);
  return <div ref={el} className="ov-canvas" aria-label="Virtual office: your helpers at work" />;
}
