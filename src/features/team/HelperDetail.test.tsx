/**
 * HelperDetail behaviour tests — Task 8 (updated for P8-T6 live repo wiring).
 *
 * These tests cover wired controls in HelperDetail:
 * 1. Model dropdown opens and picking an option updates the pill label.
 * 2. Role dropdown opens and picking updates the pill label.
 * 3. Pause button toggles to Resume.
 * 4. More-options (ellipsis) menu opens and has Pause + Let go items.
 *
 * P8-T6: HelperDetail now uses useHelper(id) → needs QueryClientProvider + ReposProvider.
 * We inject a mock repo that returns a helper with the fixture-matching shape so
 * the pill/menu tests remain identical.
 */
import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { ReposProvider } from '../../app/ReposProvider'
import { CommandsProvider } from '../../app/CommandsProvider'
import { createMockCommands } from '../../adapters/mock/mockCommands'
import type { Commands } from '../../adapters/http/commands'
import type { Repos } from '../../core/ports/repos'
import type { Helper } from '../../core/domain/types'
import { HelperDetail } from './HelperDetail'
import { TeamLayout } from './TeamLayout'

// ── mock repo helper ──────────────────────────────────────────────────────────

const CHIEF_HELPER: Helper = {
  id: 'chief',
  name: 'Chief',
  area: 'brand',
  role: 'Chief of Staff',
  status: 'active',
  isChief: true,
}

/** Stateful: updateHelper (via the commands below) mutates this record and the next read sees it. */
let current: Helper | null = null

function makeCommands(): Commands {
  const c = createMockCommands()
  c.updateHelper = vi.fn((_id: string, input) => {
    if (current) {
      if (input.status !== undefined) current.status = input.status
      if (input.role !== undefined) current.role = input.role
      if (input.model !== undefined) current.model = input.model || null
    }
    return Promise.resolve(current as Helper)
  })
  return c
}

function makeRepos(helper: Helper | null = CHIEF_HELPER): Repos {
  current = helper ? { ...helper } : null
  return {
    channels: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    folders: { listByChannel: vi.fn().mockResolvedValue([]), listAll: vi.fn().mockResolvedValue([]) },
    goals: { listByChannel: vi.fn().mockResolvedValue([]), listAll: vi.fn().mockResolvedValue([]) },
    sessions: { get: vi.fn().mockResolvedValue(null), listByChannel: vi.fn().mockResolvedValue([]), listAll: vi.fn().mockResolvedValue([]) },
    messages: { listBySession: vi.fn().mockResolvedValue([]) },
    inbox: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    billingPlans: { list: vi.fn().mockResolvedValue([]) },
    billingSubscription: { get: vi.fn().mockResolvedValue(null) },
    usage: { get: vi.fn().mockResolvedValue({ balance: 0, included: 0, usedThisPeriod: 0, byHelper: [], byDay: [] }) },
    wallet: { get: vi.fn().mockResolvedValue({ autoTopupEnabled: false, autoTopupThresholdCredits: 0, autoTopupPack: null }) },
    aiAccounts: { list: vi.fn().mockResolvedValue([]) },
    marketplace: { list: vi.fn().mockResolvedValue([]) },
    connectors: { list: vi.fn().mockResolvedValue([]) },
    mcpTokens: { list: vi.fn().mockResolvedValue([]) },
    flows: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null), runs: vi.fn().mockResolvedValue([]) },
    routines: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    knowledge: { sources: vi.fn().mockResolvedValue([]), list: vi.fn().mockResolvedValue([]) },
    analytics: { overview: vi.fn().mockResolvedValue({ stats: [], series: [] }), helpers: vi.fn().mockResolvedValue([]) },
    skills: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    helpers: {
      list: vi.fn().mockImplementation(() => Promise.resolve(current ? [{ ...current }] : [])),
      get: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(current?.id === id ? { ...current } : null),
      ),
    },
    members: { list: vi.fn().mockResolvedValue([]) },
  }
}

