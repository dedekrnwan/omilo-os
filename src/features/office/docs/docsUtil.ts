import type { Channel, CompanyMember, DocSummary, Helper } from '../../../core/domain/types'

/** "now", "5m", "2h", "3d", "2w", "4mo" since an ISO timestamp. */
export function shortAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000))
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days}d`
  if (days < 30) return `${Math.round(days / 7)}w`
  return `${Math.round(days / 30)}mo`
}

/** "just now", "2h ago", "yesterday", "3 days ago"… */
export function longAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const s = shortAgo(iso, now)
  if (s === 'now') return 'just now'
  if (s === '1d') return 'yesterday'
  const n = parseInt(s, 10)
  const unit = s.replace(String(n), '')
  const word = { m: 'min', h: 'hour', d: 'day', w: 'week', mo: 'month' }[unit] ?? unit
  return `${n} ${word}${n === 1 || word === 'min' ? '' : 's'} ago`
}

export interface WhoContext {
  userId?: string | null
  members?: CompanyMember[]
  helpers?: Helper[]
}

/** Human label for an `updated_by` / `created_by` marker. */
export function whoLabel(by: string | null | undefined, ctx: WhoContext): string {
  if (!by) return ''
  const [kind, rest = ''] = by.includes(':') ? [by.slice(0, by.indexOf(':')), by.slice(by.indexOf(':') + 1)] : [by, '']
  if (kind === 'operator') {
    if (ctx.userId && rest === ctx.userId) return 'you'
    return ctx.members?.find((m) => m.userId === rest)?.name ?? 'A teammate'
  }
  if (kind === 'helper') return ctx.helpers?.find((h) => h.id === rest)?.name ?? 'A helper'
  if (kind === 'suggestion') return `accepted from ${rest}`
  if (kind === 'system') return 'Omilo'
  return by
}

/** True when a doc was written by a person (vs an agent). */
export const byPerson = (d: Pick<DocSummary, 'createdBy'>) => d.createdBy.startsWith('operator:')

/** Label for a doc's area (a channel id or a free label); null → General. */
export function areaLabel(area: string | null | undefined, channels: Channel[] = []): string {
  if (!area) return 'General'
  const ch = channels.find((c) => c.id === area)
  if (ch) return ch.name
  return area.charAt(0).toUpperCase() + area.slice(1)
}

export interface OutlineItem {
  id: string
  text: string
  level: number
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Headings: `# …`/`## …`/`### …` lines, or a whole line in `**bold**`. */
export function headingOf(line: string): { text: string; level: number } | null {
  const md = /^(#{1,3})\s+(.+)$/.exec(line.trim())
  if (md) return { text: md[2].trim(), level: md[1].length }
  const t = line.trim()
  if (t.length > 4 && t.startsWith('**') && t.endsWith('**') && !t.slice(2, -2).includes('**')) return { text: t.slice(2, -2), level: 2 }
  return null
}

export function outlineOf(content: string): OutlineItem[] {
  const out: OutlineItem[] = []
  for (const line of content.split('\n')) {
    const h = headingOf(line)
    if (h) out.push({ id: `h-${slug(h.text)}`, text: h.text, level: h.level })
  }
  return out
}

export const headingId = (text: string) => `h-${slug(text)}`

/** Parse `[[wikilinks]]` (target before any `|alias`). */
export function wikilinks(content: string): string[] {
  return [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim())
}

// ── Notes list rows ─────────────────────────────────────────────────────────

/** The pinned "Company handbook" row in the Notes list (opens the Handbook view). */
export const HANDBOOK_ROW_ID = 'd-handbook'

export interface DocRow {
  id: string
  title: string
  icon: 'doc' | 'folder'
  edited: string
  pinned?: boolean
  byPerson: boolean
  doc?: DocSummary
}

export interface DocGroup {
  id: string
  label: string
  docs: DocRow[]
}

export const docLink = (id: string) => `${location.origin}/docs/${id}`

/** Group company docs by area; pinned first, then most recently edited. */
export function groupDocs(docs: DocSummary[], channels: Channel[], withHandbook: boolean): DocGroup[] {
  const groups = new Map<string, DocGroup>()
  const rows = [...docs].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
  )
  for (const d of rows) {
    const label = areaLabel(d.area, channels)
    const key = label.toLowerCase()
    const g = groups.get(key) ?? { id: key, label, docs: [] }
    g.docs.push({ id: d.id, title: d.title, icon: 'doc', edited: shortAgo(d.updatedAt), pinned: d.pinned, byPerson: byPerson(d), doc: d })
    groups.set(key, g)
  }
  if (withHandbook) {
    const g = groups.get('general') ?? { id: 'general', label: 'General', docs: [] }
    g.docs.unshift({ id: HANDBOOK_ROW_ID, title: 'Company handbook', icon: 'folder', edited: '', pinned: true, byPerson: true })
    groups.set('general', g)
  }
  return [...groups.values()]
}

