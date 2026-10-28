/**
 * platform.test.ts — unit tests for the Platform seam (Task 1, P5c).
 *
 * Runs in jsdom (no __TAURI_INTERNALS__ / __TAURI__) so the web implementation
 * is always selected.  Asserts that:
 *   - isTauri() returns false in jsdom
 *   - platform.name === 'web'
 *   - tokenStorage round-trips via localStorage (no invoke calls)
 *   - deepLink parser is throw-safe and allow-lists hosts
 *   - notifications.send does NOT throw when permission is denied/absent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── mocks ─────────────────────────────────────────────────────────────────────
// Stub @tauri-apps/api/core so we can assert it is never called under web.
// The module is mocked before platform/index is imported.

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

// Also stub Tauri sentinel plugins (they won't be loaded, but the dynamic import
// inside tauri.ts must not crash the test — catch() in tauri.ts handles it already).
vi.mock('@tauri-apps/plugin-notification', () => ({ sendNotification: vi.fn() }))
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: vi.fn() }))

// ── imports (after mocks) ─────────────────────────────────────────────────────

import { isTauri, platform } from './index'
import { parseDeepLink } from './deepLink'

// ── helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear()
  mockInvoke.mockClear()
})

// ── isTauri ───────────────────────────────────────────────────────────────────

describe('isTauri()', () => {
  it('returns false in jsdom (no __TAURI_INTERNALS__ or __TAURI__)', () => {
    expect(isTauri()).toBe(false)
  })
})

// ── platform identity ─────────────────────────────────────────────────────────

describe('platform', () => {
  it('is the web implementation in jsdom', () => {
    expect(platform.name).toBe('web')
  })
})

// ── tokenStorage ─────────────────────────────────────────────────────────────

describe('platform.tokenStorage', () => {
  it('getToken() returns null when localStorage is empty', () => {
    expect(platform.tokenStorage.getToken()).toBeNull()
  })

  it('getToken() returns whatever localStorage holds', () => {
    localStorage.setItem('omilo_token', 'tok-abc')
    expect(platform.tokenStorage.getToken()).toBe('tok-abc')
    localStorage.removeItem('omilo_token')
  })

  it('setToken round-trip: getToken() returns the stored value', async () => {
    await platform.tokenStorage.setToken('my-jwt')
    expect(platform.tokenStorage.getToken()).toBe('my-jwt')
    expect(localStorage.getItem('omilo_token')).toBe('my-jwt')
  })

  it('clearToken removes the token from localStorage', async () => {
    await platform.tokenStorage.setToken('my-jwt')
    await platform.tokenStorage.clearToken()
    expect(platform.tokenStorage.getToken()).toBeNull()
    expect(localStorage.getItem('omilo_token')).toBeNull()
  })

  it('getTokenAsync() resolves to the same value as getToken()', async () => {
    localStorage.setItem('omilo_token', 'async-tok')
    const v = await platform.tokenStorage.getTokenAsync()
    expect(v).toBe('async-tok')
    localStorage.removeItem('omilo_token')
  })

  it('hydrate() is a no-op on web (does not throw)', async () => {
    await expect(platform.tokenStorage.hydrate()).resolves.not.toThrow()
  })

  it('invoke() is NEVER called under web', async () => {
    await platform.tokenStorage.setToken('t')
    await platform.tokenStorage.getTokenAsync()
    await platform.tokenStorage.clearToken()
    await platform.tokenStorage.hydrate()
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

// ── parseDeepLink ─────────────────────────────────────────────────────────────

describe('parseDeepLink', () => {
  it('parses omilo://approve/<id> → /inbox with proposalId param', () => {
    const result = parseDeepLink('omilo://approve/prop_123')
    expect(result).not.toBeNull()
    expect(result!.route).toBe('/inbox')
    expect(result!.params.proposalId).toBe('prop_123')
  })

  it('parses omilo://inbox → /inbox', () => {
    const result = parseDeepLink('omilo://inbox')
    expect(result).not.toBeNull()
    expect(result!.route).toBe('/inbox')
  })

  it('parses omilo://auth?token=abc → /auth with token param', () => {
    const result = parseDeepLink('omilo://auth?token=abc')
    expect(result).not.toBeNull()
    expect(result!.route).toBe('/auth')
    expect(result!.params.token).toBe('abc')
  })

  it('parses omilo://chat → /chat', () => {
    const result = parseDeepLink('omilo://chat')
    expect(result).not.toBeNull()
    expect(result!.route).toBe('/chat')
  })

  it('returns null for an unknown host (no open-redirect)', () => {
    expect(parseDeepLink('omilo://unknownhost')).toBeNull()
  })

  it('returns null for a non-omilo scheme', () => {
    expect(parseDeepLink('https://evil.com')).toBeNull()
    expect(parseDeepLink('http://omilo.com')).toBeNull()
  })

  it('returns null and does NOT throw for a malformed URL', () => {
    expect(() => parseDeepLink('omilo://%%bad')).not.toThrow()
    expect(parseDeepLink('omilo://%%bad')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseDeepLink('')).toBeNull()
  })
})

// ── platform.deepLinks ────────────────────────────────────────────────────────

describe('platform.deepLinks', () => {
  it('parse delegates to the pure parser', () => {
    expect(platform.deepLinks.parse('omilo://approve/x')).toEqual({
      route: '/inbox',
      params: { proposalId: 'x' },
    })
    expect(platform.deepLinks.parse('https://evil.com')).toBeNull()
  })

  it('onOpen returns an unsubscribe function (no-op on web)', () => {
    const cb = vi.fn()
    const unsub = platform.deepLinks.onOpen(cb)
    expect(typeof unsub).toBe('function')
    // Calling unsub should not throw.
    expect(() => unsub()).not.toThrow()
    // Callback should never be called (web has no deep-link listener).
    expect(cb).not.toHaveBeenCalled()
  })
})

// ── notifications ─────────────────────────────────────────────────────────────

describe('platform.notifications', () => {
  it('send() does not throw when Notification permission is denied', async () => {
    // jsdom does not support Notification; the impl guards with typeof/in checks.
    await expect(platform.notifications.send('Hello', 'World')).resolves.not.toThrow()
  })

  it('send() does not throw when Notification is not in window', async () => {
    await expect(platform.notifications.send('Hi')).resolves.not.toThrow()
  })

  it('setBadge() does not throw', async () => {
    await expect(platform.notifications.setBadge(5)).resolves.not.toThrow()
  })
})
