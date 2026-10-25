// ── Canvas interactivity behaviour tests ───────────────────────────────────────
// Verifies:
//  1. Selecting a node shows its label in the detail panel.
//  2. Adding a step from the palette increases the node count.

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
import { ReposProvider } from '../../../app/ReposProvider'
import { createMockRepos } from '../../../adapters/mock/mockRepos'
import { OfficeFlowCanvasRoute } from './index'
import { CANVAS_NODES } from './data'

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeRouter(flowId = 'of-deploy-triage') {
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

  const flowsLayout = createRoute({ getParentRoute: () => root, path: '/office/flows', component: Outlet })
  const canvas = createRoute({
    getParentRoute: () => flowsLayout,
    path: '$flowId/canvas',
    component: OfficeFlowCanvasRoute,
  })

  const history = createMemoryHistory({ initialEntries: [`/office/flows/${flowId}/canvas`] })
  return createRouter({
    routeTree: root.addChildren([flowsLayout.addChildren([canvas])]),
    history,
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Canvas interactivity', () => {
  test('selecting a node updates the detail panel label', async () => {
    const user = userEvent.setup()
    const router = makeRouter()
    render(<RouterProvider router={router} />)

    // The default selected node is n-read-logs
    const defaultNode = CANVAS_NODES.find((n) => n.id === 'n-read-logs')!
    expect(await screen.findByTestId('detail-panel-label')).toHaveTextContent(defaultNode.label)

    // Click a different node — the trigger node
    const triggerNode = CANVAS_NODES.find((n) => n.id === 'n-trigger')!
    const nodeButtons = await screen.findAllByRole('button', { name: new RegExp(triggerNode.label, 'i') })
    // The canvas node card is a button with the node label text inside
    await user.click(nodeButtons[0])

    // Detail panel should now reflect the trigger node label
    expect(screen.getByTestId('detail-panel-label')).toHaveTextContent(triggerNode.label)
  })

  test('clicking a palette item adds a node and increases node count', async () => {
    const user = userEvent.setup()
    const router = makeRouter()
    render(<RouterProvider router={router} />)

    // Wait for canvas to load
    await screen.findByTestId('detail-panel-label')

    // Count canvas node card buttons (aria-pressed buttons in the canvas)
    const initialNodeButtons = screen.getAllByRole('button', { name: /add /i })
    const initialPaletteCount = initialNodeButtons.length

    // Count all aria-pressed buttons (canvas nodes) before adding
    const initialPressedButtons = screen.getAllByRole('button').filter((b) =>
      b.hasAttribute('aria-pressed')
    )
    const initialCount = initialPressedButtons.length

    // Click a palette item (e.g. "Add Schedule")
    const paletteBtn = await screen.findByRole('button', { name: /add schedule/i })
    await user.click(paletteBtn)

    // Node count should have increased by 1
    const afterPressedButtons = screen.getAllByRole('button').filter((b) =>
      b.hasAttribute('aria-pressed')
    )
    expect(afterPressedButtons.length).toBe(initialCount + 1)

    // Palette count stays the same (we only added a canvas node, not a palette item)
    const afterPaletteCount = screen.getAllByRole('button', { name: /add /i }).length
    expect(afterPaletteCount).toBe(initialPaletteCount)
  })
})
