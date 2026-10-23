import type { HelperArea } from '../core/domain/types'

export const helperColor: Record<HelperArea, string> = {
  brand:     '#6366F1',
  ops:       '#0EA5E9',
  dev:       '#14B8A6',
  support:   '#EC4899',
  finance:   '#65A30D',
  marketing: '#F97316',
  sales:     '#8B5CF6',
  retro:     '#64748B',
}

export const radii = {
  xs:     4,
  sm:     6,
  base:   8,
  md:     10,
  lg:     12,
  btn:    7,
  dialog: 20,
  pill:   999,
} as const
