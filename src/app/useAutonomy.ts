/**
 * Workspace autonomy — the single source of truth, shared by the Rail popover
 * and the Control Panel safety section.
 *
 * Autonomy is the real `company.autonomy_default` column the enforcement engine
 * reads (omilo/engine/company_safety.py). Both surfaces read it from the session
 * store and write it through PATCH /v1/company, so changing it in one place
 * shows up in the other immediately — no second, client-only copy to drift.
 */
import { useSession } from './session'
import { useCommands } from './CommandsProvider'
import { notify } from '../ui/ds/Toaster'
import type { Autonomy } from './store'

/** Validate the stored company column into an Autonomy level (default 'ask'). */
export function coerceAutonomy(v: string | undefined | null): Autonomy {
  return v === 'strict' || v === 'yolo' ? v : 'ask'
}

export function useAutonomy(): { autonomy: Autonomy; setAutonomy: (level: Autonomy) => Promise<void> } {
  const autonomy = coerceAutonomy(useSession((s) => s.company?.autonomyDefault))
  const commands = useCommands()

  async function setAutonomy(level: Autonomy): Promise<void> {
    const company = useSession.getState().company
    if (!company || coerceAutonomy(company.autonomyDefault) === level) return
    // Optimistic: patch the session so the Rail and Control Panel both reflect
    // the change at once; persist to the backend, and revert if that fails.
    useSession.setState({ company: { ...company, autonomyDefault: level } })
    try {
      await commands.updateCompanyProfile({ autonomyDefault: level })
    } catch (e) {
      useSession.setState({ company })
      notify(e instanceof Error ? e.message : 'Couldn’t change autonomy')
    }
  }

  return { autonomy, setAutonomy }
}
