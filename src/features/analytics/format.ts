/**
 * Shared number / money / time formatting for Analytics and Team.
 *
 * Money: spend is reported in credits; the Rupiah equivalent uses the single
 * app-wide rate in src/app/money.ts.
 */
export { IDR_PER_CREDIT, formatCredits, formatRp, creditsInRp } from '../../app/money'

/** 1240000 → "1.2M", 41200 → "41k", 950 → "950". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(Math.round(n))
}

/** "now" · "12m ago" · "2h ago" · "3d ago" · "—" */
export function relativeTime(isoStr: string | null | undefined, now: Date = new Date()): string {
  if (!isoStr) return '—'
  const t = new Date(isoStr).getTime()
  if (Number.isNaN(t)) return '—'
  const mins = Math.round((now.getTime() - t) / 60_000)
  if (mins < 2) return 'now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short' })
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

/** "Today 09:00" · "Tomorrow 07:30" · "Fri 16:00" · "in 12 min" */
export function nextRunLabel(isoStr: string | null | undefined, now: Date = new Date()): string {
  if (!isoStr) return '—'
  const d = new Date(isoStr)
  if (Number.isNaN(d.getTime())) return '—'
  const mins = Math.round((d.getTime() - now.getTime()) / 60_000)
  if (mins >= 0 && mins < 60) return `in ${mins} min`
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dayN = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((dayN - day0) / 86_400_000)
  const time = TIME.format(d)
  if (diff === 0) return `Today ${time}`
  if (diff === 1) return `Tomorrow ${time}`
  return `${WEEKDAY.format(d)} ${time}`
}

/** Percent change with sign: (+12%, up) — or null when there's no base to compare. */
export function pctChange(value: number, prev: number | undefined): number | null {
  if (prev === undefined || prev === null) return null
  if (prev === 0) return value === 0 ? 0 : null
  return Math.round(((value - prev) / prev) * 100)
}

/** "+12%" / "−3%" / "0%" */
export function signedPct(p: number): string {
  if (p > 0) return `+${p}%`
  if (p < 0) return `−${Math.abs(p)}%`
  return '0%'
}

/** "+2" / "−3" / "0" with an optional unit suffix. */
export function signedNum(n: number, unit = ''): string {
  if (n > 0) return `+${n}${unit}`
  if (n < 0) return `−${Math.abs(n)}${unit}`
  return `0${unit}`
}

/** "48s" · "3m 10s" */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r ? `${m}m ${r}s` : `${m}m`
}
