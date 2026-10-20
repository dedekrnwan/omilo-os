"use client";
/* Command palette open-state context.
   Task 4 adds <CommandPalette> that consumes useCommand() and renders the dialog.
   For now, clicking Ask sets isOpen=true with no visible UI — this is expected. */

import { createContext, ReactNode, useCallback, useContext, useState } from "react";

type Ctx = { isOpen: boolean; open: () => void; close: () => void };

const CommandCtx = createContext<Ctx>({ isOpen: false, open: () => {}, close: () => {} });

export function CommandProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  return <CommandCtx.Provider value={{ isOpen, open, close }}>{children}</CommandCtx.Provider>;
}

export function useCommand(): Ctx {
  return useContext(CommandCtx);
}
