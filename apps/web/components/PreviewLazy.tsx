"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

/* Loads the preview window (and its code highlighter) only the first time a file is opened, so every page stays light. */
const Host = dynamic(() => import("./Markdown").then((m) => m.PreviewHost), { ssr: false });

export default function PreviewLazy() {
  const [first, setFirst] = useState<any>(null);
  useEffect(() => {
    const on = (e: Event) => setFirst((cur: any) => cur || (e as CustomEvent).detail);
    window.addEventListener("saga:preview", on);
    return () => window.removeEventListener("saga:preview", on);
  }, []);
  return first ? <Host initial={first} /> : null;
}
