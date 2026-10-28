/**
 * web.ts — web (browser) platform implementation.
 *
 * - TokenStorage: read-through to localStorage; getToken() is SYNC (no cache needed
 *   because localStorage is synchronous). getTokenAsync is an async wrapper.
 * - NotificationService: wraps the Web Notification API; never throws on denial.
 * - DeepLinkService: pure parser; onOpen is a no-op (web has no URL scheme listener).
 */

import type { Platform, TokenStorage, NotificationService, DeepLinkService } from './index'
import { parseDeepLink } from './deepLink'

const TOKEN_KEY = 'omilo_token'

function createWebTokenStorage(): TokenStorage {
  return {
    getToken(): string | null {
      if (typeof window === 'undefined') return null
      return localStorage.getItem(TOKEN_KEY)
    },

    async getTokenAsync(): Promise<string | null> {
      return this.getToken()
    },

    async setToken(t: string): Promise<void> {
      if (typeof window !== 'undefined') {
        localStorage.setItem(TOKEN_KEY, t)
      }
    },

    async clearToken(): Promise<void> {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(TOKEN_KEY)
      }
    },

    async hydrate(): Promise<void> {
      // Web: localStorage is always in sync — nothing to do.
    },
  }
}

function createWebNotificationService(): NotificationService {
  return {
    async send(title: string, body?: string): Promise<void> {
      try {
        if (typeof window === 'undefined') return
        if (!('Notification' in window)) return
        if (Notification.permission !== 'granted') return
        new Notification(title, { body })
      } catch {
        // Never throw — permission denied or API unavailable; best effort only.
      }
    },

    async setBadge(_count: number): Promise<void> {
      // Web: no Dock badge; no-op.
    },
  }
}

function createWebDeepLinkService(): DeepLinkService {
  return {
    parse: parseDeepLink,

    onOpen(_cb: (p: { route: string; params: Record<string, string> }) => void): () => void {
      // Web: no URL scheme listener — return no-op unsubscribe.
      return () => {}
    },
  }
}

export function createWebPlatform(): Platform {
  return {
    name: 'web',
    tokenStorage: createWebTokenStorage(),
    notifications: createWebNotificationService(),
    deepLinks: createWebDeepLinkService(),
  }
}
