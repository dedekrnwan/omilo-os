import { describe, expect, test } from 'vitest'
import { parseTrigger, filterItems, moveIndex } from './composerModel'

describe('parseTrigger', () => {
  test('bare @ at start opens the mention picker with empty query', () => {
    expect(parseTrigger('@')).toEqual({ kind: 'mention', query: '', index: 0 })
  })

  test('@ after a space with a partial query', () => {
    expect(parseTrigger('Ask @Ch')).toEqual({ kind: 'mention', query: 'Ch', index: 4 })
  })

  test('a trailing space closes the token', () => {
    expect(parseTrigger('Ask @Chief ')).toBeNull()
  })

  test('# opens the context picker', () => {
    expect(parseTrigger('#eng')).toEqual({ kind: 'context', query: 'eng', index: 0 })
  })

  test('/ opens the command picker', () => {
    expect(parseTrigger('run /lo')).toEqual({ kind: 'command', query: 'lo', index: 4 })
  })

  test('@ glued to a word (email) is not a trigger', () => {
    expect(parseTrigger('email a@b')).toBeNull()
  })

  test('plain text is not a trigger', () => {
    expect(parseTrigger('hello world')).toBeNull()
  })
})

describe('filterItems', () => {
  test('empty query returns the full list for the kind', () => {
    const all = filterItems('mention', '')
    expect(all.length).toBeGreaterThan(0)
    expect(all.every((i) => i.kind === 'mention')).toBe(true)
  })

  test('query matches title/value case-insensitively', () => {
    const items = filterItems('mention', 'chief')
    expect(items.some((i) => i.value === 'Chief')).toBe(true)
    expect(items.every((i) => /chief/i.test(i.title) || /chief/i.test(i.value))).toBe(true)
  })

  test('no match returns an empty list', () => {
    expect(filterItems('mention', 'zzzznope')).toEqual([])
  })

  test('command query filters the slash commands', () => {
    const items = filterItems('command', 'loop')
    expect(items.some((i) => i.value === '/loop')).toBe(true)
  })

  test('every returned item carries a stable id and the kind', () => {
    const items = filterItems('context', '')
    expect(items.every((i) => typeof i.id === 'string' && i.id.length > 0)).toBe(true)
    expect(items.every((i) => i.kind === 'context')).toBe(true)
  })
})

describe('moveIndex', () => {
  test('moves down and wraps to the top at the end', () => {
    expect(moveIndex(0, 3, 1)).toBe(1)
    expect(moveIndex(2, 3, 1)).toBe(0)
  })

  test('moves up and wraps to the bottom at the top', () => {
    expect(moveIndex(1, 3, -1)).toBe(0)
    expect(moveIndex(0, 3, -1)).toBe(2)
  })

  test('an empty list clamps to 0', () => {
    expect(moveIndex(0, 0, 1)).toBe(0)
  })
})
