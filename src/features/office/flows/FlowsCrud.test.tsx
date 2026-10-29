// ── Flows CTA wiring tests (Task 3.4) ─────────────────────────────────────────
// New flow create, Settings delete → nav, Settings duplicate, and the Inspector
// trigger "only on branch" persisting through updateNode.

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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
import { CommandsProvider } from '../../../app/CommandsProvider'
import { createMockRepos } from '../../../adapters/mock/mockRepos'
import { createMockCommands } from '../../../adapters/mock/mockCommands'
import { OfficeFlowsRoute, OfficeFlowSettingsRoute } from './index'
import { resetFlows, useFlowStore } from './editor/store'
import { Inspector } from './editor/Inspector'
import { useUIStore } from '../../../app/store'

function makeRouter(path: string, commands: Record<string, unknown>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const repos = createMockRepos()
  const cmds = { ...createMockCommands(), ...commands }
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={repos}>
          <CommandsProvider commands={cmds as never}>
            <Outlet />
          </CommandsProvider>
        </ReposProvider>
      </QueryClientProvider>
    ),
  })
  const routeTree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: '/flows', component: OfficeFlowsRoute }),
    createRoute({ getParentRoute: () => root, path: '/flows/$flowId/settings', component: OfficeFlowSettingsRoute }),
    createRoute({ getParentRoute: () => root, path: '/flows/$flowId/canvas', component: () => <div>canvas</div> }),
    createRoute({ getParentRoute: () => root, path: '/flows/$flowId/runs', component: () => <div>runs</div> }),
    createRoute({ getParentRoute: () => root, path: '/flows/$flowId/draft', component: () => <div>draft</div> }),
  ])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) })
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  vi.clearAllMocks()
  resetFlows()
  useUIStore.setState({ mode: 'office', areaId: null })
})

describe('New flow dialog — create', () => {
  test('Draft with Chief creates a flow with the typed description and navigates to its canvas', async () => {
    const user = userEvent.setup()
    const createFlow = vi.fn().mockResolvedValue({ id: 'flw-created' })
    const router = makeRouter('/flows', { createFlow })

    await user.click(await screen.findByRole('button', { name: /New flow/i }))
    const textarea = await screen.findByLabelText('What should it do?')
    await user.clear(textarea)
    await user.type(textarea, 'Send a weekly recap on Mondays')
    await user.click(screen.getByRole('button', { name: /Draft with Chief/i }))

    await waitFor(() =>
      expect(createFlow).toHaveBeenCalledWith(
        expect.objectContaining({ trigger: expect.objectContaining({ spec: expect.objectContaining({ description: 'Send a weekly recap on Mondays' }) }) }),
      ),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/flows/flw-created/canvas'))
  })
})

describe('Flow settings — danger zone', () => {
  test('Delete flow confirm calls deleteFlow and navigates to /flows', async () => {
    const user = userEvent.setup()
    const deleteFlow = vi.fn().mockResolvedValue(undefined)
    const router = makeRouter('/flows/flw-1/settings', { deleteFlow })

    // Open the delete confirm from the danger zone.
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    // Confirm in the dialog (the solid danger button).
    const confirm = await screen.findByRole('button', { name: 'Delete flow' })
    await user.click(confirm)

    await waitFor(() => expect(deleteFlow).toHaveBeenCalledWith('flw-1'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/flows'))
  })

  test('Duplicate calls duplicateFlow', async () => {
    const user = userEvent.setup()
    const duplicateFlow = vi.fn().mockResolvedValue({ id: 'flw-copy', title: 'Copy' })
    makeRouter('/flows/flw-1/settings', { duplicateFlow })

    await user.click(await screen.findByRole('button', { name: 'Duplicate' }))
    await waitFor(() => expect(duplicateFlow).toHaveBeenCalled())
  })
})

describe('Inspector — trigger "only on branch" persists via updateNode', () => {
  test('typing a branch writes it to the node config (survives a re-render)', async () => {
    // Select the trigger node of the demo flow.
    useFlowStore.getState().select('flw-insp', 'trigger')

    const { rerender } = render(<Inspector flowId="flw-insp" />)

    const branch = await screen.findByLabelText('Branch')
    fireEvent.change(branch, { target: { value: 'release/*' } })

    // Persisted to the store node config.
    const node = useFlowStore.getState().flows['flw-insp'].graph.nodes.find((n) => n.id === 'trigger')
    expect(node?.config?.branch).toBe('release/*')

    // And a fresh render reads it back (not lost local state).
    rerender(<Inspector flowId="flw-insp" />)
    expect((await screen.findByLabelText('Branch') as HTMLInputElement).value).toBe('release/*')
  })
})
