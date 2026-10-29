/**
 * Deterministic "Chief suggests" helpers for the New routine drawer: read a
 * cadence and a helper out of the plain-language description (no LLM).
 */
import type { Helper } from '../../core/domain/types'
import type { Frequency } from './data'

const DAY_WORDS: Array<[RegExp, number]> = [
  [/\bmon(day)?s?\b/i, 0],
  [/\btue(s|sday)?s?\b/i, 1],
  [/\bwed(nesday)?s?\b/i, 2],
  [/\bthu(rs|rsday)?s?\b/i, 3],
  [/\bfri(day)?s?\b/i, 4],
  [/\bsat(urday)?s?\b/i, 5],
  [/\bsun(day)?s?\b/i, 6],
]

/** Deterministic read of "every Friday afternoon…" → cadence (no LLM). */
export function guessCadence(prompt: string): { freq: Frequency; at: string; days: number[]; monthly: 'date' | 'last-working-day' } {
  const p = prompt.toLowerCase()
  let at = '09:00'
  const hm = p.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?/)
  const ampm = p.match(/\b(\d{1,2})\s*(am|pm)\b/)
  if (hm) {
    const h = Number(hm[1]) % (hm[3] ? 12 : 24) + (hm[3] === 'pm' ? 12 : 0)
    at = `${String(h).padStart(2, '0')}:${hm[2]}`
  } else if (ampm) {
    const h = (Number(ampm[1]) % 12) + (ampm[2] === 'pm' ? 12 : 0)
    at = `${String(h).padStart(2, '0')}:00`
  } else if (/afternoon/.test(p)) at = '15:00'
  else if (/evening/.test(p)) at = '18:00'
  else if (/morning/.test(p)) at = '08:00'
  const days = DAY_WORDS.filter(([re]) => re.test(p)).map(([, d]) => d)
  if (/last working day/.test(p)) return { freq: 'Monthly', at, days: [], monthly: 'last-working-day' }
  if (/month/.test(p)) return { freq: 'Monthly', at, days: [], monthly: 'date' }
  if (/weekday|work ?day/.test(p)) return { freq: 'Weekdays', at, days: [], monthly: 'date' }
  if (days.length) return { freq: 'Weekly', at, days, monthly: 'date' }
  if (/week/.test(p)) return { freq: 'Weekly', at, days: [0], monthly: 'date' }
  return { freq: 'Daily', at, days: [], monthly: 'date' }
}

const AREA_WORDS: Array<[RegExp, string]> = [
  [/invoice|payout|reconcil|xero|budget|finance|expense/i, 'finance'],
  [/deploy|build|ci\b|pr\b|pull request|depend|bug|code/i, 'dev'],
  [/social|instagram|post|campaign|ads?\b|content|seo/i, 'marketing'],
  [/ticket|support|customer|complain/i, 'support'],
  [/lead|deal|pipeline|crm|sales/i, 'sales'],
  [/incident|backup|uptime|on-call|server|ops\b/i, 'ops'],
]

/** Picks a helper by name mention, then topic → area, then Chief. */
export function guessHelper(prompt: string, helpers: Helper[]): Helper | undefined {
  const byName = helpers.find((h) => new RegExp(`\\b${h.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(prompt))
  if (byName) return byName
  const area = AREA_WORDS.find(([re]) => re.test(prompt))?.[1]
  const byArea = area ? helpers.find((h) => !h.isChief && h.area === area) : undefined
  return byArea ?? helpers.find((h) => h.isChief) ?? helpers[0]
}

/** Short routine name from the prompt's first clause. */
export function nameFromPrompt(prompt: string): string {
  const first = prompt.split(/[.\n]/)[0].replace(/^(every|each)\s+\w+(\s+(morning|afternoon|evening))?,?\s*/i, '').trim()
  const s = first.charAt(0).toUpperCase() + first.slice(1)
  return s.length > 60 ? `${s.slice(0, 57)}…` : s || 'New routine'
}

