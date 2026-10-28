/**
 * tauri.ts — Tauri (desktop) platform implementation.
 *
 * ALL Tauri API imports are LAZY (dynamic import inside each method) so that a
 * web bundle never evaluates this code or causes a module-resolution error.
 *
 * Token commands provided by the Rust side (T2):
 *   get_token   → returns string | null
 *   set_token   → { token: string } → void
 *   clear_token → void
 *
 * The in-memory cache makes getToken() SYNC for callers like apiFetch / chatSocket.
 * Callers must await hydrate() at app startup before the cache is populated.
 */

import type { Platform, TokenStorage, NotificationService, DeepLinkService } from './index'
import { parseDeepLink } from './deepLink'

// ── lazy helpers ──────────────────────────────────────────────────────────────

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

// ── TokenStorage ──────────────────────────────────────────────────────────────

function createTauriTokenStorage(): TokenStorage {
  // In-memory cache populated by hydrate(); stays up-to-date after set/clearToken.
  let _cache: string | null = null

  return {
    getToken(): string | null {
      return _cache
    },

    async getTokenAsync(): Promise<string | null> {
      return tauriInvoke<string | null>('get_token')
    },

    async setToken(t: string): Promise<void> {
      await tauriInvoke<void>('set_token', { token: t })
      _cache = t
    },

    async clearToken(): Promise<void> {
      await tauriInvoke<void>('clear_token')
      _cache = null
    },

    async hydrate(): Promise<void> {
      _cache = await tauriInvoke<string | null>('get_token')
    },
  }
}

// ── NotificationService ───────────────────────────────────────────────────────

type NotificationPlugin = {
  isPermissionGranted: () => Promise<boolean>
  requestPermission: () => Promise<string>
  sendNotification: (opts: { title: string; body?: string }) => void
}

function createTauriNotificationService(): NotificationService {
  return {
    async send(title: string, body?: string): Promise<void> {
      try {
        // Lazy import of @tauri-apps/plugin-notification — mirroring the pattern
        // used for @tauri-apps/api/core above.  The plugin's Rust side IS registered
        // in lib.rs, so its JS API works; we must NOT invoke non-existent commands.
        const mod = await (
          import('@tauri-apps/plugin-notification') as Promise<NotificationPlugin>
        ).catch(() => null)
        if (!mod) return

        // Request permission if not already granted — best effort, never throw.
        let granted = await mod.isPermissionGranted().catch(() => false)
        if (!granted) {
          const status = await mod.requestPermission().catch(() => 'denied')
          granted = status === 'granted'
        }
        if (!granted) return

        mod.sendNotification({ title, body })
      } catch {
        // Never throw — best effort.
      }
    },

    async setBadge(_count: number): Promise<void> {
      // Dock-badge support requires a dedicated Rust command (e.g. set_badge)
      // that is not yet registered in src-tauri/src/lib.rs.  Rather than invoking
      // a non-existent command (which silently fails), this is an intentional no-op
      // until a follow-up task adds the Rust side.
    },
  }
}

// ── DeepLinkService ───────────────────────────────────────────────────────────

function createTauriDeepLinkService(): DeepLinkService {
  return {
    parse: parseDeepLink,

    onOpen(cb: (p: { route: string; params: Record<string, string> }) => void): () => void {
      type DeepLinkMod = { onOpenUrl: (cb: (urls: string[]) => void) => Promise<() => void> }
      let unlisten: (() => void) | undefined

      // Wire lazily — the plugin may not be installed yet.
      ;(import(/* @vite-ignore */ '@tauri-apps/plugin-deep-link') as Promise<DeepLinkMod>)
        .then(async (mod: DeepLinkMod) => {
          const unlistenFn = await mod.onOpenUrl((urls: string[]) => {
            for (const url of urls) {
              const parsed = parseDeepLink(url)
              if (parsed) cb(parsed)
            }
          })
          unlisten = unlistenFn
        })
        .catch(() => {
          // Plugin not available — deep link is a no-op.
        })

      return () => {
        if (unlisten) unlisten()
      }
    },
  }
}

// ── factory ───────────────────────────────────────────────────────────────────

export function createTauriPlatform(): Platform {
  return {
    name: 'desktop',
    tokenStorage: createTauriTokenStorage(),
    notifications: createTauriNotificationService(),
    deepLinks: createTauriDeepLinkService(),
  }
}
