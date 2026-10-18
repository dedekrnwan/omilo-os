"use client";
import Link from "next/link";
import { createContext, useContext, useEffect, useRef } from "react";
import { MenuItem, openMenu } from "@/lib/menu";

/* What you can do on a page lives in the top-right corner: one main button and a "…" menu with the rest.
   A page says what it offers with usePageActions({ primary, more }); the Shell shows it in the top bar. */

export type PageAction = { label: string; icon?: string; onSelect?: () => unknown; href?: string; disabled?: boolean; danger?: boolean };
export type PageActionsSpec = { primary?: PageAction | null; more?: (MenuItem | false | null | undefined)[] };

type Ctx = { set: (a: PageActionsSpec | null) => void };
export const PageActionsCtx = createContext<Ctx>({ set: () => {} });

/** Show these actions in the top bar while the page is open. Pass deps that change what they do. */
export function usePageActions(spec: PageActionsSpec | null, deps: unknown[]) {
  const { set } = useContext(PageActionsCtx);
  const latest = useRef(spec);
  latest.current = spec;
  useEffect(() => { set(latest.current); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => set(null), [set]);
}

export function PageActionsBar({ spec, extra }: { spec: PageActionsSpec | null; extra?: MenuItem[] }) {
  const more = [...((spec?.more || []).filter(Boolean) as MenuItem[])];
  if (extra?.length) more.push(...(more.length ? [{ sep: true } as MenuItem] : []), ...extra);
  const p = spec?.primary;
  return (
    <div className="pacts">
      {p && (p.href
        ? <Link className={`btn primary sm ${p.danger ? "danger" : ""}`} href={p.href}>{p.icon && <i className={p.icon} />}{p.label}</Link>
        : <button className={`btn primary sm ${p.danger ? "danger" : ""}`} disabled={p.disabled} onClick={() => p.onSelect?.()}>{p.icon && <i className={p.icon} />}{p.label}</button>)}
      {more.length > 0 && (
        <button className="iconbtn pacts-more" aria-label="More actions" title="More actions" aria-haspopup="menu"
          onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); openMenu(Math.max(8, r.right - 240), r.bottom + 6, more); }}>
          <i className="ri-more-2-fill" />
        </button>
      )}
    </div>
  );
}
