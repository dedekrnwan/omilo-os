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
import { InboxRoute } from '../features/office/InboxRoute'

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

/**
 * Office routes — Task 8 replaces OfficeRoute with the real feature UI.
 */
const officeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/office',
  component: () => <Outlet />,
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

const routeTree = rootRoute.addChildren([
  chatRoute.addChildren([
    chatChannelRoute.addChildren([
      chatChannelIndexRoute,
      chatSessionRoute,
      chatGoalsRoute,
      chatFlowsRoute,
      chatDocsRoute,
    ]),
  ]),
  officeRoute.addChildren([
    officeInboxRoute.addChildren([officeInboxItemRoute]),
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
