// TODO(pen): refine against omilo-v2.pen
import { Bell } from 'lucide-react'
import { GroupLabel, NavGroup, NavLink, SidebarFrame } from '../../ui/ds/Sidebar'
import { BackToApp } from '../shell/BackToApp'
import { helperColor } from '../../ui/tokens'
import { DECISIONS, NOTIF_GROUPS, filterNotifs } from './data'
import type { NotifFilter } from './data'
import type { HelperArea } from '../../core/domain/types'

// ── Derived counts ────────────────────────────────────────────────────────────

const totalCount = DECISIONS.length + NOTIF_GROUPS.flatMap((g) => g.items).length

const needsYouCount = DECISIONS.length

const mentionsCount = (() => {
  const hasMention = (text: string) => text.includes('@')
  const dCount = DECISIONS.filter((d) => hasMention(d.title) || hasMention(d.body)).length
  const nCount = NOTIF_GROUPS.flatMap((g) => g.items).filter(
    (n) => hasMention(n.title) || (n.preview != null && hasMention(n.preview)),
  ).length
  return dCount + nCount
})()

/** All unique areas that appear in the notification data, in display order. */
const AREAS: HelperArea[] = Array.from(
  new Set([
    ...DECISIONS.map((d) => d.senderArea),
    ...NOTIF_GROUPS.flatMap((g) => g.items.map((n) => n.senderArea)),
  ]),
)

function areaCount(area: HelperArea): number {
  const { decisions, groups } = filterNotifs(area)
  return decisions.length + groups.flatMap((g) => g.items).length
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  filter: NotifFilter
  onFilter: (f: NotifFilter) => void
}

/**
 * pen `Notifications Sidebar`: 232px filter rail.
 * All / Needs you / Mentions at the top, then an AREAS group with per-area dots.
 */
export function NotificationsSidebar({ filter, onFilter }: Props) {
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
        {AREAS.map((area) => (
          <NavLink
            key={area}
            label={area.charAt(0).toUpperCase() + area.slice(1)}
            count={areaCount(area)}
            labelClassName="text-ink-2"
            active={filter === area}
            onClick={() => onFilter(area)}
            leading={
              <span aria-hidden className="flex size-[16px] shrink-0 items-center justify-center">
                <span
                  data-testid="area-dot"
                  className="size-[8px] rounded-full"
                  style={{ background: helperColor[area] }}
                />
              </span>
            }
          />
        ))}
      </NavGroup>
    </SidebarFrame>
  )
}
