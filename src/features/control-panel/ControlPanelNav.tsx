import { Search } from 'lucide-react'
import { NavLink } from '../../ui/ds/Sidebar'
import type { ControlPanelSection } from './types'
import { NAV_GROUPS } from './data'

interface Props {
  section: ControlPanelSection
  onSection: (s: ControlPanelSection) => void
  workspace?: string
}

/**
 * pen `Control Panel Sidebar` (Ljoml): 232 wide · app fill · padding 12 8 10 8 · gap 10.
 * Head (14/600 + 11.5 muted) · Search (h-28, radius 7) · nav groups (gap 8, links gap 1).
 */
export function ControlPanelNav({ section, onSection, workspace = 'Sahabat Warga' }: Props) {
  return (
    <nav
      aria-label="Control panel sections"
      className="flex h-full w-[232px] shrink-0 flex-col gap-[10px] bg-app pt-[12px] pr-[8px] pb-[10px] pl-[8px]"
    >
      <div className="flex w-full flex-col gap-px px-[8px] pt-[2px] pb-[4px]">
        <p className="m-0 text-[14px] font-semibold text-ink">Control panel</p>
        <p className="m-0 truncate text-[11.5px] text-muted">{workspace}</p>
      </div>

      <label className="flex h-[28px] w-full items-center gap-[6px] rounded-btn bg-surface px-[8px] outline-1 -outline-offset-1 outline-line-strong">
        <Search size={13} aria-hidden className="shrink-0 text-faint" />
        <input
          type="search"
          aria-label="Find a setting"
          placeholder="Find a setting"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
        />
      </label>

      <div className="flex min-h-0 w-full flex-1 flex-col gap-[8px] overflow-y-auto">
        {NAV_GROUPS.map((g) => (
          <div key={g.group} className="flex w-full flex-col gap-px">
            <div className="flex w-full items-center px-[8px] pb-[4px]">
              <span className="flex-1 text-[10.5px] font-medium tracking-[1px] text-faint">{g.group}</span>
            </div>
            {g.items.map((item) => (
              <NavLink
                key={item.id}
                icon={item.icon}
                label={item.label}
                count={item.badge}
                active={section === item.id}
                onClick={() => onSection(item.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </nav>
  )
}
