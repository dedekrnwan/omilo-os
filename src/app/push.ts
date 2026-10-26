/**
 * Push / desktop notifications engine.
 *
 * Browser today (the Web Notification API), Tauri desktop later. The surface is
 * kept deliberately tiny — callers only touch `pushSupported`, `pushPermission`,
 * `requestPush`, `sendPush` (and the `usePush` hook) — so swapping the browser
 * API for `@tauri-apps/plugin-notification` is a one-file change here, with no
 * churn at the call sites.
 */

import { useCallback, useEffect, useState } from 'react'

/** Browser permission state, plus an `unsupported` sentinel for old engines. */
export type PushPermission = NotificationPermission | 'unsupported'

/** The app icon shown on each notification. */
const PUSH_ICON = '/chief-mascot.png'

/** True when this runtime can show notifications at all. */
export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

/** Current permission: 'default' (not asked) · 'granted' · 'denied' · 'unsupported'. */
export function pushPermission(): PushPermission {
  if (!pushSupported()) return 'unsupported'
  return Notification.permission
}

/** Ask the user for permission. Resolves to the resulting permission state. */
export async function requestPush(): Promise<PushPermission> {
  if (!pushSupported()) return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    // Legacy Safari used a callback signature and throws on the promise form —
    // fall back to whatever the current value is.
    return Notification.permission
  }
}

export interface PushOptions {
  body?: string
  /** Collapses repeat notifications that share a tag into one. */
  tag?: string
  silent?: boolean
}

/**
 * Show a real notification when allowed. Returns true if one was shown, false
 * when unsupported or permission isn't `granted` (callers don't need to guard).
 * Clicking the notification focuses the app window.
 */
export function sendPush(title: string, opts: PushOptions = {}): boolean {
  if (pushPermission() !== 'granted') return false
  try {
    // TODO(desktop): under Tauri, route through
    // @tauri-apps/plugin-notification's `sendNotification` instead of `new Notification`.
    const n = new Notification(title, {
      body: opts.body,
      tag: opts.tag,
      silent: opts.silent,
      icon: PUSH_ICON,
    })
    n.onclick = () => {
      window.focus()
      n.close()
    }
    return true
  } catch {
    return false
  }
}

/**
 * React binding for the settings/banners. Tracks the live permission state and
 * re-reads it when the window regains focus (the user may have flipped it in
 * browser settings while away).
 */
export function usePush() {
  const [permission, setPermission] = useState<PushPermission>(() => pushPermission())

  useEffect(() => {
    const sync = () => setPermission(pushPermission())
    window.addEventListener('focus', sync)
    return () => window.removeEventListener('focus', sync)
  }, [])

  const request = useCallback(async () => {
    const result = await requestPush()
    setPermission(result)
    return result
  }, [])

  return {
    supported: pushSupported(),
    permission,
    request,
    send: sendPush,
  }
}
