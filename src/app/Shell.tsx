import { useEffect } from 'react'
import { Outlet, useLocation } from '@tanstack/react-router'
import { Rail } from '../ui/Rail'
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

      {/* Sidebar slot — reserved for channel/inbox list panels (Tasks 7 & 8) */}
      <div
        aria-label="sidebar"
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--soft)',
          borderRight: '1px solid var(--line-strong)',
        }}
      />

      {/* Main content area */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--surface)',
        }}
      >
        <Outlet />
      </main>
    </div>
  )
}
