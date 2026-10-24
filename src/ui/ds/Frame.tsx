import type { ReactNode } from 'react'
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

/**
 * pen `Topbar` (VhSwW): h-44 · bottom border line · gap 8 · px 16 ·
 * icon 15 muted · title 13/500 ink · meta 12.5 muted · actions right.
 */
export function Topbar({
  icon: Icon,
  title,
  meta,
  actions,
}: {
  icon: LucideIcon
  title: string
  meta?: string
  actions?: ReactNode
}) {
  return (
    <header className="flex h-[44px] w-full shrink-0 items-center gap-[8px] border-b border-line px-[16px]">
      <Icon size={15} aria-hidden className="shrink-0 text-muted" />
      <h1 className="m-0 truncate text-[13px] font-medium text-ink">{title}</h1>
      {meta && <span className="truncate text-[12.5px] text-muted">{meta}</span>}
      <div className="h-px min-w-0 flex-1" />
      {actions}
    </header>
  )
}
