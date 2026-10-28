/**
 * authGate.test.tsx — unit tests for the AuthGate route guard.
 *
 * Tests the four cases from the T4 spec:
 *   (a) mock mode → app route renders content, NO redirect to /auth
 *   (b) HTTP mode + anon + mode='hybrid' → redirect to /auth/sign-in
 *   (c) HTTP mode + anon + mode='local'  → redirect to /onboarding
 *   (d) HTTP mode + authed              → app route renders content
 *
 * Router setup mirrors routeSmoke.test.tsx: minimal memory-history router
 * with a makeRoot() that provides QueryClient + ReposProvider context.
 * Shell is NOT used as the route component here (it pulls in Rail + heavy
 * features). Instead tests mount AuthGate directly as a layout component
 * so the guard logic is exercised in isolation.
 *
 * VITE_USE_HTTP is controlled via vi.stubEnv (restored in afterEach).
 * Session state is set via useSession.setState (zustand store).
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
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
import { useSession } from './session'
import { AuthGate } from './AuthGate'

// ── Router helpers ────────────────────────────────────────────────────────────

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

/**
 * AuthGate layout — a pathless layout that wraps its outlet in AuthGate.
 * Mirrors what Shell.tsx does without pulling in Rail / ChiefDm / etc.
 */
function AuthGateLayout() {
  return (
    <AuthGate>
      <Outlet />
    </AuthGate>
  )
}

function renderRouter(
  routeTree: Parameters<typeof createRouter>[0]['routeTree'],
  initialPath: string,
) {
  const history = createMemoryHistory({ initialEntries: [initialPath] })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = createRouter({ routeTree: routeTree as any, history })
  return render(<RouterProvider router={router} />)
}

// ── Teardown ──────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.unstubAllEnvs()
  // Reset session store to a safe default so tests don't bleed into each other.
  useSession.setState({ status: 'loading', user: null, company: null, companies: [], mode: null })
})

// ── (a) mock mode → renders app content, no redirect ──────────────────────────

describe('AuthGate — mock mode', () => {
  test('renders app content at /inbox without any redirect (VITE_USE_HTTP unset)', async () => {
    // Default env: VITE_USE_HTTP is not '1' → mock mode.
    // In mock mode the session store will be set to 'authed' after hydrate(),
    // but the guard short-circuits via isMockMode() regardless of store state.
    const root = makeRoot()
    const gatedLayout = createRoute({ getParentRoute: () => root, id: 'gated', component: AuthGateLayout })
    const inbox = createRoute({
      getParentRoute: () => gatedLayout,
      path: '/inbox',
      component: () => <div data-testid="inbox-content">inbox</div>,
    })
    renderRouter(root.addChildren([gatedLayout.addChildren([inbox])]), '/inbox')

    expect(await screen.findByTestId('inbox-content')).toBeInTheDocument()
    expect(screen.queryByTestId('not-found')).not.toBeInTheDocument()
    // No navigation away from /inbox happened.
    expect(screen.queryByTestId('sign-in-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-page')).not.toBeInTheDocument()
  })
})

// ── (b) HTTP mode + anon + mode='hybrid' → /auth/sign-in ─────────────────────

describe('AuthGate — HTTP mode, anon, mode=hybrid', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_HTTP', '1')
  })

  test('redirects to /auth/sign-in when status=anon and mode=hybrid', async () => {
    // Pre-set the session store to anon + hybrid (as if hydrate() resolved anon).
    useSession.setState({ status: 'anon', mode: 'hybrid', user: null, company: null, companies: [] })

    const root = makeRoot()
    const gatedLayout = createRoute({ getParentRoute: () => root, id: 'gated', component: AuthGateLayout })
    const inbox = createRoute({
      getParentRoute: () => gatedLayout,
      path: '/inbox',
      component: () => <div data-testid="inbox-content">inbox</div>,
    })
    // Auth routes live outside the gated layout (mirrors production).
    const auth = createRoute({ getParentRoute: () => root, path: '/auth', component: () => <Outlet /> })
    const signIn = createRoute({
      getParentRoute: () => auth,
      path: 'sign-in',
      component: () => <div data-testid="sign-in-page">sign in</div>,
    })

    renderRouter(
      root.addChildren([
        gatedLayout.addChildren([inbox]),
        auth.addChildren([signIn]),
      ]),
      '/inbox',
    )

    expect(await screen.findByTestId('sign-in-page')).toBeInTheDocument()
    expect(screen.queryByTestId('inbox-content')).not.toBeInTheDocument()
  })
})

// ── (c) HTTP mode + anon + mode='local' → /onboarding ────────────────────────

describe('AuthGate — HTTP mode, anon, mode=local', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_HTTP', '1')
  })

  test('redirects to /onboarding when status=anon and mode=local', async () => {
    useSession.setState({ status: 'anon', mode: 'local', user: null, company: null, companies: [] })

    const root = makeRoot()
    const gatedLayout = createRoute({ getParentRoute: () => root, id: 'gated', component: AuthGateLayout })
    const inbox = createRoute({
      getParentRoute: () => gatedLayout,
      path: '/inbox',
      component: () => <div data-testid="inbox-content">inbox</div>,
    })
    const onboarding = createRoute({
      getParentRoute: () => root,
      path: '/onboarding',
      component: () => <div data-testid="onboarding-page">onboarding</div>,
    })

    renderRouter(
      root.addChildren([
        gatedLayout.addChildren([inbox]),
        onboarding,
      ]),
      '/inbox',
    )

    expect(await screen.findByTestId('onboarding-page')).toBeInTheDocument()
    expect(screen.queryByTestId('inbox-content')).not.toBeInTheDocument()
  })
})

// ── (d) HTTP mode + authed → renders app content ─────────────────────────────

describe('AuthGate — HTTP mode, authed', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_HTTP', '1')
  })

  test('renders app content when status=authed', async () => {
    useSession.setState({
      status: 'authed',
      mode: 'cloud',
      user: { id: 'u-1', email: 'user@test.com', name: 'Test User' },
      company: { id: 'cmp-1', name: 'Test Corp', currency: 'USD' },
      companies: [{ id: 'cmp-1', name: 'Test Corp', currency: 'USD' }],
    })

    const root = makeRoot()
    const gatedLayout = createRoute({ getParentRoute: () => root, id: 'gated', component: AuthGateLayout })
    const inbox = createRoute({
      getParentRoute: () => gatedLayout,
      path: '/inbox',
      component: () => <div data-testid="inbox-content">inbox</div>,
    })

    renderRouter(root.addChildren([gatedLayout.addChildren([inbox])]), '/inbox')

    expect(await screen.findByTestId('inbox-content')).toBeInTheDocument()
    expect(screen.queryByTestId('sign-in-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-page')).not.toBeInTheDocument()
  })
})
