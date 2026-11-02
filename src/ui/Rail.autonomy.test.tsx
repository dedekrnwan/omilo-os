import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSession } from '../app/session'
import type { Company } from '../core/domain/session'
import { Rail } from './Rail'

async function renderRail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={qc}>
        <Rail />
      </QueryClientProvider>
    ),
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
}

const COMPANY: Company = { id: 'cmp-a', name: 'Test Co', currency: 'IDR', autonomyDefault: 'ask' }

describe('Autonomy popover', () => {
  beforeEach(() => {
    // Autonomy is the real company.autonomy_default on the session (not UI store).
    useSession.setState({ status: 'authed', company: { ...COMPANY } })
  })

  test('opening the tray → Autonomy shows the three levels', async () => {
    const user = userEvent.setup()
    await renderRail()
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('button', { name: 'Autonomy' }))
    expect(await screen.findByText('Strict')).toBeInTheDocument()
    expect(screen.getByText('Ask')).toBeInTheDocument()
    expect(screen.getByText('YOLO')).toBeInTheDocument()
  })

  test('picking YOLO writes the autonomy level to the session company (shared source)', async () => {
    const user = userEvent.setup()
    await renderRail()
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('button', { name: 'Autonomy' }))
    await user.click(await screen.findByRole('button', { name: /YOLO/ }))
    // Same column the Control Panel and the enforcement engine read — not a UI-only copy.
    expect(useSession.getState().company?.autonomyDefault).toBe('yolo')
  })

  test('the ⋯ tray opens on click and closes on Escape (not hover)', async () => {
    const user = userEvent.setup()
    await renderRail()
    // Collapsed: tray items are hidden.
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()
    // Click opens the tray.
    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    // Escape closes it.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()
  })
})
