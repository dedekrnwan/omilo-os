import type { LucideIcon } from 'lucide-react'

export interface SegmentOption<T extends string> {
  id: T
  label: string
  icon?: LucideIcon
  count?: number
}

/**
 * pen Seg Item/On xoS7e · Seg Item/Off ABGqb — the one button group used for
 * page tabs and filters. Hugs its buttons (never stretches across the row).
 */
export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  label,
  bg = 'bg-soft',
  onBg = 'bg-surface',
  className = '',
}: {
  options: readonly SegmentOption<T>[]
  value: T
  onChange?: (v: T) => void
  /** Accessible name of the tab list */
  label?: string
  bg?: string
  onBg?: string
  className?: string
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`flex w-fit max-w-full shrink-0 gap-[2px] self-start overflow-x-auto rounded-base p-[2px] outline-1 -outline-offset-1 outline-line ${bg} ${className}`}
    >
      {options.map(({ id, label: text, icon: Icon, count }) => {
        const on = id === value
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange?.(id)}
            className={`flex h-[28px] items-center gap-[6px] rounded-sm px-[10px] text-[12px] font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ink ${
              on ? `${onBg} text-ink shadow-[0_1px_2px_#00000014]` : 'text-muted hover:text-ink-2'
            }`}
          >
            {Icon && <Icon size={13} aria-hidden className={on ? 'text-ink' : 'text-muted'} />}
            {text}
            {count !== undefined && <span className={`text-[11px] ${on ? 'text-muted' : 'text-faint'}`}>{count}</span>}
          </button>
        )
      })}
    </div>
  )
}
