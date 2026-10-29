// TODO(pen): refine against omilo-v2.pen
import { Bell } from 'lucide-react'
import { GroupLabel, NavGroup, NavLink, SidebarFrame } from '../../ui/ds/Sidebar'
import { BackToApp } from '../shell/BackToApp'
import { helperColor } from '../../ui/tokens'
import { areasFromItems, countForFilter } from './inboxAdapter'
import type { NotifFilter } from './data'
import type { InboxItem, HelperArea } from '../../core/domain/types'

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  filter: NotifFilter
  onFilter: (f: NotifFilter) => void
  /** Live inbox items from useInbox(). Drives counts + area list. */
  items: InboxItem[]
}

/**
 * pen `Notifications Sidebar`: 232px filter rail.
 * All / Needs you / Mentions at the top, then an AREAS group with per-area dots.
 * Counts are derived from the live inbox items passed in.
 */
export function NotificationsSidebar({ filter, onFilter, items }: Props) {
  const totalCount = countForFilter(items, 'all')
  const needsYouCount = countForFilter(items, 'needs-you')
  const mentionsCount = countForFilter(items, 'mentions')
  const areas: HelperArea[] = areasFromItems(items)

  return (
    <SidebarFrame label="Notifications">
      <BackToApp />

      {/* Header */}
      <div className="flex w-full items-center gap-[8px] px-[8px] pt-[2px] pb-[4px]">
        <Bell size={15} aria-hidden className="text-muted" />
        <p className="m-0 text-[14px] font-semibold text-ink">Notifications</p>
      </div>

      {/* Top-level filters */}
      <NavGroup>
        <NavLink
          label="All"
          count={totalCount}
          active={filter === 'all'}
          onClick={() => onFilter('all')}
        />
        <NavLink
          label="Needs you"
          count={needsYouCount || undefined}
          countClassName="font-semibold text-[#EB6834]"
          active={filter === 'needs-you'}
          onClick={() => onFilter('needs-you')}
        />
        <NavLink
          label="Mentions"
          count={mentionsCount || undefined}
          active={filter === 'mentions'}
          onClick={() => onFilter('mentions')}
        />
      </NavGroup>

      {/* Per-area filters */}
      <NavGroup>
        <GroupLabel label="AREAS" />
        {areas.map((area) => (
          <NavLink
            key={area}
            label={area.charAt(0).toUpperCase() + area.slice(1)}
            count={countForFilter(items, area)}
            labelClassName="text-ink-2"
            active={filter === area}
            onClick={() => onFilter(area)}
            leading={
              <span aria-hidden className="flex size-[16px] shrink-0 items-center justify-center">
                <span
                  data-testid="area-dot"
                  className="size-[8px] rounded-full"
                  style={{ background: helperColor[area as keyof typeof helperColor] ?? helperColor.brand }}
                />
              </span>
            }
          />
        ))}
      </NavGroup>
    </SidebarFrame>
  )
}