/** Mount the HelperDetail for a given helperId via a minimal memory router. */
function renderHelperDetail(helperId: string, repos?: Repos, commands: Commands = makeCommands()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRootRoute({
    notFoundComponent: () => <div data-testid="not-found">Not found</div>,
  })
  const team = createRoute({ getParentRoute: () => root, path: '/team', component: TeamLayout })
  const detail = createRoute({ getParentRoute: () => team, path: '$helperId', component: HelperDetail })
  const routeTree = root.addChildren([team.addChildren([detail])])
  const history = createMemoryHistory({ initialEntries: [`/team/${helperId}`] })
  const router = createRouter({ routeTree, history })
  return render(
    <QueryClientProvider client={queryClient}>
      <ReposProvider repos={repos ?? makeRepos()}>
        <CommandsProvider commands={commands}>
          <RouterProvider router={router} />
        </CommandsProvider>
      </ReposProvider>
    </QueryClientProvider>,
  )
}

describe('HelperDetail — wired controls', () => {
  test('Model pill shows the initial model label', async () => {
    renderHelperDetail('chief')
    // Chief defaults to "Opus 5.5" — pill has accessible name containing the model name
    const pill = await screen.findByRole('button', { name: /Opus 5\.5/ })
    expect(pill).toBeInTheDocument()
  })

  test('Clicking the Model pill opens the model menu', async () => {
    renderHelperDetail('chief')
    const pill = await screen.findByRole('button', { name: /Opus 5\.5/ })
    fireEvent.click(pill)
    const menu = await screen.findByRole('menu', { name: /Model for Chief/i })
    expect(menu).toBeInTheDocument()
    expect(screen.queryByTestId('not-found')).toBeNull()
  })

  test('Picking a model option saves it and updates the pill label', async () => {
    const commands = makeCommands()
    renderHelperDetail('chief', undefined, commands)
    // Open the menu
    const pill = await screen.findByRole('button', { name: /Opus 5\.5/ })
    fireEvent.click(pill)
    // Pick Sonnet 5.5
    const sonnet = await screen.findByRole('menuitemradio', { name: /Sonnet 5\.5/ })
    fireEvent.click(sonnet)
    // Saved through PATCH /v1/helpers/{id}, then the pill shows the saved model
    await waitFor(() => expect(commands.updateHelper).toHaveBeenCalledWith('chief', { model: 'Sonnet 5.5' }))
    expect(await screen.findByRole('button', { name: /Sonnet 5\.5/ })).toBeInTheDocument()
    // Menu should eventually close (navigate sets state=undefined)
    await waitFor(() => {
      expect(screen.queryByRole('menu', { name: /Model for Chief/i })).toBeNull()
    })
  })

  test('Pause button toggles between Pause and Resume', async () => {
    renderHelperDetail('chief')
    const pauseBtn = await screen.findByRole('button', { name: /^Pause$/ })
    expect(pauseBtn).toBeInTheDocument()
    fireEvent.click(pauseBtn)
    expect(await screen.findByRole('button', { name: /^Resume$/ })).toBeInTheDocument()
    // Toggle back
    fireEvent.click(screen.getByRole('button', { name: /^Resume$/ }))
    expect(await screen.findByRole('button', { name: /^Pause$/ })).toBeInTheDocument()
  })

  test('More-options menu opens with Pause, and no Let go for the Chief', async () => {
    renderHelperDetail('chief')
    const moreBtn = await screen.findByRole('button', { name: /More actions/i })
    fireEvent.click(moreBtn)
    const menu = await screen.findByRole('menu', { name: /More actions/i })
    expect(menu).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Pause Chief/i })).toBeInTheDocument()
    // The Chief can't be let go
    expect(screen.queryByRole('menuitem', { name: /Let Chief go/i })).toBeNull()
  })

  test('Role pill opens a role selector and picking updates the label', async () => {
    renderHelperDetail('chief')
    // Role pill shows "Role · Chief of Staff"
    const rolePill = await screen.findByRole('button', { name: /Role · Chief of Staff/i })
    fireEvent.click(rolePill)
    const roleMenu = await screen.findByRole('menu', { name: /Select role/i })
    expect(roleMenu).toBeInTheDocument()
    // Pick Sales
    const salesOption = screen.getByRole('menuitemradio', { name: /^Sales$/i })
    fireEvent.click(salesOption)
    // Menu closes, the role is saved and the pill updates
    expect(screen.queryByRole('menu', { name: /Select role/i })).toBeNull()
    expect(await screen.findByRole('button', { name: /Role · Sales/i })).toBeInTheDocument()
  })
})
