/**
 * ChooseCompanyPage — selecting a company calls switchCompany + applySignIn,
 * then navigates home (Task 5.2).
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router'
import type { AuthAdapter } from '../../adapters/http/auth'
import type { SignInResult } from '../../core/domain/session'
import { ChooseCompanyPage } from './ChooseCompanyPage'

const COMPANIES = [
  { id: 'cmp-a', name: 'Alpha Corp', currency: 'IDR' },
  { id: 'cmp-b', name: 'Beta Corp', currency: 'IDR' },
]

const SWITCH_RESULT: SignInResult = {
  user: { id: 'u1', email: 'u@omilo.app', name: 'User One' },
  company: COMPANIES[1],
  companies: COMPANIES,
  token: 'tok-b',
}

let fakeAdapter: AuthAdapter
let fakeApplySignIn: ReturnType<typeof vi.fn>

vi.mock('../../app/useAuth', () => ({
  useAuth: () => ({ adapter: fakeAdapter, applySignIn: fakeApplySignIn, signOut: vi.fn(), mock: false }),
  isMockMode: () => false,
  getAuthAdapter: () => fakeAdapter,
}))

vi.mock('../../app/session', () => ({
  useSession: () => ({
    companies: COMPANIES,
    user: { id: 'u1', email: 'u@omilo.app', name: 'User One' },
    company: COMPANIES[0],
  }),
}))

function makeRouter() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    ),
  })
  const choose = createRoute({ getParentRoute: () => root, path: '/auth/choose-company', component: ChooseCompanyPage })
  const chat = createRoute({ getParentRoute: () => root, path: '/chat', component: () => <div data-testid="chat-home">Chat</div> })
  const company = createRoute({ getParentRoute: () => root, path: '/auth/onboarding/company', component: () => <div>new co</div> })
  const signIn = createRoute({ getParentRoute: () => root, path: '/auth/sign-in', component: () => <div>sign in</div> })
  const routeTree = root.addChildren([choose, chat, company, signIn])
  const history = createMemoryHistory({ initialEntries: ['/auth/choose-company'] })
  return createRouter({ routeTree, history })
}

beforeEach(() => {
  fakeApplySignIn = vi.fn()
  fakeAdapter = { switchCompany: vi.fn().mockResolvedValue(SWITCH_RESULT) } as unknown as AuthAdapter
})

afterEach(() => vi.clearAllMocks())

describe('ChooseCompanyPage', () => {
  test('selecting a non-active company calls switchCompany + applySignIn', async () => {
    const user = userEvent.setup()
    render(<RouterProvider router={makeRouter()} />)
    const betaBtn = await screen.findByRole('button', { name: /Beta Corp/ })
    await user.click(betaBtn)
    await waitFor(() => expect(fakeAdapter.switchCompany).toHaveBeenCalledWith('cmp-b'))
    expect(fakeApplySignIn).toHaveBeenCalledWith(SWITCH_RESULT)
  })
})
