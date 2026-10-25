// ── Flows navigation wiring tests ─────────────────────────────────────────────
// Verifies that clicking a flow card navigates to its canvas route,
// and that the Back button on the canvas navigates back to /office/flows.

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
import { ModeLayout } from '../../shell/ModeLayout'
const OfficeLayout = () => <ModeLayout mode="office" />
import { OfficeFlowsRoute, OfficeFlowCanvasRoute } from './index'
import { OFFICE_FLOWS } from './data'

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

// Passthrough layout — renders Outlet only (simulates a layout route)
function Passthrough() {
  return <Outlet />
}

describe('Flows navigation', () => {
  test('clicking the first flow card navigates to /office/flows/<id>/canvas', async () => {
    const user = userEvent.setup()

    const root = makeRoot()
    const office = createRoute({ getParentRoute: () => root, path: '/office', component: OfficeLayout })
    // flows as a passthrough layout so both flows-list and canvas can share the /office/flows path
    const flowsLayout = createRoute({ getParentRoute: () => office, path: 'flows', component: Passthrough })
    const flowsList = createRoute({ getParentRoute: () => flowsLayout, path: '/', component: OfficeFlowsRoute })
    const canvas = createRoute({
      getParentRoute: () => flowsLayout,
      path: '$flowId/canvas',
      component: OfficeFlowCanvasRoute,
    })

    const history = createMemoryHistory({ initialEntries: ['/office/flows'] })
    const router = createRouter({
      routeTree: root.addChildren([
        office.addChildren([
          flowsLayout.addChildren([flowsList, canvas]),
        ]),
      ]),
      history,
    })

    render(<RouterProvider router={router} />)

    // Wait for the flows page to render
    expect(await screen.findByRole('heading', { name: 'Flows' })).toBeInTheDocument()

    // Click the first flow card by data-testid-like approach: find the button
    // that contains the first flow's title text (there may be one card button per flow)
    const firstFlowId = OFFICE_FLOWS[0].id
    const firstFlowTitle = OFFICE_FLOWS[0].title

    // Use getAllByRole and pick the first match — the flow card button
    const buttons = await screen.findAllByRole('button', { name: new RegExp(firstFlowTitle, 'i') })
    // The flow card button is a button that wraps the whole card
    const flowCardBtn = buttons[0]
    await user.click(flowCardBtn)

    // URL should now be /office/flows/<id>/canvas
    expect(router.state.location.pathname).toBe(`/office/flows/${firstFlowId}/canvas`)
  })

  test('Back button on canvas navigates to /office/flows', async () => {
    const user = userEvent.setup()

    const root = makeRoot()
    const office = createRoute({ getParentRoute: () => root, path: '/office', component: OfficeLayout })
    const flowsLayout = createRoute({ getParentRoute: () => office, path: 'flows', component: Passthrough })
    const flowsList = createRoute({ getParentRoute: () => flowsLayout, path: '/', component: OfficeFlowsRoute })
    const canvas = createRoute({
      getParentRoute: () => flowsLayout,
      path: '$flowId/canvas',
      component: OfficeFlowCanvasRoute,
    })

    const firstFlowId = OFFICE_FLOWS[0].id
    const history = createMemoryHistory({
      initialEntries: [`/office/flows/${firstFlowId}/canvas`],
    })
    const router = createRouter({
      routeTree: root.addChildren([
        office.addChildren([
          flowsLayout.addChildren([flowsList, canvas]),
        ]),
      ]),
      history,
    })

    render(<RouterProvider router={router} />)

    // Wait for canvas to render — it has a "Back to Flows" button
    const backBtn = await screen.findByRole('button', { name: /back to flows/i })
    await user.click(backBtn)

    // URL should now be /office/flows
    expect(router.state.location.pathname).toBe('/office/flows')
  })
})
