/**
 * googleAuth.test.tsx — P10-T3 Google OAuth frontend tests.
 *
 * 1. GoogleButton hidden when googleEnabled=false; shown when true.
 * 2. Shown button triggers window.location.assign to /v1/auth/google/start?client=web.
 * 3. GoogleCallbackPage: #token=abc → setToken + hydrate + navigate home + strips hash.
 * 4. GoogleCallbackPage: no token → navigate /auth/sign-in.
 * 5. Dummy company fixtures (Sahabat Warga / Kopi Kenangan / "Welcome back, Dede") are gone.
 */

import type { FC } from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../app/ReposProvider'
import { createMockRepos } from '../../adapters/mock/mockRepos'
import { useSession } from '../../app/session'
import { SignInPage } from './SignInPage'
import { SignUpPage } from './SignUpPage'
import { GoogleCallbackPage } from './GoogleCallbackPage'
import { ChooseCompanyPage } from './ChooseCompanyPage'

// ── Stub platform so tests don't touch Tauri / localStorage ──────────────────

const mockSetToken = vi.fn().mockResolvedValue(undefined)
const mockGetToken = vi.fn().mockReturnValue(null)
const mockClearToken = vi.fn().mockResolvedValue(undefined)

vi.mock('../../platform', () => ({
  platform: {
    name: 'web',
    tokenStorage: {
      getToken: () => mockGetToken(),
      setToken: (t: string) => mockSetToken(t),
      clearToken: () => mockClearToken(),
      getTokenAsync: vi.fn().mockResolvedValue(null),
      hydrate: vi.fn().mockResolvedValue(undefined),
    },
    notifications: { send: vi.fn(), setBadge: vi.fn() },
    deepLinks: { parse: vi.fn(), onOpen: vi.fn().mockReturnValue(() => {}) },
  },
  isTauri: () => false,
  parseDeepLink: vi.fn(),
}))

// ── Stub useAuth so pages don't build a real HTTP adapter ────────────────────

vi.mock('../../app/useAuth', () => ({
  useAuth: () => ({
    adapter: {
      signIn: vi.fn(),
      signUp: vi.fn(),
      me: vi.fn(),
      switchCompany: vi.fn(),
      publicConfig: vi.fn(),
    },
    applySignIn: vi.fn(),
    signOut: vi.fn(),
    mock: false,
  }),
  isMockMode: () => false,
  getAuthAdapter: vi.fn(),
}))

// ── Router builder helpers ───────────────────────────────────────────────────

function makeRouter(component: FC, path: string, initialPath: string = path) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const repos = createMockRepos()

  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={repos}>
          <Outlet />
        </ReposProvider>
      </QueryClientProvider>
    ),
  })

  // Common destination routes
  const chat = createRoute({ getParentRoute: () => root, path: '/chat', component: () => <div data-testid="home-chat">Chat</div> })
  const inbox = createRoute({ getParentRoute: () => root, path: '/inbox', component: () => <div data-testid="home-inbox">Inbox</div> })

  const target = createRoute({ getParentRoute: () => root, path: path, component: component })

  // Only add signIn route if the target is NOT already /auth/sign-in (avoids duplicate id).
  const routeTree = path !== '/auth/sign-in'
    ? root.addChildren([
        chat,
        inbox,
        target,
        createRoute({ getParentRoute: () => root, path: '/auth/sign-in', component: SignInPage }),
      ])
    : root.addChildren([chat, inbox, target])
  const history = createMemoryHistory({ initialEntries: [initialPath] })
  return createRouter({ routeTree, history })
}

// ── Session state helper ─────────────────────────────────────────────────────

function setGoogleEnabled(enabled: boolean) {
  useSession.setState({ googleEnabled: enabled })
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  // Reset session to defaults
  useSession.setState({ googleEnabled: false, status: 'anon', user: null, company: null, companies: [] })
})

afterEach(() => {
  vi.clearAllMocks()
})

// ── 1. GoogleButton visibility on SignInPage ──────────────────────────────────

describe('SignInPage — GoogleButton conditional rendering', () => {
  test('Google button is NOT rendered when googleEnabled=false', async () => {
    setGoogleEnabled(false)
    const router = makeRouter(SignInPage, '/auth/sign-in')
    render(<RouterProvider router={router} />)

    await screen.findByRole('button', { name: 'Sign in' })
    expect(screen.queryByRole('button', { name: /google/i })).toBeNull()
  })

  test('Google button IS rendered when googleEnabled=true', async () => {
    setGoogleEnabled(true)
    const router = makeRouter(SignInPage, '/auth/sign-in')
    render(<RouterProvider router={router} />)

    const btn = await screen.findByRole('button', { name: /continue with google/i })
    expect(btn).toBeInTheDocument()
  })

  test('Google button points to /v1/auth/google/start?client=web', async () => {
    setGoogleEnabled(true)

    // Mock window.location.assign
    const assignMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: assignMock },
      configurable: true,
      writable: true,
    })

    const router = makeRouter(SignInPage, '/auth/sign-in')
    render(<RouterProvider router={router} />)

    const btn = await screen.findByRole('button', { name: /continue with google/i })
    await act(async () => {
      btn.click()
    })

    expect(assignMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/auth/google/start?client=web'),
    )
  })
})

// ── 2. GoogleButton visibility on SignUpPage ──────────────────────────────────

