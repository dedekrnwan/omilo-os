// TODO(pen): refine against omilo-v2.pen
import { Search } from 'lucide-react'
import { SidebarFrame, NavGroup, NavLink, GroupLabel } from '../../ui/ds/Sidebar'
import { NAV_GROUPS } from './data'
import type { ControlPanelSection } from './types'

interface Props {
  section: ControlPanelSection
  onSection: (s: ControlPanelSection) => void
  workspace?: string
}

/**
 * pen `Control Panel Sidebar` (Ljoml): promotes the section nav into the
 * standard 232px app sidebar so the layout matches Chat/Office:
 *   Rail → ControlPanelSidebar → Inset(section content).
 */
export function ControlPanelSidebar({ section, onSection, workspace = 'Sahabat Warga' }: Props) {
  return (
    <SidebarFrame label="Control panel sections">
      {/* Workspace header */}
      <div className="flex w-full flex-col gap-px px-[8px] pt-[2px] pb-[4px]">
        <p className="m-0 text-[14px] font-semibold text-ink">Control panel</p>
        <p className="m-0 truncate text-[11.5px] text-muted">{workspace}</p>
      </div>

      {/* Find a setting search */}
      <label className="flex h-[28px] w-full items-center gap-[6px] rounded-btn bg-surface px-[8px] outline-1 -outline-offset-1 outline-line-strong">
        <Search size={13} aria-hidden className="shrink-0 text-faint" />
        <input
          type="search"
          aria-label="Find a setting"
          placeholder="Find a setting"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
        />
      </label>

      {/* Nav groups */}
      <div className="flex min-h-0 w-full flex-1 flex-col gap-[8px] overflow-y-auto">
        {NAV_GROUPS.map((g) => (
          <NavGroup key={g.group}>
            <GroupLabel label={g.group} />
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
          </NavGroup>
        ))}
      </div>
    </SidebarFrame>
  )
}
