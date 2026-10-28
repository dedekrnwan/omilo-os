/**
 * Adapter: InboxItem[] → the Decision / Notif / NotifGroup display shapes
 * used by NotificationsRoute and NotificationsSidebar.
 *
 * Mapping rules:
 *  - InboxItem { kind:'decision', compact:false } → Decision (full card)
 *  - All other items (update, mention, compact decision) → Notif (row)
 *  - Notif rows are grouped by calendar day (TODAY / YESTERDAY / older label)
 *  - Tag is derived from channelId: 'ch-engineering' → '#engineering'
 *  - ago uses item.askedAgo if present, else formats createdAt
 */

import type { InboxItem, HelperArea } from '../../core/domain/types'
import type { Decision, Notif, NotifGroup, NotifFilter, NotifTag } from './data'

// ── helpers ───────────────────────────────────────────────────────────────────

/** Derive a #channel tag from the channelId string. */
function tagFromChannelId(channelId: string): NotifTag {
  // 'ch-engineering' → '#engineering', 'ch-general' → '#general'
  const slug = channelId.replace(/^ch-/, '')
  return `#${slug}` as NotifTag
}

/**
 * Format an ISO date string as a relative label like "2m", "3h", "1d".
 * Falls back gracefully to "?" if the date is unparseable.
 */
function formatRelativeShort(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime()
  if (Number.isNaN(ms)) return '?'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(ms / 86_400_000)
  return `${days}d`
}

/**
 * Determine a display group label for an ISO createdAt string.
 * Returns 'TODAY', 'YESTERDAY', or a human date like '24 Oct'.
 */
function groupLabelFor(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today.getTime() - 86_400_000)

  const itemDay = new Date(d)
  itemDay.setHours(0, 0, 0, 0)

  if (itemDay.getTime() === today.getTime()) return 'TODAY'
  if (itemDay.getTime() === yesterday.getTime()) return 'YESTERDAY'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()
}

// ── public mappers ─────────────────────────────────────────────────────────────

/** Map a decision InboxItem to the Decision display shape. */
export function itemToDecision(item: InboxItem): Decision {
  const actions = item.actions?.map((a) => ({ label: a.label, primary: a.primary })) ?? [
    { label: 'Approve', primary: true },
  ]
  return {
    id: item.id,
    senderName: item.asker,
    senderArea: item.askerArea,
    ago: item.askedAgo ?? formatRelativeShort(item.createdAt),
    tag: tagFromChannelId(item.channelId),
    title: item.title,
    body: item.summary,
    actions,
  }
}

/** Map a non-decision InboxItem (or compact decision) to the Notif display shape. */
export function itemToNotif(item: InboxItem): Notif {
  const hasMention = item.kind === 'mention' || item.title.includes('@') || item.summary.includes('@')
  return {
    id: item.id,
    senderName: item.asker,
    senderArea: item.askerArea,
    ago: item.askedAgo ?? formatRelativeShort(item.createdAt),
    tag: tagFromChannelId(item.channelId),
    title: item.title,
    preview: item.summary || undefined,
    // Treat pending/mention items as unread; done/running as read
    unread: item.status === 'pending' || hasMention,
  }
}

/**
 * Convert InboxItem[] to the (decisions, groups) pair the route expects.
 *
 * Decisions = kind:'decision' && !compact && (filter permits)
 * Notifs = everything else, grouped by date
 */
export function inboxToDisplay(
  items: InboxItem[],
  filter: NotifFilter = 'all',
): { decisions: Decision[]; groups: NotifGroup[] } {
  // Decide which items are decisions vs notif rows
  const decisionItems = items.filter((i) => i.kind === 'decision' && !i.compact)
  const notifItems = items.filter((i) => !(i.kind === 'decision' && !i.compact))

  // Apply filter
  function passesFilter(item: InboxItem): boolean {
    if (filter === 'all') return true
    if (filter === 'needs-you') return !!item.needsYou
    if (filter === 'mentions') {
      return item.kind === 'mention' || item.title.includes('@') || item.summary.includes('@')
    }
    // area filter — match on askerArea
    return item.askerArea === (filter as HelperArea)
  }

  const filteredDecisions = decisionItems.filter(passesFilter).map(itemToDecision)

  // For 'needs-you', show only decision cards — no notif rows
  if (filter === 'needs-you') {
    return { decisions: filteredDecisions, groups: [] }
  }

  const filteredNotifs = notifItems.filter(passesFilter)

  // Group notifs by date, preserving server order (newest first typically)
  const groupMap = new Map<string, Notif[]>()
  for (const item of filteredNotifs) {
    const label = groupLabelFor(item.createdAt)
    const existing = groupMap.get(label)
    const notif = itemToNotif(item)
    if (existing) {
      existing.push(notif)
    } else {
      groupMap.set(label, [notif])
    }
  }

  const groups: NotifGroup[] = Array.from(groupMap.entries()).map(([label, notifList]) => ({
    label,
    items: notifList,
  }))

  return { decisions: filteredDecisions, groups }
}

/**
 * Derive the set of unique askerAreas from InboxItem[] for the sidebar.
 */
export function areasFromItems(items: InboxItem[]): HelperArea[] {
  return Array.from(new Set(items.map((i) => i.askerArea)))
}

/**
 * Count items that pass a given filter (for sidebar counts).
 */
export function countForFilter(items: InboxItem[], filter: NotifFilter): number {
  const { decisions, groups } = inboxToDisplay(items, filter)
  return decisions.length + groups.flatMap((g) => g.items).length
}
