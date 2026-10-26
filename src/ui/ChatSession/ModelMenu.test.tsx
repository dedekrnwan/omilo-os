import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { ModelMenu, DEFAULT_MODEL } from './ModelMenu'

async function renderMenu() {
  const root = createRootRoute({
    component: () => <ModelMenu selected={DEFAULT_MODEL} onSelect={() => {}} defaultOpen />,
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/chat'] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
  return router
}

describe('ModelMenu — manage AI accounts', () => {
  test('the gear button navigates to Control panel › AI accounts', async () => {
    const user = userEvent.setup()
    const router = await renderMenu()
    const gear = await screen.findByRole('button', { name: 'Manage AI accounts' })
    await user.click(gear)
    expect(router.state.location.pathname).toBe('/control-panel/ai-accounts')
  })
})
