"use client";
/* Command palette open-state context.
   Task 4: <CommandPalette> consumes useCommand() and renders the dialog.
   Global ⌘K/Ctrl-K shortcut is registered here so it fires even when the
   palette is closed (no other component in the tree handles it yet).
   GUARD: the shortcut is ignored when document.activeElement is an
   input, textarea, or [contenteditable] — so it never hijacks typing in the
   composer, deny-note, or any search field. */

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";

type Ctx = { isOpen: boolean; seed: string; open: (seed?: string) => void; close: () => void };

const CommandCtx = createContext<Ctx>({ isOpen: false, seed: "", open: () => {}, close: () => {} });

export function CommandProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [seed, setSeed] = useState("");
  const open = useCallback((s = "") => { setSeed(typeof s === "string" ? s : ""); setIsOpen(true); }, []);
  const close = useCallback(() => setIsOpen(false), []);

  // Global ⌘K / Ctrl-K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        const el = document.activeElement;
        const isInputLike =
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          (el instanceof HTMLElement && el.isContentEditable);

        if (isOpen) {
          // While the palette is open, ⌘K only toggles closed when focus is in
          // the palette's own input (cmd-field). Any other input is left alone.
          if (isInputLike && !(el instanceof HTMLInputElement && el.classList.contains("cmd-field"))) {
            return;
          }
        } else {
          // While the palette is closed, ignore ⌘K when typing in any input/textarea/contenteditable.
          if (isInputLike) return;
        }

        e.preventDefault();
        setIsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen]);

  return <CommandCtx.Provider value={{ isOpen, seed, open, close }}>{children}</CommandCtx.Provider>;
}

export function useCommand(): Ctx {
  return useContext(CommandCtx);
}
