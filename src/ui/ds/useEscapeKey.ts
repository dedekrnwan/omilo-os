import { useEffect } from 'react'

/**
 * Calls `onClose` when the Escape key is pressed. Standard affordance for
 * dismissing drawers, dialogs and popovers. Pass `enabled=false` to suspend
 * (e.g. while the overlay is closed).
 */
export function useEscapeKey(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, enabled])
}
