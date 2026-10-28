// ── Flow editor behaviour: canvas, runs and settings ──────────────────────────

import { beforeEach, describe, expect, test } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
import type { Repos } from '../../../core/ports/repos'
import { OfficeFlowCanvasRoute, OfficeFlowDraftRoute, OfficeFlowRunsRoute, OfficeFlowSettingsRoute } from './index'
import { resetFlows } from './editor'
import { useToasts } from '../../../ui/ds/Toaster'

/**
 * Demo runs seeded for the `of-deploy-triage` flow in Canvas.test.tsx.
 * These mirror the local RUNS fixture (now removed from makeFlow) so that
 * the runs-page interaction tests (approve, retry, filter) continue to work.
 */
const DEMO_RUNS_FOR_DEPLOY_TRIAGE = [
  { id: 'r214', flowId: 'of-deploy-triage', status: 'waiting', triggerSummary: 'api@4f2c1 · migration step failed', startedBy: 'GitHub', costCredits: 18, duration: 51, waitingFor: '3m', jobIds: [], startedAt: '2026-10-28T10:48:00Z', endedAt: null },
  { id: 'r213', flowId: 'of-deploy-triage', status: 'succeeded', triggerSummary: 'web@91aa0 · flaky test, re-run passed', startedBy: 'GitHub', costCredits: 14, duration: 38, waitingFor: null, jobIds: [], startedAt: '2026-10-27T10:00:00Z', endedAt: '2026-10-27T10:00:38Z' },
  { id: 'r212', flowId: 'of-deploy-triage', status: 'done', triggerSummary: 'docs@77b1e · P3, posted FYI', startedBy: 'GitHub', costCredits: 11, duration: 9, waitingFor: null, jobIds: [], startedAt: '2026-10-27T08:00:00Z', endedAt: '2026-10-27T08:00:09Z' },
  { id: 'r211', flowId: 'of-deploy-triage', status: 'failed', triggerSummary: 'api@e03d9 · Ops step timed out', startedBy: 'GitHub', costCredits: 20, duration: 120, waitingFor: null, jobIds: [], startedAt: '2026-10-27T06:00:00Z', endedAt: '2026-10-27T06:02:00Z' },
  { id: 'r210', flowId: 'of-deploy-triage', status: 'succeeded', triggerSummary: 'api@a1c44 · rollback guard PR merged', startedBy: 'GitHub', costCredits: 19, duration: 252, waitingFor: null, jobIds: [], startedAt: '2026-10-26T10:00:00Z', endedAt: '2026-10-26T10:04:12Z' },
  { id: 'r209', flowId: 'of-deploy-triage', status: 'succeeded', triggerSummary: 'worker@5d2e1 · env var missing', startedBy: 'GitHub', costCredits: 16, duration: 44, waitingFor: null, jobIds: [], startedAt: '2026-10-25T10:00:00Z', endedAt: '2026-10-25T10:00:44Z' },
]

function renderAt(path: string, reposOverride?: Partial<Repos>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const repos = { ...createMockRepos(), ...reposOverride }
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={repos}>
          <Outlet />
        </ReposProvider>
      </QueryClientProvider>
    ),
  })
  const r = (p: string, component: () => React.ReactNode) => createRoute({ getParentRoute: () => root, path: p, component })
  const router = createRouter({
    routeTree: root.addChildren([
      r('/flows', () => <h1>Flows board</h1>),
      r('/flows/$flowId/canvas', OfficeFlowCanvasRoute),
      r('/flows/$flowId/draft', OfficeFlowDraftRoute),
      r('/flows/$flowId/runs', OfficeFlowRunsRoute),
      r('/flows/$flowId/settings', OfficeFlowSettingsRoute),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router} />)
  return router
}

/** Repos override that provides demo runs for of-deploy-triage. */
function withDeployTriageRuns(): Partial<Repos> {
  return {
    flows: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      list: () => Promise.resolve([]),
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      get: (_id) => Promise.resolve(null),
      runs: (flowId) => {
        if (flowId === 'of-deploy-triage') return Promise.resolve(DEMO_RUNS_FOR_DEPLOY_TRIAGE as never)
        return Promise.resolve([])
      },
    },
  }
}

