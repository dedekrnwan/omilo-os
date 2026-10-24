import { describe, test, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../app/ReposProvider'
import { ChatAnalyticsRoute } from './ChatAnalyticsRoute'
import { OfficeAnalyticsRoute } from './OfficeAnalyticsRoute'

function makeRouter(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ReposProvider>
          <Outlet />
        </ReposProvider>
      </QueryClientProvider>
    ),
  })
  const chat = createRoute({ getParentRoute: () => rootRoute, path: '/chat/$channelId/analytics', component: ChatAnalyticsRoute })
  const office = createRoute({ getParentRoute: () => rootRoute, path: '/office/analytics', component: OfficeAnalyticsRoute })
  return createRouter({
    routeTree: rootRoute.addChildren([chat, office]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
}

async function mount(path: string) {
  const router = makeRouter(path)
  await router.load()
  render(<RouterProvider router={router} />)
}

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('ChatAnalyticsRoute', () => {
  test('renders the channel overview', async () => {
    await mount('/chat/ch-engineering/analytics')
    expect(await screen.findByText('Analytics · Engineering')).toBeInTheDocument()
    expect(screen.getByText('Tokens by helper')).toBeInTheDocument()
    expect(screen.getByText('Jobs done')).toBeInTheDocument()
    expect(screen.getByText('4 helpers · 2 working now')).toBeInTheDocument()
  })

  test('switches between tabs', async () => {
    await mount('/chat/ch-engineering/analytics')
    await screen.findByText('Analytics · Engineering')
    fireEvent.click(screen.getByRole('tab', { name: /Helpers/ }))
    expect(screen.getByText('Hire a helper')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Loops/ }))
    expect(screen.getByText('PR digest to #engineering')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Reliability/ }))
    expect(screen.getByText('Recent failures')).toBeInTheDocument()
    expect(screen.getByText('Top causes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Activity/ }))
    expect(screen.getByText('TODAY')).toBeInTheDocument()
    expect(screen.getByText('Show')).toBeInTheDocument()
  })

  test('Set budget opens the budget drawer', async () => {
    await mount('/chat/ch-engineering/analytics')
    await screen.findByText('Analytics · Engineering')
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))
    expect(await screen.findByText('Budget for Support')).toBeInTheDocument()
    expect(screen.getByText('When the budget runs out')).toBeInTheDocument()
  })

  test('?state=budget-reached shows the reached card and toast', async () => {
    window.history.replaceState(null, '', '/?state=budget-reached')
    await mount('/chat/ch-engineering/analytics')
    expect(await screen.findByText('Builder hit its $30 budget')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Raise budget' })).toBeInTheDocument()
  })
})

describe('OfficeAnalyticsRoute', () => {
  test('renders the company overview', async () => {
    await mount('/office/analytics')
    expect(await screen.findByText('Analytics · Sahabat Warga')).toBeInTheDocument()
    expect(screen.getByText('Spend by channel')).toBeInTheDocument()
    expect(screen.getByText('6 helpers in 4 channels · 2 working now')).toBeInTheDocument()
  })
})
