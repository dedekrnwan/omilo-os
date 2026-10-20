"use client";
/* Command palette open-state context.
   Task 4: <CommandPalette> consumes useCommand() and renders the dialog.
   Global ⌘K/Ctrl-K shortcut is registered here so it fires even when the
   palette is closed (no other component in the tree handles it yet).
   GUARD: the shortcut is ignored when document.activeElement is an
   input, textarea, or [contenteditable] — so it never hijacks typing in the
   composer, deny-note, or any search field. */

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";

type Ctx = { isOpen: boolean; open: () => void; close: () => void };

const CommandCtx = createContext<Ctx>({ isOpen: false, open: () => {}, close: () => {} });

export function CommandProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  // Global ⌘K / Ctrl-K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        // GUARD: ignore when user is typing in a field
        const el = document.activeElement;
        if (
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          (el instanceof HTMLElement && el.isContentEditable)
        ) {
          // The palette's own input is the only exception: it closes the palette via Esc,
          // so ⌘K from inside the palette input is fine to re-toggle.
          // We detect the palette input by checking if isOpen — if already open, let it close.
          if (!isOpen) return; // typing in an unrelated field, do nothing
        }
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen]);

  return <CommandCtx.Provider value={{ isOpen, open, close }}>{children}</CommandCtx.Provider>;
}

export function useCommand(): Ctx {
  return useContext(CommandCtx);
}
