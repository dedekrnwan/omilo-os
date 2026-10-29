import { Outlet, useMatchRoute, useParams } from '@tanstack/react-router'
import { Inset } from '../../ui/ds/Frame'
import type { Mode } from '../../app/store'
import { useUIStore } from '../../app/store'
import { AppSidebar, type AppNav } from './AppSidebar'

/**
 * Derive the active sidebar nav item from the current URL. Routes are
 * mode-neutral (/goals, /flows, …), so the only mode-dependent bit is the
 * primary entry: Inbox in office, Chats in chat.
 */
function useActiveNav(mode: Mode): AppNav | undefined {
  const matchRoute = useMatchRoute()
  if (matchRoute({ to: '/goals', fuzzy: false })) return 'Goals'
  if (matchRoute({ to: '/flows', fuzzy: true })) return 'Flows'
  if (matchRoute({ to: '/routines', fuzzy: true })) return 'Routines'
  if (matchRoute({ to: '/docs', fuzzy: true })) return 'Docs'
  if (matchRoute({ to: '/analytics', fuzzy: false })) return 'Analytics'
  if (matchRoute({ to: '/archived', fuzzy: false })) return 'Archived'
  if (mode === 'office' && matchRoute({ to: '/inbox', fuzzy: true })) return 'Primary'
  if (mode === 'chat' && matchRoute({ to: '/chat', fuzzy: false })) return 'Primary'
  return undefined // chat $sessionId → Primary is resolved via sessionId in AppSidebar
}

/**
 * Shared layout for the in-app surfaces. Reads `mode` from the persisted UI
 * store (never the URL), renders the unified AppSidebar once, and swaps main
 * content via <Outlet />. The same component backs both Chats and Inbox
 * primaries plus every neutral platform page.
 */
export function ModeLayout() {
  const mode = useUIStore((s) => s.mode)
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
