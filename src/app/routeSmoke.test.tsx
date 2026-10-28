import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from './ReposProvider'
import { createMockRepos } from '../adapters/mock/mockRepos'

import { NotificationsRoute } from '../features/notifications/NotificationsRoute'
import { TeamLayout } from '../features/team/TeamLayout'
import { TeamRoster } from '../features/team/TeamRoster'
import { ControlPanelRoute } from '../features/control-panel/ControlPanelRoute'
import { ModeLayout } from '../features/shell/ModeLayout'
import { useUIStore } from './store'
const OfficeLayout = () => <ModeLayout />
import { OfficeFlowsRoute } from '../features/office/flows'
import { OfficeDocsRoute } from '../features/office/docs/OfficeDocsRoute'
import { SignInPage } from '../features/auth'
import { OnboardingRoute } from '../features/onboarding'

/**
 * Smoke tests: each newly-wired route renders its OWN content (not the router
 * not-found fallback). Each test builds a minimal memory router mirroring the
 * production tree shape, with a root route that provides the repos + query
 * context the office layout needs.
 */
function makeRoot() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const repos = createMockRepos()
  return createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={repos}>
          <Outlet />
        </ReposProvider>
      </QueryClientProvider>
    ),
    notFoundComponent: () => <div data-testid="not-found">Not found</div>,
  })
}

// routeTree is the root route after addChildren; its augmented generic type is
// not worth reconstructing in a test, so accept it loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderRouter(routeTree: any, initialPath: string) {
  const history = createMemoryHistory({ initialEntries: [initialPath] })
  const router = createRouter({ routeTree, history })
  return render(<RouterProvider router={router} />)
}

function Passthrough() {
  return <Outlet />
}

describe('feature route smoke tests', () => {
  test('/notifications renders the Notifications page', async () => {
    const root = makeRoot()
    const r = createRoute({ getParentRoute: () => root, path: '/notifications', component: NotificationsRoute })
    renderRouter(root.addChildren([r]), '/notifications')
    // Topbar h1 + page h1 both read "Notifications" — the page is its own content.
    expect((await screen.findAllByRole('heading', { name: 'Notifications' })).length).toBeGreaterThan(0)
    // "Needs you" region renders after async inbox data loads
    expect(await screen.findByRole('region', { name: 'Needs you' })).toBeInTheDocument()
    expect(screen.queryByTestId('not-found')).not.toBeInTheDocument()
  })

  test('/team renders the Team roster', async () => {
    const root = makeRoot()
    const team = createRoute({ getParentRoute: () => root, path: '/team', component: TeamLayout })
    const index = createRoute({ getParentRoute: () => team, path: '/', component: TeamRoster })
    renderRouter(root.addChildren([team.addChildren([index])]), '/team')
    expect(await screen.findByText('Hire a helper')).toBeInTheDocument()
    expect(screen.queryByTestId('not-found')).not.toBeInTheDocument()
  })

  test('/control-panel renders the Control panel', async () => {
    const root = makeRoot()
    const cp = createRoute({ getParentRoute: () => root, path: '/control-panel', component: ControlPanelRoute })
    const section = createRoute({ getParentRoute: () => cp, path: '$section', component: ControlPanelRoute })
    renderRouter(root.addChildren([cp.addChildren([section])]), '/control-panel')
    expect(await screen.findByRole('main', { name: 'Control panel' })).toBeInTheDocument()
    expect(screen.queryByTestId('not-found')).not.toBeInTheDocument()
  })

  test('/flows renders the Flows page', async () => {
    useUIStore.setState({ mode: 'office' })
    const root = makeRoot()
    const app = createRoute({ getParentRoute: () => root, id: 'app', component: OfficeLayout })
    const flows = createRoute({ getParentRoute: () => app, path: '/flows', component: OfficeFlowsRoute })
    renderRouter(root.addChildren([app.addChildren([flows])]), '/flows')
    expect(await screen.findByRole('heading', { name: 'Flows' })).toBeInTheDocument()
    expect(screen.queryByTestId('not-found')).not.toBeInTheDocument()
  })

  test('/docs renders the Docs page', async () => {
    useUIStore.setState({ mode: 'office' })
    const root = makeRoot()
    const app = createRoute({ getParentRoute: () => root, id: 'app', component: OfficeLayout })
    const docs = createRoute({ getParentRoute: () => app, path: '/docs', component: OfficeDocsRoute })
    renderRouter(root.addChildren([app.addChildren([docs])]), '/docs')
    expect(await screen.findByRole('heading', { name: 'Docs' })).toBeInTheDocument()
    expect(screen.queryByTestId('not-found')).not.toBeInTheDocument()
  })

  test('/auth/sign-in renders the Sign in page', async () => {
    const root = makeRoot()
    const auth = createRoute({ getParentRoute: () => root, path: '/auth', component: Passthrough })
    const signIn = createRoute({ getParentRoute: () => auth, path: 'sign-in', component: SignInPage })
    renderRouter(root.addChildren([auth.addChildren([signIn])]), '/auth/sign-in')
    expect(await screen.findByRole('heading', { name: 'Sign in to Omilo' })).toBeInTheDocument()
    expect(screen.queryByTestId('not-found')).not.toBeInTheDocument()
  })

  test('/onboarding renders the Onboarding wizard', async () => {
    const root = makeRoot()
    const r = createRoute({ getParentRoute: () => root, path: '/onboarding', component: OnboardingRoute })
    renderRouter(root.addChildren([r]), '/onboarding')
    expect(await screen.findByRole('main', { name: 'Onboarding' })).toBeInTheDocument()
    expect(screen.queryByTestId('not-found')).not.toBeInTheDocument()
  })
})
