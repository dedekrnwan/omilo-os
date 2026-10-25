/**
 * HelperDetail behaviour tests — Task 8.
 *
 * These tests cover wired controls in HelperDetail:
 * 1. Model dropdown opens and picking an option updates the pill label.
 * 2. Role dropdown opens and picking updates the pill label.
 * 3. Pause button toggles to Resume.
 * 4. More-options (ellipsis) menu opens and has Pause + Let go items.
 */
import { describe, expect, test } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { HelperDetail } from './HelperDetail'
import { TeamLayout } from './TeamLayout'

/** Mount the HelperDetail for a given helperId via a minimal memory router. */
function renderHelperDetail(helperId: string) {
  const root = createRootRoute({
    notFoundComponent: () => <div data-testid="not-found">Not found</div>,
  })
  const team = createRoute({ getParentRoute: () => root, path: '/team', component: TeamLayout })
  const detail = createRoute({ getParentRoute: () => team, path: '$helperId', component: HelperDetail })
  const routeTree = root.addChildren([team.addChildren([detail])])
  const history = createMemoryHistory({ initialEntries: [`/team/${helperId}`] })
  const router = createRouter({ routeTree, history })
  return render(<RouterProvider router={router} />)
}

describe('HelperDetail — wired controls', () => {
  test('Model pill shows the initial model label', async () => {
    renderHelperDetail('chief')
    // Chief defaults to "Opus 5.5" — pill has accessible name containing the model name
    const pill = await screen.findByRole('button', { name: /Opus 5\.5/ })
    expect(pill).toBeInTheDocument()
  })

  test('Clicking the Model pill opens the model menu', async () => {
    renderHelperDetail('chief')
    const pill = await screen.findByRole('button', { name: /Opus 5\.5/ })
    fireEvent.click(pill)
    const menu = await screen.findByRole('menu', { name: /Model for Chief/i })
    expect(menu).toBeInTheDocument()
    expect(screen.queryByTestId('not-found')).toBeNull()
  })

  test('Picking a model option updates the pill label to the selected model', async () => {
    renderHelperDetail('chief')
    // Open the menu
    const pill = await screen.findByRole('button', { name: /Opus 5\.5/ })
    fireEvent.click(pill)
    // Pick Sonnet 5.5
    const sonnet = await screen.findByRole('menuitemradio', { name: /Sonnet 5\.5/ })
    fireEvent.click(sonnet)
    // Pill now shows Sonnet (local model state updated)
    expect(await screen.findByRole('button', { name: /Sonnet 5\.5/ })).toBeInTheDocument()
    // Menu should eventually close (navigate sets state=undefined)
    await waitFor(() => {
      expect(screen.queryByRole('menu', { name: /Model for Chief/i })).toBeNull()
    })
  })

  test('Pause button toggles between Pause and Resume', async () => {
    renderHelperDetail('chief')
    const pauseBtn = await screen.findByRole('button', { name: /^Pause$/ })
    expect(pauseBtn).toBeInTheDocument()
    fireEvent.click(pauseBtn)
    expect(await screen.findByRole('button', { name: /^Resume$/ })).toBeInTheDocument()
    // Toggle back
    fireEvent.click(screen.getByRole('button', { name: /^Resume$/ }))
    expect(await screen.findByRole('button', { name: /^Pause$/ })).toBeInTheDocument()
  })

  test('More-options menu opens with Pause and Let go items', async () => {
    renderHelperDetail('chief')
    const moreBtn = await screen.findByRole('button', { name: /More actions/i })
    fireEvent.click(moreBtn)
    const menu = await screen.findByRole('menu', { name: /More actions/i })
    expect(menu).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Pause Chief/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Let Chief go/i })).toBeInTheDocument()
  })

  test('Role pill opens a role selector and picking updates the label', async () => {
    renderHelperDetail('chief')
    // Role pill shows "Role · Chief of Staff"
    const rolePill = await screen.findByRole('button', { name: /Role · Chief of Staff/i })
    fireEvent.click(rolePill)
    const roleMenu = await screen.findByRole('menu', { name: /Select role/i })
    expect(roleMenu).toBeInTheDocument()
    // Pick Sales
    const salesOption = screen.getByRole('menuitemradio', { name: /^Sales$/i })
    fireEvent.click(salesOption)
    // Menu closes and pill updates
    expect(screen.queryByRole('menu', { name: /Select role/i })).toBeNull()
    expect(await screen.findByRole('button', { name: /Role · Sales/i })).toBeInTheDocument()
  })
})
