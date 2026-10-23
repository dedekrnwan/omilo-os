import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { Shell } from './Shell'
import { ChatRoute } from '../features/chat/ChatRoute'
import { OfficeRoute } from './routes/OfficeRoute'

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
 * Chat routes — Task 7 replaces ChatRoute with the real feature UI.
 * Swapping is a one-line change (the `component` prop on each route).
 */
const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat',
  component: ChatRoute,
})

const chatChannelRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: '$channelId',
  component: ChatRoute,
})

const chatSessionRoute = createRoute({
  getParentRoute: () => chatChannelRoute,
  path: '$sessionId',
  component: ChatRoute,
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
  component: OfficeRoute,
})

const officeInboxItemRoute = createRoute({
  getParentRoute: () => officeInboxRoute,
  path: '$itemId',
  component: OfficeRoute,
})

const routeTree = rootRoute.addChildren([
  chatRoute.addChildren([
    chatChannelRoute.addChildren([chatSessionRoute]),
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
