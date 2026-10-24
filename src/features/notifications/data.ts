/**
 * Static fixture data for the Notifications page.
 * Mirrors the design ref iUTk2.png exactly.
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

// ── Decisions data ─────────────────────────────────────────────────────────────

export const DECISIONS: Decision[] = [
  {
    id: 'd1',
    senderName: 'Chief',
    senderArea: 'brand',
    ago: '2m',
    tag: '#general',
    title: 'Chief needs your OK to send 214 messages',
    body: "WhatsApp blast to RT heads about Saturday's clean-up is drafted and waiting.",
    actions: [
      { label: 'Approve', primary: true },
      { label: 'Review' },
    ],
  },
  {
    id: 'd2',
    senderName: 'Grower',
    senderArea: 'marketing',
    ago: '2m',
    tag: '#marketing',
    title: "Grower wants you to pick Friday's post",
    body: 'Two Instagram drafts for Kampung Bersih. Pick one and it schedules itself.',
    actions: [
      { label: 'Compare drafts', primary: true },
      { label: 'Later' },
    ],
  },
  {
    id: 'd3',
    senderName: 'Support',
    senderArea: 'support',
    ago: '4m',
    tag: '#support',
    title: 'Support handed you 2 WhatsApp chats',
    body: 'A refund question and a late-pickup complaint — both need a person.',
    actions: [
      { label: 'Open chats', primary: true },
      { label: 'Assign' },
    ],
  },
]

// ── Notification groups data ────────────────────────────────────────────────

export const NOTIF_GROUPS: NotifGroup[] = [
  {
    label: 'TODAY',
    items: [
      {
        id: 'n1',
        senderName: 'Builder',
        senderArea: 'dev',
        ago: '1h',
        tag: '#engineering',
        title: 'Builder mentioned you in Passkey rollout plan',
        preview: '"@Dede can you confirm the Nov 20 cut-off before I open the PR?"',
        unread: true,
      },
      {
        id: 'n2',
        senderName: 'Sales',
        senderArea: 'sales',
        ago: '2h',
        tag: '#sales',
        title: 'Sales booked a call with RT 04 Cempaka',
        preview: "Thursday 10.00 WIB. It's on your calendar with the deck attached.",
        unread: true,
      },
      {
        id: 'n3',
        senderName: 'Grower',
        senderArea: 'marketing',
        ago: '3h',
        tag: '#marketing',
        title: 'Grower finished 2 Instagram posts',
        preview: 'Ready to review in Docs › Marketing.',
        unread: false,
      },
    ],
  },
  {
    label: 'YESTERDAY',
    items: [
      {
        id: 'n4',
        senderName: 'Finance',
        senderArea: 'finance',
        ago: '1d',
        tag: '#finance',
        title: "Finance closed October's books",
        preview: 'Spending hit Rp 12.8 JT under plan. Summary is in Docs › Finance.',
        unread: false,
      },
    ],
  },
]
