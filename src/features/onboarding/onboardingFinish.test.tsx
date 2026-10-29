/**
 * Tests for onboarding finish wiring (T7 · P9 auth gate, Wave 2).
 *
 * (a) In HTTP mode, finishing the wizard calls updateCompanyProfile with the
 *     collected profile, navigates into the app, and sets the onboarded flag.
 * (b) An already-onboarded user hitting /onboarding is redirected to the app
 *     home, not shown the wizard.
 *
 * Command stubbing mirrors the pattern in StepProfile.test.tsx:
 *   vi.mock the createCommands module so we can spy on updateCompanyProfile.
 * Router rendering mirrors authFlow.test.tsx / routeSmoke.test.tsx:
 *   createMemoryHistory + createRouter + RouterProvider.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
import { useUIStore } from '../../app/store'
import { ONBOARDED_KEY } from './OnboardingRoute'

// ── command mock — intercept createCommands so we can spy on commands ──────────

const mockUpdateCompanyProfile = vi.fn().mockResolvedValue({
  id: 'cmp-test',
  name: 'Test Co',
  color: '',
})

const mockOnboardCompany = vi.fn().mockResolvedValue({
  id: 'cmp-test',
  name: 'Test Co',
  onboarded: true,
})

const mockCreateHelper = vi.fn().mockResolvedValue({ id: 'h-new', name: 'Helper' })

vi.mock('../../adapters/http/commands', () => ({
  createCommands: () => ({
    updateCompanyProfile: mockUpdateCompanyProfile,
    onboardCompany: mockOnboardCompany,
    createHelper: mockCreateHelper,
  }),
}))

// ── isMockMode mock — control HTTP vs mock mode per test ──────────────────────

const mockIsMockMode = vi.fn().mockReturnValue(false) // default: HTTP mode

vi.mock('../../app/useAuth', () => ({
  isMockMode: () => mockIsMockMode(),
}))

// ── import after mocks ────────────────────────────────────────────────────────

import { OnboardingRoute } from './OnboardingRoute'

// ── helpers ───────────────────────────────────────────────────────────────────

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

  // The onboarding route (standalone, no Shell — mirrors production router.tsx)
  const onboarding = createRoute({
    getParentRoute: () => root,
    path: '/onboarding',
    component: OnboardingRoute,
  })

  // A placeholder app home route so navigate({ to: '/chat' }) or '/inbox' can resolve
  const chat = createRoute({
    getParentRoute: () => root,
    path: '/chat',
    component: () => <div data-testid="app-home">App Home</div>,
  })
  const inbox = createRoute({
    getParentRoute: () => root,
    path: '/inbox',
    component: () => <div data-testid="app-home">App Home</div>,
  })

  const routeTree = root.addChildren([onboarding, chat, inbox])
  const history = createMemoryHistory({ initialEntries: [initialPath] })
  const router = createRouter({ routeTree, history })
  return router
}

// Fill in StepProfile fields and click Continue
async function fillAndSubmitProfile(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: /industry/i }), 'Fintech')
  await user.selectOptions(screen.getByRole('combobox', { name: /team size/i }), '11-50')
  await user.selectOptions(screen.getByRole('combobox', { name: /region/i }), 'Indonesia')
  await user.selectOptions(screen.getByRole('combobox', { name: /currency/i }), 'IDR')
  await user.type(screen.getByRole('textbox', { name: /your role/i }), 'Ops Lead')
  await user.click(screen.getByRole('button', { name: /continue/i }))
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('onboarding finish', () => {
  beforeEach(() => {
    mockUpdateCompanyProfile.mockClear()
    mockOnboardCompany.mockClear()
    mockIsMockMode.mockReturnValue(false) // HTTP mode by default
    localStorage.removeItem(ONBOARDED_KEY)
    // Reset to chat mode so navigate target is /chat
    useUIStore.setState({ mode: 'chat' })
  })

  afterEach(() => {
    localStorage.removeItem(ONBOARDED_KEY)
  })

  test('(a) HTTP mode: finishing calls updateCompanyProfile, navigates to app home, sets onboarded flag', async () => {
    const user = userEvent.setup()
    const router = buildRouter('/onboarding')
    render(<RouterProvider router={router} />)

    // Wizard renders at welcome step
    expect(await screen.findByRole('main', { name: 'Onboarding' })).toBeInTheDocument()

    // --- navigate through steps to reach StepProfile ---
    // Welcome → Your AI
    const startBtn = await screen.findByRole('button', { name: /get started|let's go|start|connect|continue/i })
    await user.click(startBtn)

    // Your AI → Know You  (find the Next/Continue button in StepYourAI)
    const yourAiNext = await screen.findByRole('button', { name: /connect and continue|continue/i })
    await user.click(yourAiNext)

    // Know You → Profile (skip topic)
    const skipBtn = await screen.findByRole('button', { name: /next step/i })
    await user.click(skipBtn)

    // StepProfile is now shown — fill it and submit
    await waitFor(() => expect(screen.getByRole('textbox', { name: /industry/i })).toBeInTheDocument())
    await fillAndSubmitProfile(user)

    // After profile submit, we're at StepCheck — advance to StepTeam
    const looksRightBtn = await screen.findByRole('button', { name: /looks right|build my team/i })
    await user.click(looksRightBtn)

    // StepTeam — click "Create my team" to complete onboarding
    const createTeamBtn = await screen.findByRole('button', { name: /create my team/i })
    await user.click(createTeamBtn)

    // Assertions
    // 1. updateCompanyProfile was called with the profile fields from StepProfile
    await waitFor(() => {
      // The finish call should have been made at least once (from StepProfile advance AND/OR from completeOnboarding)
      expect(mockUpdateCompanyProfile).toHaveBeenCalled()
      const lastCall = mockUpdateCompanyProfile.mock.calls[mockUpdateCompanyProfile.mock.calls.length - 1][0]
      expect(lastCall).toMatchObject({
        industry: 'Fintech',
        teamSize: '11-50',
        region: 'Indonesia',
        currency: 'IDR',
        picRole: 'Ops Lead',
      })
    })

    // 2. The onboarded flag is set in localStorage
    expect(localStorage.getItem(ONBOARDED_KEY)).toBe('1')

    // 3. Router navigated into the app (away from /onboarding)
    expect(router.state.location.pathname).not.toBe('/onboarding')
  })

  test('(a) mock mode: finishing does NOT call updateCompanyProfile, still navigates and sets flag', async () => {
    mockIsMockMode.mockReturnValue(true) // mock mode
    const user = userEvent.setup()
    const router = buildRouter('/onboarding')
    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('main', { name: 'Onboarding' })).toBeInTheDocument()

    // Navigate quickly using the step query param is not available here, so navigate steps
    const startBtn = await screen.findByRole('button', { name: /get started|let's go|start|connect|continue/i })
    await user.click(startBtn)

    const yourAiNext = await screen.findByRole('button', { name: /connect and continue|continue/i })
    await user.click(yourAiNext)

    const skipBtn = await screen.findByRole('button', { name: /next step/i })
    await user.click(skipBtn)

    await waitFor(() => expect(screen.getByRole('textbox', { name: /industry/i })).toBeInTheDocument())
    // In mock mode, StepProfile still calls createCommands internally (the mock is always there)
    // but the finish completeOnboarding should NOT call it again.
    // We clear the mock here so we can assert the finish call specifically.
    mockUpdateCompanyProfile.mockClear()
    await fillAndSubmitProfile(user)
    mockUpdateCompanyProfile.mockClear() // clear the StepProfile's own call

    const looksRightBtn = await screen.findByRole('button', { name: /looks right|build my team/i })
    await user.click(looksRightBtn)

    const createTeamBtn = await screen.findByRole('button', { name: /create my team/i })
    await user.click(createTeamBtn)

    // In mock mode, completeOnboarding must NOT call updateCompanyProfile
    await waitFor(() => {
      expect(localStorage.getItem(ONBOARDED_KEY)).toBe('1')
    })
    expect(mockUpdateCompanyProfile).not.toHaveBeenCalled()
    expect(router.state.location.pathname).not.toBe('/onboarding')
  })

  test('(c) HTTP mode: finishing calls onboardCompany to set backend flag', async () => {
    const user = userEvent.setup()
    const router = buildRouter('/onboarding')
    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('main', { name: 'Onboarding' })).toBeInTheDocument()

    // Navigate quickly through steps
    const startBtn = await screen.findByRole('button', { name: /get started|let's go|start|connect|continue/i })
    await user.click(startBtn)
    const yourAiNext = await screen.findByRole('button', { name: /connect and continue|continue/i })
    await user.click(yourAiNext)
    const skipBtn = await screen.findByRole('button', { name: /next step/i })
    await user.click(skipBtn)
    await waitFor(() => expect(screen.getByRole('textbox', { name: /industry/i })).toBeInTheDocument())
    await fillAndSubmitProfile(user)
    const looksRightBtn = await screen.findByRole('button', { name: /looks right|build my team/i })
    await user.click(looksRightBtn)
    const createTeamBtn = await screen.findByRole('button', { name: /create my team/i })
    await user.click(createTeamBtn)

    // onboardCompany must have been called in HTTP mode
    await waitFor(() => {
      expect(mockOnboardCompany).toHaveBeenCalled()
    })
    expect(router.state.location.pathname).not.toBe('/onboarding')
  })

  test('(b) already-onboarded user hitting /onboarding is redirected to app home, not shown the wizard', async () => {
    // Set the onboarded flag before rendering
    localStorage.setItem(ONBOARDED_KEY, '1')
    useUIStore.setState({ mode: 'chat' })

    const router = buildRouter('/onboarding')
    render(<RouterProvider router={router} />)

    // The redirect should happen on mount — wizard should NOT render
    await waitFor(() => {
      expect(router.state.location.pathname).not.toBe('/onboarding')
    })

    // The app home should be rendered instead
    expect(await screen.findByTestId('app-home')).toBeInTheDocument()
  })
})
