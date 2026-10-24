import { Outlet, useMatchRoute } from '@tanstack/react-router'
import { Inset } from '../../ui/ds/Frame'
import { OfficeSidebar } from './OfficeSidebar'
import { OfficeAreaProvider, useOfficeArea } from './OfficeAreaContext'

function OfficeLayoutInner() {
  const { area, setArea } = useOfficeArea()
  const matchRoute = useMatchRoute()
  const onGoals = !!matchRoute({ to: '/office/goals', fuzzy: false })
  const onInbox = !!matchRoute({ to: '/office/inbox', fuzzy: true })
  const onRoutines = !!matchRoute({ to: '/office/routines', fuzzy: true })
  const onAnalytics = !!matchRoute({ to: '/office/analytics', fuzzy: false })

  return (
    <>
      <OfficeSidebar
        area={area}
        onAreaChange={setArea}
        activeNav={
          onGoals ? 'Goals' : onInbox ? 'Inbox' : onRoutines ? 'Routines' : onAnalytics ? 'Analytics' : undefined
        }
      />
      <Inset>
        <Outlet />
      </Inset>
    </>
  )
}

/**
 * Layout for every /office/* route.
 * Renders OfficeSidebar once; child routes swap <Inset> content via <Outlet />.
 * Mirrors ChatChannelLayout — sidebar + Outlet, with shared area-filter context.
 */
export function OfficeLayout() {
  return (
    <OfficeAreaProvider>
      <OfficeLayoutInner />
    </OfficeAreaProvider>
  )
}
