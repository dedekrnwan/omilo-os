/**
 * Team view model — turns live Helper / HelperDetail data into the display
 * shapes the roster card and helper page were designed around (pen XaOds,
 * ZOLDU…). No fixture data: every string here is derived from the API.
 */
import { Code, Crown, Handshake, Headset, Megaphone, Receipt, Settings2, UserRound, History } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Helper, HelperDetail, HelperFile, HelperRoutineRow } from '../../core/domain/types'
import { nextRunLabel, tokensLabel } from '../analytics/format'
import type { HelperRecord, HelperStatus, Routine, WorkingFile } from './teamData'

export const MODEL_IDS = ['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5'] as const
export const FALLBACK_MODEL = 'Opus 5.5'

/** Company default model, stored under company settings → aiEngine.defaultModel. */
export function companyDefaultModel(settings: { aiEngine?: Record<string, unknown> } | undefined): string {
  const m = settings?.aiEngine?.defaultModel
  return typeof m === 'string' && m ? m : FALLBACK_MODEL
}

const AREA_ICON: Record<string, LucideIcon> = {
  brand: Crown,
  dev: Code,
  marketing: Megaphone,
  sales: Handshake,
  finance: Receipt,
  support: Headset,
  ops: Settings2,
  retro: History,
}

export function roleIconOf(h: Helper): LucideIcon {
  if (h.isChief) return Crown
  return AREA_ICON[h.area] ?? UserRound
}

/** Status chip for a helper (roster + page). */
export function statusOf(h: Helper): HelperStatus {
  const cur = h.currentJob
  if (cur?.status === 'waiting') return 'Needs you'
  if (cur && (cur.status === 'running' || cur.status === 'queued')) return 'Working'
  if (h.isChief) return 'Always on'
  if ((h.jobsMonth ?? 0) > 0) return 'Caught up'
  return 'Idle'
}

export function isPaused(h: Helper): boolean {
  return h.status === 'paused'
}

/** "Chief of Staff" / "You (<owner>)" / helper name for a reports_to value. */
export function reportsToLabel(
  reportsTo: string | null | undefined,
  helpers: Helper[],
  ownerName: string,
  isChief = false,
): string {
  if (!reportsTo) {
    if (isChief) return `You (${ownerName})`
    const chief = helpers.find((x) => x.isChief)
    return chief ? chief.title || chief.role || chief.name : `You (${ownerName})`
  }
  if (reportsTo === 'owner') return `You (${ownerName})`
  const h = helpers.find((x) => x.id === reportsTo)
  return h ? (h.isChief ? h.title || h.role || h.name : h.name) : `You (${ownerName})`
}

function loopsText(n: number): string {
  return `${n} loop${n === 1 ? '' : 's'}`
}

function nowBox(h: Helper): { nowLabel: 'NOW' | 'NEXT'; now: string } {
  const cur = h.currentJob
  if (cur) return { nowLabel: 'NOW', now: cur.status === 'waiting' ? `Waiting on you: ${cur.brief}` : cur.brief }
  if (h.nextRoutine) {
    return { nowLabel: 'NEXT', now: `Next up: ${h.nextRoutine.name}, ${nextRunLabel(h.nextRoutine.nextAt)}` }
  }
  if (isPaused(h)) return { nowLabel: 'NOW', now: 'Paused' }
  return { nowLabel: 'NOW', now: 'Nothing scheduled' }
}

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function routineSchedule(r: HelperRoutineRow): string {
  switch (r.freq) {
    case 'daily':
      return 'Every day'
    case 'weekdays':
      return 'Weekdays'
    case 'weekly': {
      const days = (r.days ?? []).map((d) => DAY[d]).filter(Boolean)
      return days.length ? days.join(' & ') : 'Weekly'
    }
    case 'monthly':
      return 'Monthly'
    default:
      return r.freq
  }
}

export function toRoutineRow(r: HelperRoutineRow): Routine {
  return {
    id: r.id,
    time: r.at,
    label: r.name,
    schedule: routineSchedule(r),
    nextRun: r.paused || !r.enabled ? null : r.nextAt ? `Next ${nextRunLabel(r.nextAt)}` : 'Scheduled',
    paused: r.paused || !r.enabled,
  }
}

export function toWorkingFiles(files: HelperFile[]): WorkingFile[] {
  return files.map((f) => ({ name: f.name, description: f.description }))
}

export interface RecordContext {
  helpers: Helper[]
  ownerName: string
  defaultModel: string
}

/** Build the display record for a helper page / roster card. */
export function buildHelperRecord(
  h: Helper,
  ctx: RecordContext,
  detail?: HelperDetail | null,
  files: HelperFile[] = [],
): HelperRecord {
  const status = statusOf(h)
  const reports = reportsToLabel(h.reportsTo, ctx.helpers, ctx.ownerName, h.isChief)
  const loops = h.loops ?? detail?.routines.filter((r) => r.enabled).length ?? 0
  const cost = h.tokensMonth ?? 0
  const role = h.title || h.role || h.area
  const nb = nowBox(h)
  const routines = (detail?.routines ?? []).map(toRoutineRow)
  const chiefRoutines = h.isChief ? detail?.routines.filter((r) => r.managedByChief).length ?? 0 : 0
  return {
    id: h.id,
    name: h.name,
    area: h.area,
    roleIcon: roleIconOf(h),
    role: h.role || role,
    roleArea: role,
    status: isPaused(h) ? 'Idle' : status,
    rosterStatus: status,
    model: h.model || ctx.defaultModel,
    statsLine: h.isChief
      ? `Reports to ${reports.startsWith('You') ? 'you' : reports} · routed ${h.jobsMonth ?? 0} jobs this month · ${tokensLabel(cost)}`
      : `Reports to ${reports} · ${loopsText(loops)} · ${tokensLabel(cost)} this month`,
    nowLabel: nb.nowLabel,
    now: nb.now,
    rosterMeta: h.isChief ? `Reports to you · ${loopsText(loops)}` : loopsText(loops),
    cost: `${tokensLabel(cost)} this month`,
    description: h.jobDescription ?? '',
    routinesNote: h.isChief
      ? chiefRoutines
        ? `Chief also manages ${chiefRoutines} routines for the whole team.`
        : 'Recurring work Chief runs for the whole team.'
      : `Recurring work Chief scheduled for ${h.name}.`,
    routines,
    emptyRoutines: `No routines yet. Ask Chief to set one up for ${h.name}.`,
    files: toWorkingFiles(files),
    counts: detail
      ? {
          channels: `${detail.counts.channels}`,
          tools: String(detail.counts.tools),
          skills: String(detail.counts.skills),
        }
      : { channels: '—', tools: '—', skills: '—' },
    helper: h,
    paused: isPaused(h),
  }
}
