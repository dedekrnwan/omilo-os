import { useEffect } from 'react'
import { Outlet, useLocation } from '@tanstack/react-router'
import { Rail } from '../ui/Rail'
import { TopBar } from '../ui/TopBar'
import { useUIStore } from './store'

/**
 * App shell: left Rail + a sidebar slot (reserved, currently empty) + a main
 * area that renders the active route via <Outlet />.
 *
 * Route-change tracking: whenever the location changes, rememberPath is called
 * so the store's lastPath stays current for each mode.
 */
export function Shell() {
  const location = useLocation()
  const { mode, rememberPath } = useUIStore()

  useEffect(() => {
    rememberPath(mode, location.pathname)
  }, [location.pathname, mode, rememberPath])

  return (
    <div
      role="application"
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: 'var(--app)',
      }}
    >
      {/* Left rail */}
      <Rail />

      {/* Main content area (sidebar + center pane) */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--surface)',
        }}
      >
        {/* Top bar */}
        <TopBar />

        {/* Route content (sidebar + center rendered by feature routes) */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            overflow: 'hidden',
          }}
        >
          <Outlet />
        </div>
      </main>
    </div>
  )
}
