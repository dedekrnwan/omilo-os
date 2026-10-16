"use client";
/* Right-click menus for everything in Saga OS. Usage: <div onContextMenu={menu(() => [ { label: "Open", icon: "ri-…", onSelect } ])}>
   Text fields and selected text keep the browser's own menu (copy, paste, spelling). */

export type MenuItem =
  | { label: string; icon?: string; onSelect?: () => unknown; href?: string; danger?: boolean; disabled?: boolean; hint?: string; checked?: boolean }
  | { sep: true }
  | { heading: string };

export type MenuOpen = { x: number; y: number; items: MenuItem[] };

export function openMenu(x: number, y: number, items: MenuItem[]) {
  window.dispatchEvent(new CustomEvent<MenuOpen>("saga:menu", { detail: { x, y, items } }));
}

const keepNative = (e: React.MouseEvent) => {
  const t = e.target as HTMLElement;
  if (t.closest("input, textarea, select, [contenteditable=true]")) return true;
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && sel.toString().trim().length > 0 && (e.currentTarget as HTMLElement).contains(sel.anchorNode);
};

/** Handler for onContextMenu. `build` runs on right-click, so items can depend on current state. */
export const menu = (build: () => (MenuItem | false | null | undefined)[]) => (e: React.MouseEvent) => {
  if (keepNative(e)) return;
  const items = build().filter(Boolean) as MenuItem[];
  if (!items.length) return;
  e.preventDefault();
  e.stopPropagation();
  openMenu(e.clientX, e.clientY, items);
};

export const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => {});
export const sep: MenuItem = { sep: true };
