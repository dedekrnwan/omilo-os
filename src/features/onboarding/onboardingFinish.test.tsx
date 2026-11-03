/**
 * Tests for onboarding finish wiring (T7 · P9 auth gate, Wave 2).
 *
 * (a) In HTTP mode, finishing the wizard writes the company profile Chief
 *     inferred from the interview (updateCompanyProfile — only the fields it
 *     could ground), navigates into the app, and sets the onboarded flag.
 *     There is no profile form: the wizard is Your AI → Get to know you →
 *     Check → Your team.
 * (b) An already-onboarded user hitting /onboarding is redirected to the app
 *     home, not shown the wizard.
 *
 * Command stubbing: vi.mock the createCommands module so we can spy on
 *   updateCompanyProfile; getProfileSuggestion is mocked to Chief's guess.
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

// Existing roster used by the idempotency check in completeOnboarding.
const mockHelpersList = vi.fn().mockResolvedValue([])
vi.mock('../../adapters/http/httpRepos', () => ({
  createHttpRepos: () => ({ helpers: { list: () => mockHelpersList() } }),
}))

// ── isMockMode mock — control HTTP vs mock mode per test ──────────────────────

const mockIsMockMode = vi.fn().mockReturnValue(false) // default: HTTP mode

vi.mock('../../app/useAuth', () => ({
  isMockMode: () => mockIsMockMode(),
}))

// ── Chief's profile guess from the interview ─────────────────────────────────

const mockGetProfileSuggestion = vi.fn().mockResolvedValue({
  industry: 'Fintech',
  teamSize: '11-50',
  region: 'Indonesia',
  currency: 'IDR',
  picRole: '',
})

const mockPlanTeam = vi.fn().mockResolvedValue({ by: 'rules', helpers: [] })

vi.mock('./interviewApi', async (importActual) => ({
  ...(await importActual<typeof import('./interviewApi')>()),
  getProfileSuggestion: () => mockGetProfileSuggestion(),
  planTeam: () => mockPlanTeam(),
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


// ── tests ─────────────────────────────────────────────────────────────────────

describe('onboarding finish', () => {
  beforeEach(() => {
    mockUpdateCompanyProfile.mockClear()
    mockOnboardCompany.mockClear()
    mockCreateHelper.mockClear()
    mockHelpersList.mockReset().mockResolvedValue([])
    mockPlanTeam.mockReset().mockResolvedValue({ by: 'rules', helpers: [] })
    mockIsMockMode.mockReturnValue(false) // HTTP mode by default
    localStorage.removeItem(ONBOARDED_KEY)
    // Reset to chat mode so navigate target is /chat
    useUIStore.setState({ mode: 'chat' })
  })

  afterEach(() => {
    localStorage.removeItem(ONBOARDED_KEY)
  })

  test('(a) HTTP mode: finishing writes the interview profile, navigates to app home, sets onboarded flag', async () => {
    const user = userEvent.setup()
    const router = buildRouter('/onboarding')
    render(<RouterProvider router={router} />)

    // Wizard renders at welcome step
    expect(await screen.findByRole('main', { name: 'Onboarding' })).toBeInTheDocument()

    // --- navigate through the wizard: no profile form between Know You and Check ---
    // Welcome → Your AI
    const startBtn = await screen.findByRole('button', { name: /get started|let's go|start|connect|continue/i })
    await user.click(startBtn)

    // Your AI → Know You  (find the Next/Continue button in StepYourAI)
    const yourAiNext = await screen.findByRole('button', { name: /connect and continue|continue/i })
    await user.click(yourAiNext)

    // Know You → Check (skip topic)
    const skipBtn = await screen.findByRole('button', { name: /next step/i })
    await user.click(skipBtn)
    expect(screen.queryByRole('textbox', { name: /industry/i })).not.toBeInTheDocument()

    // StepCheck — advance to StepTeam
    const looksRightBtn = await screen.findByRole('button', { name: /looks right|build my team/i })
    await user.click(looksRightBtn)

    // StepTeam — click "Create my team" to complete onboarding
    const createTeamBtn = await screen.findByRole('button', { name: /create my team/i })
    await user.click(createTeamBtn)

    // Assertions
    // 1. updateCompanyProfile got Chief's grounded fields — the empty role is left out
    await waitFor(() => {
      expect(mockUpdateCompanyProfile).toHaveBeenCalledTimes(1)
      expect(mockUpdateCompanyProfile.mock.calls[0][0]).toEqual({
        industry: 'Fintech',
        teamSize: '11-50',
        region: 'Indonesia',
        currency: 'IDR',
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

  test('(c) finishing does not re-create a helper that already exists (idempotent team)', async () => {
    const user = userEvent.setup()
    // Chief plans Support + Sales; Support already exists on the roster.
    mockPlanTeam.mockResolvedValue({
      by: 'rules',
      helpers: [
        { id: 'support', name: 'Support', area: 'support', role: 'customer support', description: 'Answers customers', reason: 'You get tickets', on: true },
        { id: 'sales', name: 'Sales', area: 'sales', role: 'sales', description: 'Chases leads', reason: 'You have leads', on: true },
      ],
    })
    mockHelpersList.mockResolvedValue([{ name: 'Support', area: 'support' }])

    const router = buildRouter('/onboarding')
    render(<RouterProvider router={router} />)

    const startBtn = await screen.findByRole('button', { name: /get started|let's go|start|connect|continue/i })
    await user.click(startBtn)
    const yourAiNext = await screen.findByRole('button', { name: /connect and continue|continue/i })
    await user.click(yourAiNext)
    const skipBtn = await screen.findByRole('button', { name: /next step/i })
    await user.click(skipBtn)
    const looksRightBtn = await screen.findByRole('button', { name: /looks right|build my team/i })
    await user.click(looksRightBtn)
    const createTeamBtn = await screen.findByRole('button', { name: /create my team/i })
    await user.click(createTeamBtn)

    // Only Sales is created; the existing Support is skipped (no duplicate).
    await waitFor(() => expect(mockCreateHelper).toHaveBeenCalledTimes(1))
    expect(mockCreateHelper).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sales', area: 'sales' }))
  })
})
