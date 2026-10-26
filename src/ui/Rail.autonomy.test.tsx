import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { useUIStore } from '../app/store'
import { Rail } from './Rail'

async function renderRail() {
  const root = createRootRoute({ component: () => <Rail /> })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
}

describe('Autonomy popover', () => {
  beforeEach(() => {
    useUIStore.setState({ autonomy: 'ask' })
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

  test('picking YOLO updates and persists the autonomy level', async () => {
    const user = userEvent.setup()
    await renderRail()
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('button', { name: 'Autonomy' }))
    await user.click(await screen.findByRole('button', { name: /YOLO/ }))
    expect(useUIStore.getState().autonomy).toBe('yolo')
    expect(JSON.parse(localStorage.getItem('omilo-ui') ?? '{}').state.autonomy).toBe('yolo')
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
