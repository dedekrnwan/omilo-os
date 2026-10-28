/**
 * platform/index.ts — the Platform singleton and type definitions.
 *
 * The correct implementation is chosen at module load time:
 *   - In a browser (or jsdom) without __TAURI_INTERNALS__/__TAURI__: web impl.
 *   - Inside a Tauri webview: Tauri impl.
 *
 * The Tauri impl lives in ./tauri.ts and uses ONLY lazy dynamic imports of
 * @tauri-apps/api, so a web bundle never evaluates any Tauri code.
 */

export { parseDeepLink } from './deepLink'

// ── Interfaces ────────────────────────────────────────────────────────────────

/**
 * Token storage abstraction.
 * `getToken()` is the SYNC hot-path; it reads an in-memory cache.
 * `hydrate()` must be called at app startup (Tauri only — web is always in sync).
 */
export interface TokenStorage {
  /** Sync accessor — reads in-memory cache. Safe to call from render / apiFetch. */
  getToken(): string | null
  /** Async source-of-truth — reads keychain (Tauri) or localStorage (web). */
  getTokenAsync(): Promise<string | null>
  /** Persist a new token and update the cache. */
  setToken(t: string): Promise<void>
  /** Delete the stored token and clear the cache. */
  clearToken(): Promise<void>
  /** Populate the in-memory cache from the underlying store (no-op on web). */
  hydrate(): Promise<void>
}

export interface NotificationService {
  /** Show a native notification. Never throws. */
  send(title: string, body?: string): Promise<void>
  /** Set the app badge count (Dock on macOS). No-op on web. */
  setBadge(count: number): Promise<void>
}

export interface DeepLinkService {
  /** Pure throw-safe parser: `omilo://` → safe internal route + params, or null. */
  parse(url: string): { route: string; params: Record<string, string> } | null
  /** Register a listener for deep-link open events. Returns an unsubscribe fn. */
  onOpen(cb: (p: { route: string; params: Record<string, string> }) => void): () => void
}

export interface Platform {
  name: 'web' | 'desktop'
  tokenStorage: TokenStorage
  notifications: NotificationService
  deepLinks: DeepLinkService
}

// ── isTauri ───────────────────────────────────────────────────────────────────

/**
 * True when running inside a Tauri webview. Safe to call in jsdom — returns
 * false there (neither sentinel is injected by jsdom).
 */
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  )
}

// ── Singleton ─────────────────────────────────────────────────────────────────

import { createWebPlatform } from './web'
// createTauriPlatform is imported by reference only — the factory itself has no
// top-level Tauri API calls; invoke() is always inside async methods.
import { createTauriPlatform } from './tauri'

export const platform: Platform = isTauri()
  ? createTauriPlatform()
  : createWebPlatform()
