import { useEffect, useState } from 'react'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { Rail } from '../ui/Rail'
import { CommandMenu } from '../features/command-menu'
import { ChiefDm } from '../features/chief-dm'
import { Toaster } from '../ui/ds/Toaster'
import { AuthGate } from './AuthGate'

/**
 * App shell (pen screens are 1440×900): Rail (56) · sidebar (232) · inset main.
 * Feature routes render their own sidebar + <Inset> via <Outlet />.
 *
 * Mode is NOT derived from the URL — it's persisted client state in the store,
 * so every route is mode-neutral and the Rail toggle just flips the flag.
 *
 * Global mounts live here so they are always present inside the app:
 *   - CommandMenu (⌘/Ctrl-K)
 *   - ChiefDm (floating helper, always visible)
 */
export function Shell() {
  const [cmdOpen, setCmdOpen] = useState(false)
  // The flow editor is full-bleed with its own bottom actions — no Chief bubble there
  const inEditor = useRouterState({ select: (st) => /^\/flows\/[^/]+\/.+/.test(st.location.pathname) })

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
      <AuthGate>
        <Outlet />
      </AuthGate>
      <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
      <ChiefDm hideFab={inEditor} />
      <Toaster />
    </div>
  )
}
