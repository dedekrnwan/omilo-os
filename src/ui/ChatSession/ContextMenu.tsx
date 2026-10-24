import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { FoldVertical, Info } from 'lucide-react'
import { Ring } from './Ring'

// ── Context menu (pen `Composer/Context Menu` VJCPi) — opened from the composer's ring ──

const WINDOW_K = 200

/** Breakdown of what fills the window (k tokens) — bar widths are the pen's (20/76/26 of 292). */
const SOURCES = [
  { label: 'Helper files & rules', k: 14, color: '#6366F1', bar: 20 },
  { label: 'Chat history', k: 52, color: 'var(--color-ink-2)', bar: 76 },
  { label: 'Files & tools', k: 18, color: '#14B8A6', bar: 26 },
]

interface ContextMenuProps {
  /** Share of the window in use, 0-100. */
  contextUsed?: number
  children: React.ReactNode
  onAutoCompactToggle?: () => void
  autoCompact?: boolean
  onCompactNow?: () => void
  defaultOpen?: boolean
}

export function ContextMenu({
  contextUsed = 42,
  children,
  onAutoCompactToggle,
  autoCompact = true,
  onCompactNow,
  defaultOpen,
}: ContextMenuProps) {
  const usedK = Math.round((contextUsed / 100) * WINDOW_K)
  const freeK = WINDOW_K - usedK

  return (
    <DropdownMenu.Root defaultOpen={defaultOpen} modal={false}>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="center"
          sideOffset={8}
          avoidCollisions={false}
          className="z-50 flex w-[320px] flex-col gap-[12px] rounded-md bg-surface p-[14px] outline-1 -outline-offset-1 outline-line-strong shadow-[0_10px_24px_#0C0A0929]"
        >
          {/* Head */}
          <div className="flex w-full items-center gap-[12px]">
            <Ring size={40} value={contextUsed} inner={0.78} />
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-[13px] font-semibold text-ink">
                {usedK}k of {WINDOW_K}k tokens
              </span>
              <span className="text-[12px] text-muted">{contextUsed}% used · Opus 5.5 context window</span>
            </div>
          </div>

          {/* Breakdown bar */}
          <div aria-hidden className="flex h-[8px] w-full overflow-hidden rounded-pill bg-soft">
            {SOURCES.map((s) => (
              <span key={s.label} className="h-full" style={{ width: s.bar, background: s.color }} />
            ))}
          </div>

          {/* Legend */}
          <div className="flex w-full flex-col gap-[6px]">
            {[...SOURCES, { label: 'Free', k: freeK, color: '' }].map((s) => (
              <div key={s.label} className="flex items-center gap-[8px]">
                <span
                  className={`size-[8px] shrink-0 rounded-full ${s.color ? '' : 'bg-soft outline-1 -outline-offset-1 outline-line-strong'}`}
                  style={s.color ? { background: s.color } : undefined}
                />
                <span className="flex-1 text-[12.5px] text-ink-2">{s.label}</span>
                <span className="font-mono text-[12px] text-muted">{s.k}k</span>
              </div>
            ))}
          </div>

          <div className="h-px w-full bg-line" />

          {/* Auto-compact */}
          <div className="flex w-full items-center gap-[10px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
              <span className="text-[13px] font-medium text-ink">Auto-compact</span>
              <span className="text-[12px] text-muted">Summarises older messages at 85% full</span>
            </div>
            {/* pen `Switch/On` (y1lHE): 32×18 · radius 9 · p-2 · 14px white knob */}
            <button
              type="button"
              role="switch"
              aria-checked={autoCompact}
              aria-label="Auto-compact"
              onClick={onAutoCompactToggle}
              className={`flex h-[18px] w-[32px] shrink-0 rounded-[9px] p-[2px] ${
                autoCompact ? 'justify-end bg-primary' : 'justify-start bg-line-strong'
              }`}
            >
              <span className="size-[14px] rounded-full bg-white shadow-[0_1px_2px_#0000002E]" />
            </button>
          </div>

          <DropdownMenu.Item
            onSelect={onCompactNow}
            className="flex h-[34px] w-full cursor-pointer items-center justify-center gap-[6px] rounded-btn bg-surface px-[14px] text-[13px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong select-none data-[highlighted]:bg-soft"
          >
            <FoldVertical size={16} aria-hidden />
            Compact now · frees ~45k
          </DropdownMenu.Item>

          <div className="flex w-full gap-[6px]">
            <Info size={12} aria-hidden className="mt-[2px] shrink-0 text-faint" />
            <p className="m-0 flex-1 text-[11.5px] leading-[1.45] text-faint">
              Window size comes from the model. Switching to GPT-5.5 gives 400k; Haiku 5.5 has 200k.
            </p>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
