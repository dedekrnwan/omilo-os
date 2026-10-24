import { Search } from 'lucide-react'
import type { ControlPanelSection } from './types'
import { NAV_GROUPS } from './data'

interface Props {
  section: ControlPanelSection
  onSection: (s: ControlPanelSection) => void
  workspace?: string
}

/**
 * Left section nav for Control Panel.
 * 144px wide · app fill · padding 12 8 · group labels uppercase faint ·
 * nav items 28px h · active = hover fill + medium ink.
 */
export function ControlPanelNav({ section, onSection, workspace = 'Sahabat Warga' }: Props) {
  return (
    <nav
      aria-label="Control panel sections"
      className="flex h-full w-[144px] shrink-0 flex-col gap-[12px] bg-app px-[8px] py-[12px]"
    >
      {/* Header */}
      <div className="px-[8px]">
        <p className="text-[13px] font-semibold text-ink leading-none">Control panel</p>
        <p className="mt-[2px] text-[11px] text-muted truncate">{workspace}</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={12} className="absolute left-[8px] top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          placeholder="Find a setting"
          className="h-[26px] w-full rounded-sm border border-line-strong bg-soft pl-[24px] pr-[8px] text-[12px] text-ink outline-none placeholder:text-faint"
        />
      </div>

      {/* Groups */}
      <div className="flex flex-1 flex-col gap-[12px] overflow-y-auto">
        {NAV_GROUPS.map((g) => (
          <div key={g.group} className="flex flex-col gap-px">
            <p className="px-[8px] pb-[4px] text-[10px] font-medium tracking-[0.8px] text-faint">
              {g.group}
            </p>
            {g.items.map((item) => {
              const active = section === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onSection(item.id)}
                  className={`flex h-[28px] w-full items-center gap-[6px] rounded-sm px-[8px] text-left transition-colors ${
                    active ? 'bg-hover' : 'hover:bg-hover'
                  }`}
                >
                  <span
                    className={`min-w-0 flex-1 truncate text-[12.5px] ${
                      active ? 'font-medium text-ink' : 'text-ink-2'
                    }`}
                  >
                    {item.label}
                  </span>
                  {item.badge && (
                    <span className="rounded-pill bg-ok-tint px-[5px] py-[1px] text-[9.5px] font-medium text-ok">
                      {item.badge}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </nav>
  )
}
