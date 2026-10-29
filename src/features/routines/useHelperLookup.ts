import { useHelpers } from '../../app/queries'
import type { Helper } from '../../core/domain/types'
import { asArea, type HelperInfo } from './data'

export interface HelperLookup {
  helpers: Helper[]
  /** Name + mascot area by helper id (falls back for unknown/deleted helpers). */
  info: (id: string) => HelperInfo
  chief: Helper | undefined
}

/** Resolves helper ids (real `hlp_…` ids in HTTP mode) via useHelpers. */
export function useHelperLookup(): HelperLookup {
  const { data: helpers = [] } = useHelpers()
  const byId = new Map(helpers.map((h) => [h.id, h]))
  return {
    helpers,
    chief: helpers.find((h) => h.isChief),
    info: (id: string) => {
      const h = byId.get(id)
      return h ? { id, name: h.name, area: asArea(h.area) } : { id, name: 'Helper', area: 'ops' }
    },
  }
}

/** Helper for a starter template: same area → Chief → first helper. */
export function pickHelperForArea(helpers: Helper[], area: string): Helper | undefined {
  if (area === 'brand') return helpers.find((h) => h.isChief) ?? helpers[0]
  return helpers.find((h) => !h.isChief && h.area === area) ?? helpers.find((h) => h.isChief) ?? helpers[0]
}
