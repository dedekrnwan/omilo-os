"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { Open } from "./TaskDrawer";
import { openInDrawer } from "@/lib/open";

/* Always on and tiny: turns links to a job or a chat into drawers, and loads the drawer code the first time. */
const Host = dynamic(() => import("./TaskDrawer"), { ssr: false });

export default function TaskDrawerLazy() {
  const [first, setFirst] = useState<Open | null>(null);
  useEffect(() => {
    const onTask = (e: Event) => setFirst((f) => f || { kind: "task", ...(e as CustomEvent).detail });
    const onThread = (e: Event) => setFirst((f) => f || { kind: "thread", ...(e as CustomEvent).detail });
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest?.("a");
      if (!a || a.dataset.full !== undefined || a.target === "_blank") return;
      if (openInDrawer(a.getAttribute("href") || "")) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("omilo:task", onTask);
    window.addEventListener("omilo:thread", onThread);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("omilo:task", onTask); window.removeEventListener("omilo:thread", onThread); document.removeEventListener("click", onClick, true); };
  }, []);
  return first ? <Host initial={first} /> : null;
}
