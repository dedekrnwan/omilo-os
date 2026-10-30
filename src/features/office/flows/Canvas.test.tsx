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
import { resetMockTriageFlow } from '../../../adapters/mock/sweepInboxFlows'

/** The mock repo's demo flow (trigger → AI → if → approval/post → PR → notify). */
const F = 'flw-deploy-triage'

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

const nodes = () => document.querySelectorAll('[data-node]')

beforeEach(() => {
  resetMockTriageFlow()
  resetFlows()
  useToasts.setState({ toasts: [] })
})

describe('Flow canvas', () => {
  test('selecting a step shows it in the inspector', async () => {
    const user = userEvent.setup()
    renderAt(`/flows/${F}/canvas`)
    expect(await screen.findByTestId('detail-panel-label')).toHaveTextContent('Read logs, find the cause')
    await user.click(screen.getByRole('button', { name: 'Deploy fails on main' }))
    expect(screen.getByTestId('detail-panel-label')).toHaveTextContent('Deploy fails on main')
  })

  test('clicking a palette step adds it to the canvas, undo removes it', async () => {
    const user = userEvent.setup()
    renderAt(`/flows/${F}/canvas`)
    await screen.findByTestId('detail-panel-label')
    const before = nodes().length
    await user.click(screen.getByRole('button', { name: 'Add Schedule' }))
    expect(nodes().length).toBe(before + 1)
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(nodes().length).toBe(before)
  })

  test('the + on a wire inserts a step between two steps', async () => {
    const user = userEvent.setup()
    renderAt(`/flows/${F}/canvas`)
    await screen.findByTestId('detail-panel-label')
    const before = nodes().length
    await user.click(screen.getAllByRole('button', { name: 'Insert a step here' })[0])
    await user.click(await screen.findByRole('button', { name: 'Classify' }))
    expect(nodes().length).toBe(before + 1)
    expect(screen.getByTestId('detail-panel-label')).toHaveTextContent('Classify')
  })

  test('deleting the selected step from its menu', async () => {
    const user = userEvent.setup()
    renderAt(`/flows/${F}/canvas`)
    await screen.findByTestId('detail-panel-label')
    await user.click(screen.getByRole('button', { name: 'Step actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /delete step/i }))
    expect(screen.queryByRole('button', { name: 'Read logs, find the cause' })).not.toBeInTheDocument()
  })

  test('Test run shows the real result sheet; Publish sends the flow for approval', async () => {
    const user = userEvent.setup()
    renderAt(`/flows/${F}/canvas`)
    await screen.findByTestId('detail-panel-label')
    // Make an edit so there is something to publish.
    await user.click(screen.getByRole('button', { name: 'Add Schedule' }))
    await user.click(screen.getByRole('button', { name: 'Test run' }))
    const sheet = await screen.findByRole('dialog', { name: 'Test run result' })
    await waitFor(() => expect(within(sheet).getByText('Test passed')).toBeInTheDocument(), { timeout: 3000 })
    // Steps come from the run's step log, connectors are skipped in tests.
    expect(within(sheet).getByText('Read logs, find the cause')).toBeInTheDocument()
    expect(within(sheet).getAllByText('Skipped in test').length).toBeGreaterThan(0)
    await user.click(within(sheet).getByRole('button', { name: /publish changes/i }))
    expect(screen.queryByRole('dialog', { name: 'Test run result' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Waiting for approval' })).toBeDisabled()
  })

  test('guardrail switches toggle', async () => {
    const user = userEvent.setup()
    renderAt(`/flows/${F}/canvas`)
    const sw = await screen.findByRole('switch', { name: /ask in inbox if unsure/i })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await user.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'true')
  })

  test('tabs move between Canvas, Runs and Settings', async () => {
    const user = userEvent.setup()
    const router = renderAt(`/flows/${F}/canvas`)
    await screen.findByTestId('detail-panel-label')
    await user.click(screen.getByRole('button', { name: 'Runs' }))
    expect(router.state.location.pathname).toBe(`/flows/${F}/runs`)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(router.state.location.pathname).toBe(`/flows/${F}/settings`)
  })
})

describe('Draft from Suggested', () => {
  test('Turn on flow switches it on, sends it for approval and opens the live canvas', async () => {
    const user = userEvent.setup()
    const router = renderAt('/flows/flw-incident-response/draft')
    expect(await screen.findByText('Draft · not running')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Turn on flow' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/flows/flw-incident-response/canvas'))
    expect(await screen.findByRole('switch', { name: 'Flow on' })).toHaveAttribute('aria-checked', 'true')
    expect(await screen.findByRole('button', { name: 'Waiting for approval' })).toBeInTheDocument()
  })

  test('Discard goes back to the board', async () => {
    const user = userEvent.setup()
    const router = renderAt(`/flows/${F}/draft`)
    await user.click(await screen.findByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/flows'))
  })
})

describe('Flow runs', () => {
  test('waiting run is shown with its step log; approving it from the row menu finishes the run', async () => {
    const user = userEvent.setup()
    renderAt(`/flows/${F}/runs`)
    // Newest run (#3) is waiting at the approval step — list + detail panel
    expect(await screen.findAllByText('Run #3')).not.toHaveLength(0)
    expect(screen.getAllByText(/Waiting for you/).length).toBeGreaterThan(0)
    expect(await screen.findByText('Migration 0142 failed: column referral_code already exists')).toBeInTheDocument()
    expect(screen.getByText('3 runs this week')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /run #3 actions/i }))
    await user.click(await screen.findByRole('menuitem', { name: /approve/i }))
    expect((await screen.findAllByText('Succeeded')).length).toBeGreaterThan(0)
  })

  test('filters narrow the list and a failed run can be retried', async () => {
    const user = userEvent.setup()
    renderAt(`/flows/${F}/runs`)
    await screen.findAllByText('Run #3')
    await user.click(screen.getByRole('radio', { name: 'Failed' }))
    // Run #1 is the failed run — appears in list + detail panel
    expect(screen.getAllByText('Run #1').length).toBeGreaterThan(0)
    expect(screen.queryByText('Run #2')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'All' }))
    await user.click(screen.getAllByRole('button', { name: /^retry$/i })[0])
    // A new run is started (3 existing runs → Run #4)
    expect((await screen.findAllByText('Run #4')).length).toBeGreaterThan(0)
  })

  test('Run now starts a run', async () => {
    const user = userEvent.setup()
    renderAt(`/flows/${F}/runs`)
    await screen.findAllByText('Run #3')
    await user.click(screen.getByRole('button', { name: /run now/i }))
    expect((await screen.findAllByText('Run #4')).length).toBeGreaterThan(0)
  })
})

describe('Flow settings', () => {
  test('edits wait for Save; the new name shows in the crumb', async () => {
    const user = userEvent.setup()
    renderAt(`/flows/${F}/settings`)
    const name = await screen.findByRole('textbox', { name: 'Flow name' })
    await waitFor(() => expect(name).toHaveValue('Deploy failure triage'))
    await user.clear(name)
    await user.type(name, 'Deploy triage')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Deploy triage' })).toBeInTheDocument()
  })

  test('Discard puts settings back', async () => {
    const user = userEvent.setup()
    renderAt(`/flows/${F}/settings`)
    const sw = await screen.findByRole('switch', { name: 'Weekly summary' })
    await user.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByRole('switch', { name: 'Weekly summary' })).toHaveAttribute('aria-checked', 'true')
  })

  test('token usage and version history come from the flow', async () => {
    renderAt(`/flows/${F}/settings`)
    expect(await screen.findByText(/used this month/)).toBeInTheDocument()
    expect(await screen.findByText('v7')).toBeInTheDocument()
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
  })

  test('deleting asks first', async () => {
    const user = userEvent.setup()
    const router = renderAt(`/flows/${F}/settings`)
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Delete flow' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/flows'))
  })
})

describe('Context menus', () => {
  test('right-click a step deletes it, Undo in the toast brings it back', async () => {
    const user = userEvent.setup()
    const { fireEvent } = await import('@testing-library/react')
    const { Toaster } = await import('../../../ui/ds/Toaster')
    render(<Toaster />)
    renderAt(`/flows/${F}/canvas`)
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
    renderAt(`/flows/${F}/canvas`)
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
