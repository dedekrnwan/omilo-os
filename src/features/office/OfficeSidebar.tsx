import { useMatchRoute, useNavigate } from '@tanstack/react-router'
import { CalendarSync, ChartLine, FileText, Inbox, Layers, Target, Workflow } from 'lucide-react'
import { useChannels, useInbox } from '../../app/queries'
import { areaDot } from '../../ui/ds/accents'
import { GroupLabel, NavGroup, NavLink, SidebarFrame } from '../../ui/ds/Sidebar'

/** Areas filter value: a channel id, or null for "All areas". */
export type AreaFilter = string | null

export type OfficeNav = 'Goals' | 'Inbox' | 'Flows' | 'Routines' | 'Docs' | 'Analytics'

interface OfficeSidebarProps {
  area?: AreaFilter
  onAreaChange?: (area: AreaFilter) => void
  activeNav?: OfficeNav
}

/** pen `Office Sidebar` (EuKqr). */
export function OfficeSidebar({ area = null, onAreaChange, activeNav }: OfficeSidebarProps) {
  const navigate = useNavigate()
  const matchRoute = useMatchRoute()
  const onFlows = !!matchRoute({ to: '/office/flows', fuzzy: true })
  const onDocs = !!matchRoute({ to: '/office/docs', fuzzy: true })
  // The area filter only scopes the Inbox, so areas highlight only while it's open.
  const onInbox = !!matchRoute({ to: '/office/inbox', fuzzy: true })
  const { data: channels = [] } = useChannels()
  const { data: items = [] } = useInbox()
  const needsYou = items.filter((i) => i.status === 'pending' && i.needsYou).length
  const total = channels.reduce((n, c) => n + c.openItems, 0)

  function pickArea(next: AreaFilter) {
    onAreaChange?.(next)
    void navigate({ to: '/office/inbox' })
  }

  return (
    <SidebarFrame label="Office">
      <div className="flex w-full items-center gap-[8px] px-[8px] py-[6px]">
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-[13.5px] font-semibold text-ink">Sahabat Warga</span>
          <span className="truncate text-[11.5px] text-muted">Office · 5 areas</span>
        </div>
      </div>

      <NavGroup>
        <NavLink
          icon={Target}
          label="Goals"
          active={activeNav === 'Goals'}
          onClick={() => void navigate({ to: '/office/goals' })}
        />
        <NavLink
          icon={Inbox}
          label="Inbox"
          active={activeNav === 'Inbox'}
          count={needsYou || undefined}
          countClassName="font-semibold text-[#EB6834]"
          onClick={() => void navigate({ to: '/office/inbox' })}
        />
        <NavLink
          icon={Workflow}
          label="Flows"
          active={onFlows}
          onClick={() => void navigate({ to: '/office/flows' })}
        />
        <NavLink
          icon={CalendarSync}
          label="Routines"
          active={activeNav === 'Routines'}
          onClick={() => void navigate({ to: '/office/routines' })}
        />
        <NavLink
          icon={FileText}
          label="Docs"
          active={onDocs}
          onClick={() => void navigate({ to: '/office/docs' })}
        />
        <NavLink
          icon={ChartLine}
          label="Analytics"
          active={activeNav === 'Analytics'}
          onClick={() => void navigate({ to: '/office/analytics' })}
        />
      </NavGroup>

      <NavGroup>
        <GroupLabel label="AREAS" />
        <NavLink
          icon={Layers}
          label="All areas"
          count={total}
          labelClassName="text-ink-2"
          active={onInbox && area === null}
          onClick={() => pickArea(null)}
        />
        {channels.map((c) => (
          <NavLink
            key={c.id}
            label={c.name}
            count={c.openItems}
            labelClassName="text-ink-2"
            active={onInbox && area === c.id}
            onClick={() => pickArea(c.id)}
            leading={
              <span aria-hidden className="flex size-[16px] shrink-0 items-center justify-center">
                <span data-testid="area-dot" className="size-[8px] rounded-full" style={{ background: areaDot[c.accent] }} />
              </span>
            }
          />
        ))}
      </NavGroup>
    </SidebarFrame>
  )
}
