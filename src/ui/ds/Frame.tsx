import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * pen `Main` + `Inset`: padding 6 6 6 0, then a white card
 * (radius 12 · 1px line-strong · clip) that holds the topbar and content.
 */
export function Inset({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <main aria-label={label} className="flex h-full min-w-0 flex-1 py-[6px] pr-[6px]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface">
        {children}
      </div>
    </main>
  )
}

/** Opens the global command menu (same ⌘/Ctrl-K the Shell listens for). */
function openCommandMenu() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }))
}

/** Keyboard-shortcut hint chip (mirrors command-menu `Kbd`). */
function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-xs bg-surface px-[5px] py-px font-mono text-[10.5px] leading-[1.3] whitespace-nowrap text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong),inset_0_-1px_0_1px_var(--color-line-strong)]">
      {children}
    </span>
  )
}

/** Topbar search that opens the command menu, with a ⌘K / Ctrl K hint. */
export function TopbarSearch() {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return (
    <button
      type="button"
      onClick={openCommandMenu}
      aria-label="Search or jump to — open command menu"
      aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
      className="flex h-[30px] w-[220px] shrink-0 items-center gap-[8px] rounded-btn bg-surface pr-[6px] pl-[9px] text-left outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
    >
      <Search size={14} aria-hidden className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">Search or jump to…</span>
      <Kbd>{mac ? '⌘K' : 'Ctrl K'}</Kbd>
    </button>
  )
}

/**
 * pen `Topbar` (VhSwW): h-44 · bottom border line · gap 8 · px 16 ·
 * icon 15 muted · title 13/500 ink · meta 12.5 muted · search + actions right.
 */
export function Topbar({
  icon: Icon,
  title,
  meta,
  actions,
  search = true,
}: {
  icon: LucideIcon
  title: string
  meta?: string
  actions?: ReactNode
  /** Show the command-menu search on the right (default on). Off for flows outside the Shell. */
  search?: boolean
}) {
  return (
    <header className="flex h-[44px] w-full shrink-0 items-center gap-[8px] border-b border-line px-[16px]">
      <Icon size={15} aria-hidden className="shrink-0 text-muted" />
      <h1 className="m-0 truncate text-[13px] font-medium text-ink">{title}</h1>
      {meta && <span className="truncate text-[12.5px] text-muted">{meta}</span>}
      <div className="h-px min-w-0 flex-1" />
      {search && <TopbarSearch />}
      {actions}
    </header>
  )
}
