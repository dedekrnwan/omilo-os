import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { menuSurface, MenuSeparatorLine } from '../ds/Menu'
import { ContextRing } from '../ds/ContextRing'
import { ChevronRight, ToggleRight } from 'lucide-react'

// ── Context menu (pen ref C9Glat) — "#context" token opens a popover menu ───

interface ContextSource {
  label: string
  count: number
  color: string
}

const CONTEXT_SOURCES: ContextSource[] = [
  { label: 'Helper files & rules', count: 54, color: '#6366F1' },
  { label: 'Chat history',         count: 43, color: '#14B8A6' },
  { label: 'Files & tools',        count: 18, color: '#F97316' },
  { label: 'Free',                 count: 131, color: 'var(--color-line-strong)' },
]

const TOTAL_TOKENS = 200

interface ContextMenuProps {
  contextUsed?: number  // 0-100 percentage
  children: React.ReactNode
  onAutoCompactToggle?: () => void
  autoCompact?: boolean
  onCompactNow?: () => void
}

export function ContextMenu({
  contextUsed = 42,
  children,
  onAutoCompactToggle,
  autoCompact = true,
  onCompactNow,
}: ContextMenuProps) {
  const used = Math.round((contextUsed / 100) * TOTAL_TOKENS)
  const free = TOTAL_TOKENS - used
  const freeTokens = Math.round((free / TOTAL_TOKENS) * 131)

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="end"
          sideOffset={8}
          className={`z-50 w-[300px] ${menuSurface} overflow-hidden`}
        >
          {/* Header */}
          <div className="px-[12px] pt-[12px] pb-[10px]">
            <div className="flex items-start gap-[10px]">
              <ContextRing size={36} value={contextUsed} />
              <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span className="text-[13px] font-semibold text-ink">
                  {used}k of {TOTAL_TOKENS}k tokens
                </span>
                <span className="text-[11.5px] text-muted">
                  This chat · Opus 5.5 200k context window
                </span>
              </div>
            </div>

            {/* Progress bar breakdown */}
            <div className="mt-[10px] flex h-[6px] w-full overflow-hidden rounded-full gap-[1px]">
              {CONTEXT_SOURCES.slice(0, -1).map((src) => (
                <div
                  key={src.label}
                  className="h-full rounded-sm"
                  style={{ background: src.color, flex: src.count }}
                />
              ))}
              <div
                className="h-full flex-1 rounded-sm"
                style={{ background: 'var(--color-line-strong)' }}
              />
            </div>

            {/* Legend */}
            <div className="mt-[10px] flex flex-col gap-[4px]">
              {CONTEXT_SOURCES.map((src) => (
                <div key={src.label} className="flex items-center gap-[8px]">
                  <span
                    className="size-[8px] shrink-0 rounded-full"
                    style={{ background: src.color }}
                  />
                  <span className="flex-1 text-[12px] text-muted">{src.label}</span>
                  <span className="font-mono text-[12px] text-faint">
                    {src.label === 'Free' ? freeTokens : src.count}k
                  </span>
                </div>
              ))}
            </div>
          </div>

          <MenuSeparatorLine />

          {/* Auto-compact toggle */}
          <div className="px-[12px] py-[8px]">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-ink">Auto-compact</span>
              <button
                type="button"
                role="switch"
                aria-checked={autoCompact}
                aria-label="Auto-compact messages"
                onClick={onAutoCompactToggle}
                className="inline-flex items-center justify-center"
              >
                <ToggleRight
                  size={22}
                  className={autoCompact ? 'text-ok' : 'text-muted'}
                />
              </button>
            </div>
            <p className="m-0 mt-[2px] text-[11.5px] text-muted">
              Summarises older messages at 85% full
            </p>
          </div>

          <MenuSeparatorLine />

          {/* Compact now */}
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-[8px] rounded-sm px-[12px] py-[8px] outline-none select-none data-[highlighted]:bg-hover"
            onSelect={onCompactNow}
          >
            <ChevronRight size={14} aria-hidden className="text-muted" />
            <span className="flex-1 text-[12.5px] text-ink">Compact now · frees ~45k</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
