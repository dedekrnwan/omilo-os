/**
 * Team feature types + the hire catalog (omilo-v2.pen Team XaOds, helper pages
 * ZOLDU…, hire jEooC). Helper data itself comes from the API — see model.ts.
 */
import { BookOpen, Brain, Type, UserRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Helper, HelperArea } from '../../core/domain/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export type HelperStatus = 'Working' | 'Needs you' | 'Caught up' | 'Idle' | 'Always on' | 'Planning next week'

export interface Routine {
  id: string
  time: string
  label: string
  schedule: string
  /** "Next Mon 07:30" — or null when paused (shows "Paused" in warn). */
  nextRun: string | null
  paused: boolean
}

export interface WorkingFile {
  name: 'PERSONA.md' | 'STYLE.md' | 'PLAYBOOK.md' | 'MEMORY.md'
  description: string
}

export const FILE_ICON: Record<WorkingFile['name'], LucideIcon> = {
  'PERSONA.md': UserRound,
  'STYLE.md': Type,
  'PLAYBOOK.md': BookOpen,
  'MEMORY.md': Brain,
}


export type HelperTab = 'job' | 'channels' | 'behavior' | 'tools' | 'skills' | 'profile'

export interface HelperRecord {
  id: string
  name: string
  /** Colour + look of the helper (pen `Helper/*`). */
  area: HelperArea
  /** Look used on the roster card / minis when pen draws it differently. */
  rosterArea?: HelperArea
  roleIcon: LucideIcon
  role: string
  /** Roster card second line, e.g. "Dev · Engineering". */
  roleArea: string
  /** Status on the helper's own page. */
  status: HelperStatus
  /** Status on the roster card. */
  rosterStatus: HelperStatus
  model: string
  statsLine: string
  /** Roster "NOW"/"NEXT" box. */
  nowLabel: 'NOW' | 'NEXT'
  now: string
  rosterMeta: string
  cost: string
  description: string
  routinesNote: string
  routines: Routine[]
  emptyRoutines?: string
  files: WorkingFile[]
  counts: { channels: string; tools: string; skills: string }
  /** The live helper this record was built from (for edits). */
  helper: Helper
  paused: boolean
}

// ── Hire helpers catalog (pen jEooC) ───────────────────────────────────────────

export interface HireOption {
  id: string
  name: string
  tagline: string
  area: HelperArea
  category: 'Operations' | 'Growth' | 'Money' | 'Tech'
}

export const HIRE_OPTIONS: HireOption[] = [
  { id: 'ops', name: 'Ops', tagline: 'Keeps schedules, stock and vendors on track', area: 'ops', category: 'Operations' },
  { id: 'retro', name: 'Retro', tagline: 'Runs weekly retros and spots patterns', area: 'retro', category: 'Operations' },
  { id: 'marketing', name: 'Marketing', tagline: 'Writes posts and broadcasts for customers', area: 'marketing', category: 'Growth' },
  { id: 'sales', name: 'Sales', tagline: 'Follows up leads from WhatsApp and forms', area: 'sales', category: 'Growth' },
  { id: 'finance', name: 'Finance', tagline: 'Keeps the books and chases unpaid invoices', area: 'finance', category: 'Money' },
  { id: 'dev', name: 'Dev', tagline: 'Ships small, reviewed code changes', area: 'dev', category: 'Tech' },
  { id: 'support', name: 'Support', tagline: 'Answers customer questions on chat and email', area: 'support', category: 'Operations' },
]

export const HIRE_CATEGORIES = ['All', 'Operations', 'Growth', 'Money', 'Tech'] as const
export type HireCategory = (typeof HIRE_CATEGORIES)[number]
