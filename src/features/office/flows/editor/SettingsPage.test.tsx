// ── Flow settings persistence ─────────────────────────────────────────────────
// Proves Save wires the store-local saveSettings AND persists title, areas,
// enabled AND the full settings object via updateFlow (PATCH /v1/flows/{id}).

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
import { ReposProvider } from '../../../../app/ReposProvider'
import { CommandsProvider } from '../../../../app/CommandsProvider'
import { createMockRepos } from '../../../../adapters/mock/mockRepos'
import { createMockCommands } from '../../../../adapters/mock/mockCommands'
import { flows as fixtureFlows } from '../../../../adapters/mock/fixtures'
import { OfficeFlowSettingsRoute } from '../index'
import { resetFlows } from './store'

beforeEach(() => {
  vi.clearAllMocks()
  resetFlows()
})

function renderSettings(flowId: string, commands: ReturnType<typeof createMockCommands>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const repos = createMockRepos()
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={repos}>
          <CommandsProvider commands={commands}>
            <Outlet />
          </CommandsProvider>
        </ReposProvider>
      </QueryClientProvider>
    ),
  })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/flows/$flowId/settings', component: OfficeFlowSettingsRoute }),
    ]),
    history: createMemoryHistory({ initialEntries: [`/flows/${flowId}/settings`] }),
  })
  render(<RouterProvider router={router} />)
}

describe('Flow settings — Save persists backend-supported fields', () => {
  test('Save calls updateFlow with title + areas', async () => {
    const user = userEvent.setup()
    const commands = createMockCommands()
    const spy = vi.spyOn(commands, 'updateFlow')
    const liveId = fixtureFlows[0].id

    renderSettings(liveId, commands)

    // Edit the flow name so the settings form goes dirty and the SaveBar appears.
    const nameInput = await screen.findByLabelText('Flow name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed flow')

    const save = await screen.findByRole('button', { name: 'Save changes' })
    await user.click(save)

    await waitFor(() => expect(spy).toHaveBeenCalled())
    const [id, input] = spy.mock.calls[0]
    expect(id).toBe(liveId)
    expect(input.title).toBe('Renamed flow')
    expect(Array.isArray(input.areas)).toBe(true)

    // The remaining form (budget, approvals, quiet hours, notifications…) now
    // persists inside the deep-merged `settings` payload — and excludes the
    // fields that map to dedicated flow columns (name/areaId).
    expect(input.settings).toBeTypeOf('object')
    const settings = input.settings as Record<string, unknown>
    expect(settings).not.toHaveProperty('name')
    expect(settings).not.toHaveProperty('areaId')
    expect(settings).toHaveProperty('monthlyBudget')
    expect(settings).toHaveProperty('notifyFail')
  })
})
