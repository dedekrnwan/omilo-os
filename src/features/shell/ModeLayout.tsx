import { Outlet, useMatchRoute, useParams } from '@tanstack/react-router'
import { Inset } from '../../ui/ds/Frame'
import type { Mode } from '../../app/store'
import { AppSidebar, type AppNav } from './AppSidebar'

/** Derive the active sidebar nav item from the current URL for the given mode. */
function useActiveNav(mode: Mode): AppNav | undefined {
  const matchRoute = useMatchRoute()
  if (mode === 'chat') {
    if (matchRoute({ to: '/chat/goals', fuzzy: false })) return 'Goals'
    if (matchRoute({ to: '/chat/flows', fuzzy: true })) return 'Flows'
    if (matchRoute({ to: '/chat/routines', fuzzy: true })) return 'Routines'
    if (matchRoute({ to: '/chat/docs', fuzzy: false })) return 'Docs'
    if (matchRoute({ to: '/chat/analytics', fuzzy: false })) return 'Analytics'
    if (matchRoute({ to: '/chat/archived', fuzzy: false })) return 'Archived'
    return undefined // index + $sessionId + folder → Chats (handled by sessionId logic)
  }
  if (matchRoute({ to: '/office/inbox', fuzzy: true })) return 'Primary'
  if (matchRoute({ to: '/office/goals', fuzzy: false })) return 'Goals'
  if (matchRoute({ to: '/office/flows', fuzzy: true })) return 'Flows'
  if (matchRoute({ to: '/office/routines', fuzzy: true })) return 'Routines'
  if (matchRoute({ to: '/office/docs', fuzzy: false })) return 'Docs'
  if (matchRoute({ to: '/office/analytics', fuzzy: false })) return 'Analytics'
  return undefined
}

/**
 * Shared layout for both modes: renders the unified AppSidebar once and swaps
 * main content via <Outlet />. Replaces ChatChannelLayout + OfficeLayout.
 */
export function ModeLayout({ mode }: { mode: Mode }) {
  const params = useParams({ strict: false }) as { sessionId?: string; folderId?: string }
  const activeNav = useActiveNav(mode)
  return (
    <>
      <AppSidebar mode={mode} sessionId={params.sessionId} folderId={params.folderId} activeNav={activeNav} />
      <Inset>
        <Outlet />
      </Inset>
    </>
  )
}
