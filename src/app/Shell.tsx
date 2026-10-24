import { useEffect, useState } from 'react'
import { Outlet, useLocation } from '@tanstack/react-router'
import { Rail } from '../ui/Rail'
import { useUIStore } from './store'
import { CommandMenu } from '../features/command-menu'
import { ChiefDm } from '../features/chief-dm'

/**
 * App shell (pen screens are 1440×900): Rail (56) · sidebar (232) · inset main.
 * Feature routes render their own sidebar + <Inset> via <Outlet />.
 *
 * Global mounts live here so they are always present inside the app:
 *   - CommandMenu (⌘/Ctrl-K)
 *   - ChiefDm (floating helper, always visible)
 *
 * Route-change tracking: the mode follows the URL, and rememberPath keeps the
 * store's lastPath current for each mode so the Chat ↔ Office switch returns
 * to where you were.
 */
export function Shell() {
  const location = useLocation()
  const { rememberPath, setMode } = useUIStore()
  const [cmdOpen, setCmdOpen] = useState(false)

  useEffect(() => {
    const mode = location.pathname.startsWith('/office') ? 'office' : 'chat'
    setMode(mode)
    rememberPath(mode, location.pathname)
  }, [location.pathname, rememberPath, setMode])

  // Global ⌘/Ctrl-K opens the command menu.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setCmdOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div role="application" className="flex h-svh w-full overflow-hidden bg-app">
      <Rail />
      <Outlet />
      <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
      <ChiefDm />
    </div>
  )
}
