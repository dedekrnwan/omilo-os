import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { Shell } from './Shell'
import { ChatChannelLayout } from '../features/chat/ChatChannelLayout'
import { ChatIndexRoute, ChatSessionRoute } from '../features/chat/ChatRoute'
import { GoalsRoute } from '../features/chat/GoalsRoute'
import { FlowsRoute } from '../features/chat/FlowsRoute'
import { DocsRoute } from '../features/chat/DocsRoute'
import { ArchivedRoute } from '../features/chat/ArchivedRoute'
import { FolderRoute } from '../features/chat/FolderRoute'
import { InboxRoute } from '../features/office/InboxRoute'
import { OfficeLayout } from '../features/office/OfficeLayout'
import { OfficeGoalsRoute } from '../features/office/OfficeGoalsRoute'

/** Root route renders the Shell; the Shell renders <Outlet /> for child routes. */
const rootRoute = createRootRoute({
  component: Shell,
  notFoundComponent: () => (
    <div
      role="alert"
      style={{ padding: 32, color: 'var(--muted)', fontFamily: 'var(--font-sans, sans-serif)' }}
    >
      Not found
    </div>
  ),
})

/**
 * Chat routes — layout-based nesting so the ChannelSidebar renders ONCE
 * and each child route swaps main content via <Outlet />.
 *
 * /chat                              → passthrough (redirects to default channel)
 * /chat/$channelId                   → ChatChannelLayout (sidebar + Inset(<Outlet />))
 * /chat/$channelId/          (index) → ChatIndexRoute  (new-chat hero)
 * /chat/$channelId/$sessionId        → ChatSessionRoute (session thread)
 * /chat/$channelId/goals             → GoalsRoute
 * /chat/$channelId/flows             → FlowsRoute
 * /chat/$channelId/docs              → DocsRoute
 */
const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat',
  component: () => <Outlet />,
})

const chatChannelRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: '$channelId',
  component: ChatChannelLayout,
})

/** Index route: /chat/$channelId → new-chat hero */
const chatChannelIndexRoute = createRoute({
  getParentRoute: () => chatChannelRoute,
  path: '/',
  component: ChatIndexRoute,
})

/** Session route: /chat/$channelId/$sessionId → session thread */
const chatSessionRoute = createRoute({
  getParentRoute: () => chatChannelRoute,
  path: '$sessionId',
  component: ChatSessionRoute,
})

const chatGoalsRoute = createRoute({
  getParentRoute: () => chatChannelRoute,
  path: 'goals',
  component: GoalsRoute,
})

const chatFlowsRoute = createRoute({
  getParentRoute: () => chatChannelRoute,
  path: 'flows',
  component: FlowsRoute,
})

const chatDocsRoute = createRoute({
  getParentRoute: () => chatChannelRoute,
  path: 'docs',
  component: DocsRoute,
})

const chatArchivedRoute = createRoute({
  getParentRoute: () => chatChannelRoute,
  path: 'archived',
  component: ArchivedRoute,
})

const chatFolderRoute = createRoute({
  getParentRoute: () => chatChannelRoute,
  path: 'folder/$folderId',
  component: FolderRoute,
})

/**
 * Office routes — OfficeLayout renders the sidebar once; child routes render
 * main content only (no sidebar duplication).
 *
 * /office                            → layout passthrough
 * /office/inbox          (index)     → InboxRoute (inbox list)
 * /office/inbox/$itemId              → InboxRoute (inbox item → ChatSession)
 * /office/goals                      → OfficeGoalsRoute (company-wide goals)
 */
const officeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/office',
  component: OfficeLayout,
})

const officeInboxRoute = createRoute({
  getParentRoute: () => officeRoute,
  path: 'inbox',
  component: InboxRoute,
})

const officeInboxItemRoute = createRoute({
  getParentRoute: () => officeInboxRoute,
  path: '$itemId',
  component: InboxRoute,
})

const officeGoalsRoute = createRoute({
  getParentRoute: () => officeRoute,
  path: 'goals',
  component: OfficeGoalsRoute,
})

const routeTree = rootRoute.addChildren([
  chatRoute.addChildren([
    chatChannelRoute.addChildren([
      chatChannelIndexRoute,
      chatSessionRoute,
      chatGoalsRoute,
      chatFlowsRoute,
      chatDocsRoute,
      chatArchivedRoute,
      chatFolderRoute,
    ]),
  ]),
  officeRoute.addChildren([
    officeInboxRoute.addChildren([officeInboxItemRoute]),
    officeGoalsRoute,
  ]),
])

export const router = createRouter({
  routeTree,
  history: createBrowserHistory(),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
