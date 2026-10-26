import { describe, expect, test } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { RoutineDetailRoute, RoutinesRoute } from './RoutinesRoute'

function renderAt(path: string) {
  const root = createRootRoute({ component: () => <Outlet /> })
  const office = createRoute({ getParentRoute: () => root, id: 'office', component: () => <Outlet /> })
  const list = createRoute({ getParentRoute: () => office, path: '/routines', component: RoutinesRoute })
  const detail = createRoute({ getParentRoute: () => office, path: '/routines/$routineId', component: RoutineDetailRoute })
  const router = createRouter({
    routeTree: root.addChildren([office.addChildren([list, detail])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router} />)
  return router
}

describe('Office · Routines', () => {
  test('week view (I5rrK) shows the Chief banner, day headers and agent lanes', async () => {
    renderAt('/routines')
    expect(await screen.findByText('Chief keeps 15 routines running across 6 agents')).toBeInTheDocument()
    expect(screen.getByText('SAT 24 · TODAY')).toBeInTheDocument()
    expect(screen.getByText('Morning brief · weekdays')).toBeInTheDocument()
    expect(screen.getByText('Ticket triage · 08–20')).toBeInTheDocument()
    expect(screen.getByText('Quiet hours 21:00–08:00 respected')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Week' })).toHaveAttribute('aria-selected', 'true')
  })

  test('switching to List (VUmu8) shows the suggestion and routine table', async () => {
    renderAt('/routines')
    fireEvent.click(await screen.findByRole('tab', { name: 'List' }))
    expect(screen.getByText('Monday morning is crowded')).toBeInTheDocument()
    expect(screen.getByText('Goal check-ins')).toBeInTheDocument()
    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(screen.getByText('Show all 15')).toBeInTheDocument()
  })

  test('Apply both moves routines and shows the toast (FcmwG)', async () => {
    renderAt('/routines?view=list')
    fireEvent.click(await screen.findByRole('button', { name: 'Apply both' }))
    expect(screen.getByText('2 routines moved')).toBeInTheDocument()
    expect(screen.getByText('Monday is spread out — no clashes this week')).toBeInTheDocument()
    expect(screen.getByText('11:00')).toBeInTheDocument()
  })

  test('empty state (diQBZ) counts the selected templates', async () => {
    renderAt('/routines?state=empty')
    expect(await screen.findByText('No routines yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Let Chief set up 4 routines/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Social calendar/ }))
    expect(screen.getByRole('button', { name: /Let Chief set up 5 routines/ })).toBeInTheDocument()
  })

  test('row menu → Delete routine opens the confirm (aufEI → o05E12)', async () => {
    renderAt('/routines?view=list')
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Morning brief' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete routine/ }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete “Morning brief”?')
  })

  test('New routine drawer (F4RGvz) and clash variant (oY6x7)', async () => {
    renderAt('/routines')
    fireEvent.click(await screen.findByRole('button', { name: 'New routine' }))
    expect(screen.getByText('Chief suggests')).toBeInTheDocument()
    expect(screen.getByText('No clashes — Finance is free 15:30–16:00')).toBeInTheDocument()
  })

  test('clash state lists the open slots', async () => {
    renderAt('/routines?state=clash')
    expect(await screen.findByText('Chief found 3 open slots:')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Fridays · 15:30 — recommended/ })).toHaveAttribute('aria-pressed', 'true')
  })

  test('detail drawer (xuAoe) shows status, schedule and recent runs', async () => {
    renderAt('/routines/morning-brief')
    const drawer = await screen.findByRole('dialog', { name: 'Morning brief' })
    expect(drawer).toHaveTextContent('Chief · weekdays at 07:30 · managed by Chief')
    expect(drawer).toHaveTextContent('Recent runs')
    expect(screen.getByRole('tab', { name: 'Weekdays' })).toHaveAttribute('aria-selected', 'true')
  })

  test('Run now opens the running state (a2xdN) with a Stop run action', async () => {
    const router = renderAt('/routines/morning-brief')
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ state: 'running' }))
    expect(await screen.findByText('Running now · step 2 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop run' })).toBeInTheDocument()
  })

  test('paused (oTi8l), run output (SHLKI), weekly reassign (H4Cdpf), monthly (rljUL)', async () => {
    renderAt('/routines/morning-brief?state=paused')
    expect(await screen.findByText('Paused until Mon, Nov 3')).toBeInTheDocument()
  })

  test('run output drawer', async () => {
    renderAt('/routines/morning-brief?state=output')
    expect(await screen.findByText('Good morning, Mas Dede ☀️')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open routine' })).toBeInTheDocument()
  })

  test('weekly reassign shows the agent options', async () => {
    renderAt('/routines/goal-check-ins?state=reassign')
    expect(await screen.findByRole('listbox', { name: 'Who does it' })).toHaveTextContent('Chief’s pick')
    expect(screen.getByRole('button', { name: 'Thursday' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('monthly routine selects last working day', async () => {
    renderAt('/routines/monthly-cost-review')
    expect(await screen.findByRole('button', { name: /Last working day/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Next: Fri Oct 30 · Fri Nov 27 · Thu Dec 31')).toBeInTheDocument()
  })
})
