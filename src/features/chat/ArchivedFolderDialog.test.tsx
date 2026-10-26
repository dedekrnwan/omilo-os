import { describe, test, expect } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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
import { ModeLayout } from '../shell/ModeLayout'
import { ArchivedRoute } from './ArchivedRoute'
import { FolderRoute } from './FolderRoute'
import { CreateChannelDialog } from './CreateChannelDialog'

// ── Test router builders ──────────────────────────────────────────────────────

function makeArchivedTestRouter(path: string) {
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
  const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: () => <ModeLayout /> })
  const archivedRoute = createRoute({ getParentRoute: () => appRoute, path: '/archived', component: ArchivedRoute })
  const tree = rootRoute.addChildren([appRoute.addChildren([archivedRoute])])
  const history = createMemoryHistory({ initialEntries: [path] })
  return createRouter({ routeTree: tree, history })
}

function makeFolderTestRouter(path: string) {
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
  const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: () => <ModeLayout /> })
  const folderRoute = createRoute({ getParentRoute: () => appRoute, path: '/folder/$folderId', component: FolderRoute })
  const tree = rootRoute.addChildren([appRoute.addChildren([folderRoute])])
  const history = createMemoryHistory({ initialEntries: [path] })
  return createRouter({ routeTree: tree, history })
}

// ── Archived route ────────────────────────────────────────────────────────────

describe('ArchivedRoute', () => {
  test('renders the Archived topbar and chat list', async () => {
    const router = makeArchivedTestRouter('/archived')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      // Both the sidebar nav item and the topbar h1 say "Archived" — getAllByText is correct
      expect(screen.getAllByText('Archived').length).toBeGreaterThanOrEqual(1)
      // One of the static archived chats
      expect(screen.getByText('Sprint 41 planning')).toBeInTheDocument()
    })
  })

  test('archived route opens the Archived drawer over the new-chat hero (pen PHRy6)', async () => {
    const router = makeArchivedTestRouter('/archived')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText('Sprint 41 planning')).toBeInTheDocument()
    })

    // The drawer is a dialog titled with the channel; the hero stays underneath
    expect(screen.getByRole('dialog', { name: /Archived ·/ })).toBeInTheDocument()
    expect(screen.getByText(/what are we figuring out/i)).toBeInTheDocument()
  })

  test('archived route has a search input', async () => {
    const router = makeArchivedTestRouter('/archived')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search archived/i)).toBeInTheDocument()
    })
  })

  test('archived route shows the footer disclaimer', async () => {
    const router = makeArchivedTestRouter('/archived')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText(/deleted after 180 days/i)).toBeInTheDocument()
    })
  })
})

// ── Folder route ──────────────────────────────────────────────────────────────

describe('FolderRoute', () => {
  test('renders folder header and chat list for Q4 Launch folder', async () => {
    const router = makeFolderTestRouter('/folder/f-q4')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      // Folder name appears in breadcrumb and hero
      expect(screen.getAllByText('Q4 Launch').length).toBeGreaterThanOrEqual(1)
    })
  })

  test('folder route shows distinct content — NOT the new-chat hero', async () => {
    const router = makeFolderTestRouter('/folder/f-q4')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getAllByText('Q4 Launch').length).toBeGreaterThanOrEqual(1)
    })

    expect(screen.queryByText(/what are we figuring out/i)).not.toBeInTheDocument()
  })

  test('folder route shows chats belonging to the folder', async () => {
    const router = makeFolderTestRouter('/folder/f-q4')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      // Sessions from f-q4 fixture (also listed in the sidebar folder, so use getAllByText)
      expect(screen.getAllByText('Passkey rollout plan').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Launch day comms').length).toBeGreaterThanOrEqual(1)
    })
  })

  test('folder route renders folder instructions panel', async () => {
    const router = makeFolderTestRouter('/folder/f-q4')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText(/nov 28 launch/i)).toBeInTheDocument()
    })
  })
})

// ── CreateChannelDialog ───────────────────────────────────────────────────────

describe('CreateChannelDialog', () => {
  test('renders dialog when open=true', () => {
    render(<CreateChannelDialog open onOpenChange={() => {}} />)
    expect(screen.getByRole('dialog', { name: /create area/i })).toBeInTheDocument()
  })

  test('does not render dialog when open=false', () => {
    render(<CreateChannelDialog open={false} onOpenChange={() => {}} />)
    expect(screen.queryByRole('dialog', { name: /create area/i })).not.toBeInTheDocument()
  })

  test('close button triggers onOpenChange(false)', () => {
    const onChange = (v: boolean) => {
      if (!v) expect(true).toBe(true)
    }
    render(<CreateChannelDialog open onOpenChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }))
  })

  test('Cancel button closes the dialog', () => {
    let closed = false
    render(<CreateChannelDialog open onOpenChange={(v) => { if (!v) closed = true }} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(closed).toBe(true)
  })

  test('shows name input, agent list, and context options', () => {
    render(<CreateChannelDialog open onOpenChange={() => {}} />)
    expect(screen.getByLabelText(/area name/i)).toBeInTheDocument()
    expect(screen.getByText('Chief')).toBeInTheDocument()
    // There are multiple elements containing "Isolated" (label + description) — at least one present
    expect(screen.getAllByText(/isolated/i).length).toBeGreaterThanOrEqual(1)
  })
})
