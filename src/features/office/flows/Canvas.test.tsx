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
import { OfficeFlowCanvasRoute, OfficeFlowDraftRoute, OfficeFlowRunsRoute, OfficeFlowSettingsRoute } from './index'
import { resetFlows } from './editor'
import { useToasts } from '../../../ui/ds/Toaster'

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={createMockRepos()}>
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
  test('approving the waiting run finishes it', async () => {
    const user = userEvent.setup()
    renderAt('/flows/of-deploy-triage/runs')
    await user.click(await screen.findByRole('button', { name: /approve/i }))
    expect(screen.getByText('You approved the fix')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('Succeeded').length).toBeGreaterThan(3), { timeout: 3000 })
  })

  test('filters narrow the list and a failed run can be retried', async () => {
    const user = userEvent.setup()
    renderAt('/flows/of-deploy-triage/runs')
    await user.click(await screen.findByRole('radio', { name: 'Failed' }))
    expect(screen.getByText('Run #211')).toBeInTheDocument()
    expect(screen.queryByText('Run #213')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'All' }))
    await user.click(screen.getByRole('button', { name: /retry from failed step/i }))
    expect(screen.getAllByText('Run #215').length).toBeGreaterThan(0)
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