describe('SignUpPage — GoogleButton conditional rendering', () => {
  test('Google button is NOT rendered when googleEnabled=false', async () => {
    setGoogleEnabled(false)
    const router = makeRouter(SignUpPage, '/auth/sign-up')
    render(<RouterProvider router={router} />)

    await screen.findByRole('button', { name: 'Create account' })
    expect(screen.queryByRole('button', { name: /google/i })).toBeNull()
  })

  test('Google button IS rendered when googleEnabled=true', async () => {
    setGoogleEnabled(true)
    const router = makeRouter(SignUpPage, '/auth/sign-up')
    render(<RouterProvider router={router} />)

    const btn = await screen.findByRole('button', { name: /sign up with google/i })
    expect(btn).toBeInTheDocument()
  })

  test('Sign-up Google button points to /v1/auth/google/start?client=web', async () => {
    setGoogleEnabled(true)

    const assignMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: assignMock },
      configurable: true,
      writable: true,
    })

    const router = makeRouter(SignUpPage, '/auth/sign-up')
    render(<RouterProvider router={router} />)

    const btn = await screen.findByRole('button', { name: /sign up with google/i })
    await act(async () => {
      btn.click()
    })

    expect(assignMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/auth/google/start?client=web'),
    )
  })
})

// ── 3. GoogleCallbackPage: #token=abc → success flow ────────────────────────

describe('GoogleCallbackPage — web callback with token', () => {
  test('#token=abc: calls setToken, hydrate, navigates home, strips hash', async () => {
    // Set the hash as if the backend redirected here.
    Object.defineProperty(window, 'location', {
      value: {
        hash: '#token=test-jwt-abc',
        pathname: '/auth/callback',
        search: '',
        href: 'http://localhost/auth/callback#token=test-jwt-abc',
        assign: vi.fn(),
      },
      configurable: true,
      writable: true,
    })

    // Mock history.replaceState
    const replaceStateMock = vi.fn()
    Object.defineProperty(window, 'history', {
      value: { ...window.history, replaceState: replaceStateMock },
      configurable: true,
      writable: true,
    })

    // Stub hydrate so it resolves quickly and sets authed
    const hydrateSpy = vi.spyOn(useSession.getState(), 'hydrate').mockImplementation(async () => {
      useSession.setState({ status: 'authed' })
    })

    const router = makeRouter(GoogleCallbackPage, '/auth/callback')
    render(<RouterProvider router={router} />)

    // setToken must be called with the JWT
    await waitFor(() => expect(mockSetToken).toHaveBeenCalledWith('test-jwt-abc'))

    // hydrate must have been called
    await waitFor(() => expect(hydrateSpy).toHaveBeenCalled())

    // history.replaceState must have been called to strip the hash
    await waitFor(() => expect(replaceStateMock).toHaveBeenCalled())

    // Router navigated away from /auth/callback
    await waitFor(() =>
      expect(router.state.location.pathname).not.toBe('/auth/callback'),
    )

    hydrateSpy.mockRestore()
  })
})

// ── 4. GoogleCallbackPage: no token → sign-in ────────────────────────────────

describe('GoogleCallbackPage — no token', () => {
  test('navigates to /auth/sign-in when no token in URL', async () => {
    Object.defineProperty(window, 'location', {
      value: {
        hash: '',
        pathname: '/auth/callback',
        search: '',
        href: 'http://localhost/auth/callback',
        assign: vi.fn(),
      },
      configurable: true,
      writable: true,
    })

    const router = makeRouter(GoogleCallbackPage, '/auth/callback')
    render(<RouterProvider router={router} />)

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/auth/sign-in'),
    )
    // setToken must NOT have been called
    expect(mockSetToken).not.toHaveBeenCalled()
  })
})

// ── 5. Dummy company fixtures are GONE from ChooseCompanyPage ────────────────

describe('ChooseCompanyPage — no dummy data', () => {
  test('does not render hardcoded fixture names: Sahabat Warga, Kopi Kenangan, or "Welcome back, Dede"', async () => {
    useSession.setState({
      status: 'authed',
      user: { id: 'u-1', email: 'test@omilo.app', name: 'Test User' },
      company: { id: 'cmp-1', name: 'Test Corp', currency: 'IDR' },
      companies: [{ id: 'cmp-1', name: 'Test Corp', currency: 'IDR' }],
    })

    const router = makeRouter(ChooseCompanyPage, '/auth/choose-company')
    render(<RouterProvider router={router} />)

    // Wait for render
    await screen.findByText('Test Corp')

    expect(screen.queryByText(/Sahabat Warga/i)).toBeNull()
    expect(screen.queryByText(/Kopi Kenangan/i)).toBeNull()
    expect(screen.queryByText(/Welcome back, Dede/i)).toBeNull()
  })

  test('renders real companies from session', async () => {
    useSession.setState({
      status: 'authed',
      user: { id: 'u-1', email: 'alice@omilo.app', name: 'Alice' },
      company: { id: 'cmp-real', name: 'Real Company', currency: 'IDR' },
      companies: [{ id: 'cmp-real', name: 'Real Company', currency: 'IDR' }],
    })

    const router = makeRouter(ChooseCompanyPage, '/auth/choose-company')
    render(<RouterProvider router={router} />)

    await screen.findByText('Real Company')
    // Shows user's first name
    expect(screen.getByText(/Welcome back, Alice/i)).toBeInTheDocument()
  })
})
