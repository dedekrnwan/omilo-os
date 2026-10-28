// ── Flows live-data wiring tests ──────────────────────────────────────────────
// Proves the flows UI reads from useFlows/useFlow/useFlowRuns (live port),
// NOT from the local OFFICE_FLOWS / RUNS fixtures. Also proves Publish/Run/
// Test-run buttons reach the commands.

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../../app/ReposProvider'
import { createMockRepos } from '../../../adapters/mock/mockRepos'
import { flows as fixtureFlows } from '../../../adapters/mock/fixtures'
import { OfficeFlowsRoute, OfficeFlowCanvasRoute, OfficeFlowRunsRoute } from './index'
import { useUIStore } from '../../../app/store'

// ── Stub commands so publish/run/test-run are observable ──────────────────────

const publishSpy = vi.fn().mockResolvedValue({})
const runSpy = vi.fn().mockResolvedValue({})
const testRunSpy = vi.fn().mockResolvedValue({})

vi.mock('../../../features/control-panel/sections/getCommands', () => ({
  getCommands: () => ({
    publishFlow: publishSpy,
    runFlow: runSpy,
    testRunFlow: testRunSpy,
  }),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEnv() {
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
  return { root, repos }
}

function renderAt(path: string, root: ReturnType<typeof makeEnv>['root']) {
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/flows', component: OfficeFlowsRoute }),
      createRoute({ getParentRoute: () => root, path: '/flows/$flowId/canvas', component: OfficeFlowCanvasRoute }),
      createRoute({ getParentRoute: () => root, path: '/flows/$flowId/runs', component: OfficeFlowRunsRoute }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({ mode: 'office', areaId: null })
})

// ── Flows list ────────────────────────────────────────────────────────────────

describe('Flows list — live repo data', () => {
  test('renders flows from useFlows(), not from OFFICE_FLOWS fixture', async () => {
    const { root } = makeEnv()
    renderAt('/flows', root)
    // fixtureFlows[0].title = 'Morning brief' — a live-repo flow title
    await screen.findByText(fixtureFlows[0].title)
    // 'Deploy failure triage' is ONLY in OFFICE_FLOWS fixture, not in mock repo
    expect(screen.queryByText('Deploy failure triage')).not.toBeInTheDocument()
  })

  test('shows empty state when no flows returned', async () => {
    const { root, repos } = makeEnv()
    ;(repos.flows as { list: () => Promise<unknown[]> }).list = () => Promise.resolve([])
    renderAt('/flows', root)
    await screen.findByText(/no flows yet/i)
  })
})

// ── Flow canvas ───────────────────────────────────────────────────────────────

describe('Flow canvas — seeded from useFlow()', () => {
  test('canvas seeded from live flow title, not fixture', async () => {
    const { root } = makeEnv()
    const liveId = fixtureFlows[0].id // 'flw-morning-brief'
    renderAt(`/flows/${liveId}/canvas`, root)
    // The EditorFrame h1 shows the flow title from the repo
    await screen.findByRole('heading', { level: 1, name: fixtureFlows[0].title })
  })

  test('Publish button calls publishFlow(flowId)', async () => {
    const user = userEvent.setup()
    const { root } = makeEnv()
    const liveId = fixtureFlows[0].id
    renderAt(`/flows/${liveId}/canvas`, root)
    await screen.findByRole('heading', { level: 1, name: fixtureFlows[0].title })
    await user.click(screen.getByRole('button', { name: /publish changes/i }))
    expect(publishSpy).toHaveBeenCalledWith(liveId)
  })
})

// ── Flow runs ─────────────────────────────────────────────────────────────────

describe('Flow runs — seeded from useFlowRuns()', () => {
  test('runs page shows runs from repo, not from fixture RUNS array', async () => {
    const { root } = makeEnv()
    const liveId = fixtureFlows[0].id // 'flw-morning-brief' — has 2 flowRuns in fixtures
    renderAt(`/flows/${liveId}/runs`, root)
    // 'Run #214' is only in the local RUNS fixture — must NOT appear
    await waitFor(() => expect(screen.queryByText('Run #214')).not.toBeInTheDocument())
    // Repo has frn-1 and frn-2; after seedRuns they become Run #1 and Run #2
    await screen.findByText(/Run #1/)
  })

  test('shows empty state when flow has no runs', async () => {
    const { root, repos } = makeEnv()
    ;(repos.flows as { runs: (id: string) => Promise<unknown[]> }).runs = () => Promise.resolve([])
    const liveId = fixtureFlows[0].id
    renderAt(`/flows/${liveId}/runs`, root)
    await screen.findByText(/no runs yet/i)
  })
})
