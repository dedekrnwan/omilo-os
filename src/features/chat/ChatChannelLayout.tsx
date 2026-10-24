import { notFound, Outlet, useMatchRoute, useParams } from '@tanstack/react-router'
import { useChannel } from '../../app/queries'
import { Inset } from '../../ui/ds/Frame'
import { ChannelSidebar } from './ChannelSidebar'
import type { ChannelNav } from './ChannelSidebar'

/** Derive which sidebar nav item is active from the current URL. */
function useActiveNav(): ChannelNav | undefined {
  const matchRoute = useMatchRoute()

  if (matchRoute({ to: '/chat/$channelId/goals',    fuzzy: false })) return 'Goals'
  if (matchRoute({ to: '/chat/$channelId/flows',    fuzzy: false })) return 'Flows'
  if (matchRoute({ to: '/chat/$channelId/docs',     fuzzy: false })) return 'Docs'
  if (matchRoute({ to: '/chat/$channelId/archived', fuzzy: false })) return 'Archived'
  // Session routes, folder routes, and index all map to Chats (undefined lets
  // ChannelSidebar highlight Chats when a sessionId is present via its own logic)
  return undefined
}

/**
 * Layout for every /chat/$channelId/* route.
 * Renders the ChannelSidebar once; child routes swap the <Inset> content via <Outlet />.
 * The sessionId is read loosely so the sidebar can highlight the active session row.
 */
export function ChatChannelLayout() {
  // strict: false so this works both on the index and on $sessionId child
  const params = useParams({ strict: false })
  const channelId = params.channelId ?? ''
  const sessionId = params.sessionId
  const { data: channel, isLoading } = useChannel(channelId)
  const activeNav = useActiveNav()

  if (isLoading) return null
  if (!channel) throw notFound()

  return (
    <>
      <ChannelSidebar channelId={channelId} sessionId={sessionId} activeNav={activeNav} />
      <Inset>
        <Outlet />
      </Inset>
    </>
  )
}
