// ── Flows navigation wiring tests ─────────────────────────────────────────────
// Clicking a flow card navigates to the mode-neutral, full-screen canvas route
// (/flows/$flowId/canvas), and the canvas Back button returns to the board
// (/flows). Mirrors production: the board lives in the sidebar shell (app
// layout) while the editor lives in a separate full-screen layout — distinct
// full paths, no collision, no sidebar on the editor.

import { describe, test, expect, beforeEach } from 'vitest'
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
import { useUIStore } from '../../../app/store'
import { ModeLayout } from '../../shell/ModeLayout'
import { OfficeFlowsRoute, OfficeFlowCanvasRoute } from './index'
import { flows as repoFlows } from '../../../adapters/mock/fixtures'

beforeEach(() => useUIStore.setState({ mode: 'office' }))

function makeRoot() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const repos = createMockRepos()
  return createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={repos}>
          <Outlet />
        </ReposProvider>
      </QueryClientProvider>
    ),
    notFoundComponent: () => <div data-testid="not-found">Not found</div>,
  })
}

/** Build the production-shaped tree: app layout (sidebar) + full-screen editor layout. */
function makeTree(root: ReturnType<typeof makeRoot>) {
  const appLayout = createRoute({ getParentRoute: () => root, id: 'app', component: () => <ModeLayout /> })
  const flows = createRoute({ getParentRoute: () => appLayout, path: '/flows', component: OfficeFlowsRoute })
  const editorLayout = createRoute({ getParentRoute: () => root, id: 'editor', component: () => <Outlet /> })
  const canvas = createRoute({
    getParentRoute: () => editorLayout,
    path: '/flows/$flowId/canvas',
    component: OfficeFlowCanvasRoute,
  })
  return root.addChildren([appLayout.addChildren([flows]), editorLayout.addChildren([canvas])])
}

describe('Flows navigation', () => {
  test('clicking the first flow card navigates to /flows/<id>/canvas and renders the canvas', async () => {
    const user = userEvent.setup()
    const root = makeRoot()
    const router = createRouter({
      routeTree: makeTree(root),
      history: createMemoryHistory({ initialEntries: ['/flows'] }),
    })
    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { name: 'Flows' })).toBeInTheDocument()

    const firstFlowId = repoFlows[0].id
    const firstFlowTitle = repoFlows[0].title
    const buttons = await screen.findAllByRole('button', { name: new RegExp(firstFlowTitle, 'i') })
    await user.click(buttons[0])

    expect(router.state.location.pathname).toBe(`/flows/${firstFlowId}/canvas`)

    // The canvas must actually RENDER (not just change the URL). The canvas-only
    // "Back to Flows" button proves the full-screen editor mounted.
    expect(await screen.findByRole('button', { name: /back to flows/i })).toBeInTheDocument()
  })

  test('Back button on the canvas navigates to /flows', async () => {
    const user = userEvent.setup()
    const root = makeRoot()
    const firstFlowId = repoFlows[0].id
    const router = createRouter({
      routeTree: makeTree(root),
      history: createMemoryHistory({ initialEntries: [`/flows/${firstFlowId}/canvas`] }),
    })
    render(<RouterProvider router={router} />)

    const backBtn = await screen.findByRole('button', { name: /back to flows/i })
    await user.click(backBtn)

    expect(router.state.location.pathname).toBe('/flows')
  })
})
