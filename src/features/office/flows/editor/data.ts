// Flow editor types + palette — mirrors pen `Office · Flows · Canvas` (ck4Kt), `· Test run result`
// (emtFw), `· Draft from Suggested` (SgKgq) and `· Runs` (GMEPK).

import type { HelperArea } from '../../../../core/domain/types'

export type StepKind = 'trigger' | 'ai' | 'if' | 'approval' | 'connector'

/** A step on the canvas. Coordinates are canvas-space (the canvas area's top-left is 0,0). */
export interface FlowNode {
  id: string
  kind: StepKind
  x: number
  y: number
  /** Upper-case kind label, e.g. "TRIGGER" */
  kindLabel: string
  /** Where it runs, e.g. "GitHub", "Ops" */
  source?: string
  title: string
  desc?: string
  /** Helper that does the step (AI steps) */
  helper?: HelperArea
  /** Connector glyph (connector steps / triggers) */
  app?: 'github' | 'slack' | 'chat' | 'inbox'
  /** Last-run result shown top-right: "12m ago", "8.4s", "waits" */
  last?: string
  /** Per-kind inspector settings (trigger branch, approval wait, connector channel…). */
  config?: Record<string, unknown>
}

export const NODE_W = 260
export const NODE_H = 96
export const IF_W = 220
export const IF_H = 44

/** An orthogonal connector between two nodes. `via` = y of the horizontal segment. */
export interface FlowEdge {
  from: string
  to: string
  via?: number
  /** Show the "+" insert button in the middle of a straight edge */
  plus?: boolean
  branch?: 'yes' | 'no'
}

// ── Palette ───────────────────────────────────────────────────────────────────

export type PaletteTone = 'amber' | 'indigo' | 'neutral'
export interface PaletteItem {
  id: string
  label: string
  icon: string
  tone: PaletteTone
  kind: StepKind
}
export const PALETTE: { group: string; items: PaletteItem[] }[] = [
  {
    group: 'TRIGGERS',
    items: [
      { id: 'schedule', label: 'Schedule', icon: 'clock', tone: 'amber', kind: 'trigger' },
      { id: 'app-event', label: 'App event', icon: 'zap', tone: 'amber', kind: 'trigger' },
      { id: 'webhook', label: 'Webhook', icon: 'webhook', tone: 'amber', kind: 'trigger' },
    ],
  },
  {
    group: 'AI',
    items: [
      { id: 'ask-agent', label: 'Ask an agent', icon: 'sparkles', tone: 'indigo', kind: 'ai' },
      { id: 'classify', label: 'Classify', icon: 'list-tree', tone: 'indigo', kind: 'ai' },
      { id: 'extract', label: 'Extract fields', icon: 'scan-text', tone: 'indigo', kind: 'ai' },
    ],
  },
  {
    group: 'LOGIC & PEOPLE',
    items: [
      { id: 'if', label: 'If / branch', icon: 'git-fork', tone: 'neutral', kind: 'if' },
      { id: 'wait', label: 'Wait', icon: 'timer', tone: 'neutral', kind: 'if' },
      { id: 'approval', label: 'Approval', icon: 'user-check', tone: 'amber', kind: 'approval' },
    ],
  },
  {
    group: 'APPS',
    items: [
      { id: 'github', label: 'GitHub', icon: 'github', tone: 'neutral', kind: 'connector' },
      { id: 'slack', label: 'Slack', icon: 'slack', tone: 'neutral', kind: 'connector' },
      { id: 'gmail', label: 'Gmail', icon: 'mail', tone: 'neutral', kind: 'connector' },
      { id: 'stripe', label: 'Stripe', icon: 'credit-card', tone: 'neutral', kind: 'connector' },
      { id: 'sheets', label: 'Google Sheets', icon: 'sheet', tone: 'neutral', kind: 'connector' },
      { id: 'whatsapp', label: 'WhatsApp', icon: 'message-circle', tone: 'neutral', kind: 'connector' },
    ],
  },
]

// ── Inspector detail for AI steps ─────────────────────────────────────────────

export interface AiStepDetail {
  instructionsLead: string
  input: string
  instructions: string
  returns: string[]
  guardrails: { label: string; on: boolean }[]
  costNote: string
}
// ── Runs (GMEPK) ──────────────────────────────────────────────────────────────

export type RunStatus = 'waiting' | 'succeeded' | 'noop' | 'failed'
export interface FlowRun {
  id: string
  number: number
  status: RunStatus
  when: string
  what: string
  meta: string
  retry?: boolean
}
export type RunStepState = 'done' | 'waiting' | 'queued' | 'failed'
export interface RunStep {
  kind: string
  title: string
  sub?: string
  state: RunStepState
  time: string
  output?: [string, string][]
  approval?: { text: string }
}

// ── Settings ──────────────────────────────────────────────────────────────────

export type OverlapPolicy = 'queue' | 'skip' | 'parallel'
export type TimeoutPolicy = 'skip' | 'cancel' | 'remind'

export interface FlowSettings {
  name: string
  description: string
  areaId: string
  owner: HelperArea
  branches: string
  quietHours: boolean
  quietFrom: string
  quietTo: string
  overlap: OverlapPolicy
  /** @deprecated dollars (1 credit = $0.001); read once and migrated to the Rp fields. */
  costCap?: string
  /** @deprecated dollars; see costCap. */
  monthlyBudget?: string
  /** Max cost per run in Rupiah (enforced by the flow engine, converted to credits). */
  costCapRp: string
  /** Monthly budget in Rupiah (enforced by the flow engine, converted to credits). */
  monthlyBudgetRp: string
  maxSteps: string
  runTimeout: string
  approvers: string[]
  approvalWait: string
  onTimeout: TimeoutPolicy
  autoApproveLow: boolean
  notifyFail: boolean
  notifyWaiting: boolean
  notifyWhatsApp: boolean
  weeklySummary: boolean
}

/** Neutral defaults until the flow's saved settings load (GET /v1/flows/{id}). */
export const DEFAULT_SETTINGS: FlowSettings = {
  name: '',
  description: '',
  areaId: '',
  owner: 'ops',
  branches: 'main',
  quietHours: false,
  quietFrom: '22:00',
  quietTo: '07:00',
  overlap: 'queue',
  costCapRp: '5000',
  monthlyBudgetRp: '1000000',
  maxSteps: '12',
  runTimeout: '10 min',
  approvers: [],
  approvalWait: '1 hour',
  onTimeout: 'remind',
  autoApproveLow: false,
  notifyFail: true,
  notifyWaiting: true,
  notifyWhatsApp: false,
  weeklySummary: true,
}
