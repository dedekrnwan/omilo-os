/**
 * onboardingHeader.test.tsx — unit tests for OnboardingHeader.
 *
 * Verifies that the header shows the live company name from useSession
 * rather than the hardcoded 'Sahabat Warga' constant.
 */
import { describe, test, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router'
import { useSession } from '../../app/session'
import { OnboardingHeader } from './OnboardingHeader'

function renderHeader(step: Parameters<typeof OnboardingHeader>[0]['step']) {
  const root = createRootRoute({
    component: Outlet,
  })
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <OnboardingHeader step={step} />,
  })
  const history = createMemoryHistory({ initialEntries: ['/'] })
  const router = createRouter({ routeTree: root.addChildren([index]), history })
  return render(<RouterProvider router={router} />)
}

afterEach(() => {
  useSession.setState({ company: null })
})

describe('OnboardingHeader — company name', () => {
  test('shows the real company name from useSession, not "Sahabat Warga"', async () => {
    useSession.setState({
      status: 'authed',
      company: { id: 'cmp-x', name: 'My Real Company', currency: 'IDR', onboarded: false },
    })

    renderHeader('profile')

    // Should show the real company name (findBy waits for router async render)
    expect(await screen.findByText(/My Real Company/)).toBeInTheDocument()
    // Must not show the hardcoded demo name
    expect(screen.queryByText(/Sahabat Warga/)).not.toBeInTheDocument()
  })

  test('shows fallback text when session has no company', async () => {
    useSession.setState({ status: 'anon', company: null })

    renderHeader('profile')

    // Should not crash and should show the fallback
    expect(await screen.findByText(/your workspace/i)).toBeInTheDocument()
    expect(screen.queryByText(/Sahabat Warga/)).not.toBeInTheDocument()
  })
})
