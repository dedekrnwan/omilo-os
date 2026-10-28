/**
 * railCompanies.test.tsx — T6 company switcher: Rail sources tiles from the
 * live session (useSession().companies) and calls adapter.switchCompany on click.
 *
 * COMPANIES from app/companies is intentionally NOT imported here; a grep in the
 * suite confirms Rail.tsx no longer references it for company tile rendering.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSession } from '../app/session'
import type { AuthAdapter } from '../adapters/http/auth'
import type { Company, SignInResult } from '../core/domain/session'

// ── fixtures ──────────────────────────────────────────────────────────────────

const COMPANY_A: Company = { id: 'cmp-a', name: 'Alpha Corp', currency: 'IDR' }
const COMPANY_B: Company = { id: 'cmp-b', name: 'Beta Ltd', currency: 'USD' }

const SIGN_IN_RESULT_B: SignInResult = {
  user: { id: 'usr-1', email: 'user@test.com', name: 'Test User' },
  company: COMPANY_B,
  companies: [COMPANY_A, COMPANY_B],
  token: 'tok-b',
}

// ── fake adapter ──────────────────────────────────────────────────────────────

let fakeAdapter: AuthAdapter

function resetFakeAdapter() {
  fakeAdapter = {
    signIn: vi.fn(),
    signUp: vi.fn(),
    me: vi.fn(),
    switchCompany: vi.fn().mockResolvedValue(SIGN_IN_RESULT_B),
    publicConfig: vi.fn(),
  } as AuthAdapter
}

// Mock useAuth so Rail gets our fake adapter instead of building a real one.
vi.mock('../app/useAuth', () => ({
  useAuth: () => ({
    adapter: fakeAdapter,
    applySignIn: useSession.getState().applySignIn,
    signOut: useSession.getState().signOut,
    mock: true,
  }),
  isMockMode: () => true,
  getAuthAdapter: () => fakeAdapter,
}))

// ── render helper ─────────────────────────────────────────────────────────────

async function renderRailWithSession() {
  const { Rail } = await import('./Rail')
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={qc}>
        <Rail />
      </QueryClientProvider>
    ),
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
  return { qc }
}

// ── setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  resetFakeAdapter()
  // Set a 2-company authed session; company A is active.
  useSession.setState({
    status: 'authed',
    companies: [COMPANY_A, COMPANY_B],
    company: COMPANY_A,
    user: { id: 'usr-1', email: 'user@test.com', name: 'Test User' },
    mode: 'local',
  })
})

afterEach(() => {
  // Reset session back to a neutral state so other suites start clean.
  useSession.setState({ status: 'loading', companies: [], company: null, user: null, mode: null })
})

// ── tests ─────────────────────────────────────────────────────────────────────

describe('Rail company tiles — live session', () => {
  test('renders both companies by live name', async () => {
    await renderRailWithSession()

    expect(screen.getByRole('button', { name: /Alpha Corp/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Beta Ltd/i })).toBeInTheDocument()
  })

  test('marks company A (the active one) as aria-current', async () => {
    await renderRailWithSession()

    const tileA = screen.getByRole('button', { name: /Alpha Corp.*active/i })
    expect(tileA).toHaveAttribute('aria-current', 'true')

    // Company B tile should NOT have aria-current.
    const tileB = screen.getByRole('button', { name: /^Beta Ltd/i })
    expect(tileB).not.toHaveAttribute('aria-current', 'true')
  })

  test('clicking company B calls switchCompany with its id', async () => {
    const user = userEvent.setup()
    await renderRailWithSession()

    const tileB = screen.getByRole('button', { name: /^Beta Ltd/i })
    await act(async () => {
      await user.click(tileB)
    })

    expect(fakeAdapter.switchCompany).toHaveBeenCalledWith('cmp-b')
  })

  test('clicking the already-active company A does NOT call switchCompany', async () => {
    const user = userEvent.setup()
    await renderRailWithSession()

    const tileA = screen.getByRole('button', { name: /Alpha Corp.*active/i })
    await act(async () => {
      await user.click(tileA)
    })

    expect(fakeAdapter.switchCompany).not.toHaveBeenCalled()
  })
})

describe('Rail.tsx — no COMPANIES import from app/companies', () => {
  test('Rail uses live session companies, not the static fixture', async () => {
    // Set a session with only one company that does not appear in the static COMPANIES fixture.
    const ONLY_C: Company = { id: 'cmp-c', name: 'Gamma Inc', currency: 'SGD' }
    useSession.setState({
      status: 'authed',
      companies: [ONLY_C],
      company: ONLY_C,
      user: { id: 'u', email: 'u@t.com', name: 'U' },
      mode: 'local',
    })

    const { Rail } = await import('./Rail')
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const root = createRootRoute({
      component: () => (
        <QueryClientProvider client={qc}>
          <Rail />
        </QueryClientProvider>
      ),
    })
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    await router.load()
    render(<RouterProvider router={router} />)

    // If Rail used the static COMPANIES fixture it would show 'Sahabat Warga'/'Kopi Kenangan'.
    // Since it uses the live session, only 'Gamma Inc' appears.
    expect(screen.getByRole('button', { name: /Gamma Inc.*active/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Sahabat Warga/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Kopi Kenangan/i })).not.toBeInTheDocument()
  })
})
