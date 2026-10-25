import type { Channel } from '../../core/domain/types'

/** Selected Area filter: a channel/area id, or null for "All areas". */
export type AreaFilter = string | null

/** Display name of the selected area, or null for "All areas". */
export function areaName(areaId: AreaFilter, channels: Channel[]): string | null {
  if (!areaId) return null
  return channels.find((c) => c.id === areaId)?.name ?? null
}
