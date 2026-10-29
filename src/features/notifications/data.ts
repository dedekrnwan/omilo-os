/**
 * Display shapes for the Notifications page (built from live inbox items by
 * inboxAdapter.ts).
 */

import type { HelperArea } from '../../core/domain/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotifTag = `#${string}`

export interface NotifAction {
  label: string
  primary?: boolean
}

/** A decision waiting on you — pinned at the top of the page. */
export interface Decision {
  id: string
  /** Helper who sent this decision. */
  senderName: string
  senderArea: HelperArea
  /** When it was sent, e.g. "2m". */
  ago: string
  /** Tag, e.g. "#general". */
  tag: NotifTag
  /** Short subject line. */
  title: string
  body: string
  actions: NotifAction[]
  /** False once you've read it (orange dot hidden). */
  unread?: boolean
}

/** A regular notification row in the grouped list. */
export interface Notif {
  id: string
  senderName: string
  senderArea: HelperArea
  ago: string
  tag: NotifTag
  /** Short subject / preview. */
  title: string
  /** Optional second line of preview text. */
  preview?: string
  /** If true, render the blue unread dot. */
  unread?: boolean
}

export interface NotifGroup {
  label: string  // e.g. "TODAY", "YESTERDAY"
  items: Notif[]
}

export type NotifFilter = 'all' | 'needs-you' | 'mentions' | string /* area */