const nodes = () => document.querySelectorAll('[data-node]')

beforeEach(() => {
  resetFlows()
  useToasts.setState({ toasts: [] })
})

describe('Flow canvas', () => {
  test('selecting a step shows it in the inspector', async () => {
    const user = userEvent.setup()
    renderAt('/flows/of-deploy-triage/canvas')
    expect(await screen.findByTestId('detail-panel-label')).toHaveTextContent('Read logs, find the cause')
    await user.click(screen.getByRole('button', { name: 'Deploy fails on main' }))
    expect(screen.getByTestId('detail-panel-label')).toHaveTextContent('Deploy fails on main')
  })

  test('clicking a palette step adds it to the canvas, undo removes it', async () => {
    const user = userEvent.setup()
    renderAt('/flows/of-deploy-triage/canvas')
    await screen.findByTestId('detail-panel-label')
    const before = nodes().length
    await user.click(screen.getByRole('button', { name: 'Add Schedule' }))
    expect(nodes().length).toBe(before + 1)
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(nodes().length).toBe(before)
  })

  test('the + on a wire inserts a step between two steps', async () => {
    const user = userEvent.setup()
    renderAt('/flows/of-deploy-triage/canvas')
    await screen.findByTestId('detail-panel-label')
    const before = nodes().length
    await user.click(screen.getAllByRole('button', { name: 'Insert a step here' })[0])
    await user.click(await screen.findByRole('button', { name: 'Classify' }))
    expect(nodes().length).toBe(before + 1)
    expect(screen.getByTestId('detail-panel-label')).toHaveTextContent('Classify')
  })

  test('deleting the selected step from its menu', async () => {
    const user = userEvent.setup()
    renderAt('/flows/of-deploy-triage/canvas')
    await screen.findByTestId('detail-panel-label')
    await user.click(screen.getByRole('button', { name: 'Step actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /delete step/i }))
    expect(screen.queryByRole('button', { name: 'Read logs, find the cause' })).not.toBeInTheDocument()
  })

  test('Test run shows the result sheet, Publish clears unpublished changes', async () => {
    const user = userEvent.setup()
    renderAt('/flows/of-deploy-triage/canvas')
    await screen.findByTestId('detail-panel-label')
    await user.click(screen.getByRole('button', { name: 'Test run' }))
    const sheet = await screen.findByRole('dialog', { name: 'Test run result' })
    await waitFor(() => expect(within(sheet).getByText('Test passed')).toBeInTheDocument(), { timeout: 3000 })
    await user.click(within(sheet).getByRole('button', { name: /publish changes/i }))
    expect(screen.queryByRole('dialog', { name: 'Test run result' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Published' })).toBeDisabled()
  })

  test('guardrail switches toggle', async () => {
    const user = userEvent.setup()
    renderAt('/flows/of-deploy-triage/canvas')
    const sw = await screen.findByRole('switch', { name: /ask in inbox if unsure/i })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await user.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'true')
  })

  test('tabs move between Canvas, Runs and Settings', async () => {
    const user = userEvent.setup()
    const router = renderAt('/flows/of-deploy-triage/canvas')
    await screen.findByTestId('detail-panel-label')
    await user.click(screen.getByRole('button', { name: 'Runs' }))
    expect(router.state.location.pathname).toBe('/flows/of-deploy-triage/runs')
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(router.state.location.pathname).toBe('/flows/of-deploy-triage/settings')
  })
})

describe('Draft from Suggested', () => {
  test('Turn on flow opens the live canvas with the flow on', async () => {
    const user = userEvent.setup()
    const router = renderAt('/flows/of-deploy-triage/draft')
    expect(await screen.findByText('Draft · not running')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Turn on flow' }))
    expect(router.state.location.pathname).toBe('/flows/of-deploy-triage/canvas')
    expect(await screen.findByRole('switch', { name: 'Flow on' })).toHaveAttribute('aria-checked', 'true')
  })

  test('Discard goes back to the board', async () => {
    const user = userEvent.setup()
    const router = renderAt('/flows/of-deploy-triage/draft')
    await user.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(router.state.location.pathname).toBe('/flows')
  })
})

describe('Flow runs', () => {
  test('waiting run is shown; approving via row menu updates chip to Running', async () => {
    const user = userEvent.setup()
    renderAt('/flows/of-deploy-triage/runs', withDeployTriageRuns())
    // Run #1 is the waiting run (r214 → index 0 → Run #1) — appears in both list and detail panel
    expect(await screen.findAllByText('Run #1')).not.toHaveLength(0)
    expect(screen.getAllByText('Waiting for you').length).toBeGreaterThan(0)
    // Open the MoreMenu for Run #1 (button is always in the DOM, just visually hidden)
    await user.click(screen.getByRole('button', { name: /run #1 actions/i }))
    // The Approve menuitem is in the dropdown
    await user.click(await screen.findByRole('menuitem', { name: /approve/i }))
    // After approval: chip in the detail panel updates to 'Running' (may appear in list + detail)
    expect((await screen.findAllByText('Running')).length).toBeGreaterThan(0)
  })

  test('filters narrow the list and a failed run can be retried', async () => {
    const user = userEvent.setup()
    renderAt('/flows/of-deploy-triage/runs', withDeployTriageRuns())
    // Wait for runs to load (Run #1 appears in both list and detail panel)
    await screen.findAllByText('Run #1')
    await user.click(screen.getByRole('radio', { name: 'Failed' }))
    // Run #4 is the failed run (r211 → index 3 → Run #4) — appears in list + detail panel
    expect(screen.getAllByText('Run #4').length).toBeGreaterThan(0)
    // Run #2 (succeeded) should not appear
    expect(screen.queryByText('Run #2')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'All' }))
    await user.click(screen.getByRole('button', { name: /retry from failed step/i }))
    // After retry: new run created (7 existing runs → Run #7)
    expect(screen.getAllByText('Run #7').length).toBeGreaterThan(0)
  })
})

describe('Flow settings', () => {
  test('edits wait for Save; the new name shows in the crumb', async () => {
    const user = userEvent.setup()
    renderAt('/flows/of-deploy-triage/settings')
    const name = await screen.findByRole('textbox', { name: 'Flow name' })
    await user.clear(name)
    await user.type(name, 'Deploy triage')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Deploy triage' })).toBeInTheDocument()
  })

  test('Discard puts settings back', async () => {
    const user = userEvent.setup()
    renderAt('/flows/of-deploy-triage/settings')
    const sw = await screen.findByRole('switch', { name: 'Weekly summary' })
    await user.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByRole('switch', { name: 'Weekly summary' })).toHaveAttribute('aria-checked', 'true')
  })

  test('deleting asks first', async () => {
    const user = userEvent.setup()
    const router = renderAt('/flows/of-deploy-triage/settings')
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Delete flow' }))
    expect(router.state.location.pathname).toBe('/flows')
  })
})

describe('Context menus', () => {
  test('right-click a step deletes it, Undo in the toast brings it back', async () => {
    const user = userEvent.setup()
    const { fireEvent } = await import('@testing-library/react')
    const { Toaster } = await import('../../../ui/ds/Toaster')
    render(<Toaster />)
    renderAt('/flows/of-deploy-triage/canvas')
    const step = await screen.findByRole('button', { name: 'Draft a fix PR' })
    fireEvent.contextMenu(step)
    await user.click(await screen.findByRole('menuitem', { name: /delete step/i }))
    expect(screen.queryByRole('button', { name: 'Draft a fix PR' })).not.toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Undo' }).at(-1)!)
    expect(screen.getByRole('button', { name: 'Draft a fix PR' })).toBeInTheDocument()
  })

  test('right-click empty canvas adds a step there', async () => {
    const user = userEvent.setup()
    const { fireEvent } = await import('@testing-library/react')
    renderAt('/flows/of-deploy-triage/canvas')
    await screen.findByTestId('detail-panel-label')
    const before = nodes().length
    fireEvent.contextMenu(screen.getByRole('application', { name: 'Flow canvas' }))
    await user.click(await screen.findByRole('menuitem', { name: 'AI' }))
    const item = await screen.findByRole('menuitem', { name: 'Classify' })
    item.focus()
    await user.keyboard('{Enter}')
    expect(nodes().length).toBe(before + 1)
  })
})
