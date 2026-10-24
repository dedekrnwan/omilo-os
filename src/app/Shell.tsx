import { useEffect } from 'react'
import { Outlet, useLocation } from '@tanstack/react-router'
import { Rail } from '../ui/Rail'
import { useUIStore } from './store'

/**
 * App shell (pen screens are 1440×900): Rail (56) · sidebar (232) · inset main.
 * Feature routes render their own sidebar + <Inset> via <Outlet />.
 *
 * Route-change tracking: the mode follows the URL, and rememberPath keeps the
 * store's lastPath current for each mode so the Chat ↔ Office switch returns
 * to where you were.
 */
export function Shell() {
  const location = useLocation()
  const { rememberPath, setMode } = useUIStore()

  useEffect(() => {
    const mode = location.pathname.startsWith('/office') ? 'office' : 'chat'
    setMode(mode)
    rememberPath(mode, location.pathname)
  }, [location.pathname, rememberPath, setMode])

  return (
    <div role="application" className="flex h-svh w-full overflow-hidden bg-app">
      <Rail />
      <Outlet />
    </div>
  )
}
