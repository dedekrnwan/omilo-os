import { describe, test, expect } from 'vitest'
import { helperColor, radii } from './tokens'

describe('design tokens', () => {
  test('helperColor maps every helper area to its spec hex', () => {
    expect(helperColor.brand).toBe('#6366F1')
    expect(helperColor.dev).toBe('#14B8A6')
    expect(helperColor.support).toBe('#EC4899')
  })

  test('helperColor covers all 8 helper areas', () => {
    const areas = ['brand', 'ops', 'dev', 'support', 'finance', 'marketing', 'sales', 'retro'] as const
    for (const area of areas) {
      expect(helperColor[area]).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  test('radii has all expected keys', () => {
    expect(radii.xs).toBe(4)
    expect(radii.sm).toBe(6)
    expect(radii.base).toBe(8)
    expect(radii.md).toBe(10)
    expect(radii.lg).toBe(12)
    expect(radii.btn).toBe(7)
    expect(radii.dialog).toBe(20)
    expect(radii.pill).toBe(999)
  })
})
