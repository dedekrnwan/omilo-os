/**
 * Auth + onboarding navigation flow test (Task 6).
 * Renders pages in a minimal memory router and asserts that clicking primary
 * CTAs navigates to the expected routes.
 */
import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
import { SignUpPage } from './SignUpPage'
import { ConfirmEmailPage } from './ConfirmEmailPage'
import { CreateCompanyPage } from './CreateCompanyPage'

/**
 * Build a minimal router that mounts /auth/sign-up, /auth/confirm-email, and
 * /auth/onboarding/company. The currently-rendered path is tracked via the
 * router's state; we assert on `router.state.location.pathname`.
 */
function buildRouter(initialPath: string) {
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
    notFoundComponent: () => <div data-testid="not-found">Not found</div>,
  })

  const auth = createRoute({ getParentRoute: () => root, path: '/auth', component: () => <Outlet /> })
  const signUp = createRoute({ getParentRoute: () => auth, path: 'sign-up', component: SignUpPage })
  const confirmEmail = createRoute({ getParentRoute: () => auth, path: 'confirm-email', component: ConfirmEmailPage })

  // The onboarding path must be nested as /auth/onboarding/company per the router config
  const onboarding = createRoute({ getParentRoute: () => auth, path: 'onboarding', component: () => <Outlet /> })
  const company = createRoute({ getParentRoute: () => onboarding, path: 'company', component: CreateCompanyPage })
  const plan = createRoute({ getParentRoute: () => onboarding, path: 'plan', component: () => <div>Plan page</div> })

  const routeTree = root.addChildren([
    auth.addChildren([
      signUp,
      confirmEmail,
      onboarding.addChildren([company, plan]),
    ]),
  ])

  const history = createMemoryHistory({ initialEntries: [initialPath] })
  const router = createRouter({ routeTree, history })
  return router
}

describe('auth flow navigation', () => {
  test('sign-up → confirm-email → onboarding/company → onboarding/plan', async () => {
    const user = userEvent.setup()
    const router = buildRouter('/auth/sign-up')
    render(<RouterProvider router={router} />)

    // Step 1: on /auth/sign-up, click "Create account" → /auth/confirm-email
    const createBtn = await screen.findByRole('button', { name: 'Create account' })
    await user.click(createBtn)
    expect(router.state.location.pathname).toBe('/auth/confirm-email')

    // Step 2: on /auth/confirm-email, click "Confirm email" → /auth/onboarding/company
    const confirmBtn = await screen.findByRole('button', { name: 'Confirm email' })
    await user.click(confirmBtn)
    expect(router.state.location.pathname).toBe('/auth/onboarding/company')

    // Step 3: on /auth/onboarding/company, click "Continue" → /auth/onboarding/plan
    const continueBtn = await screen.findByRole('button', { name: 'Continue' })
    await user.click(continueBtn)
    expect(router.state.location.pathname).toBe('/auth/onboarding/plan')
  })
})
