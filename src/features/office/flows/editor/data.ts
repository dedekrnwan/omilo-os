// Flow editor mock data — mirrors pen `Office · Flows · Canvas` (ck4Kt), `· Test run result`
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

export const TRIAGE_NODES: FlowNode[] = [
  { id: 'trigger', kind: 'trigger', x: 277, y: 36, kindLabel: 'TRIGGER', source: 'GitHub', title: 'Deploy fails on main', desc: 'Deploy job on main ends in failure', app: 'github', last: '12m ago' },
  { id: 'read-logs', kind: 'ai', x: 277, y: 176, kindLabel: 'AI STEP', source: 'Ops', title: 'Read logs, find the cause', desc: 'Summary, likely cause, severity', helper: 'ops', last: '8.4s' },
  { id: 'if-sev', kind: 'if', x: 297, y: 318, kindLabel: 'IF', title: 'If severity is P0 or P1' },
  { id: 'approve', kind: 'approval', x: 77, y: 420, kindLabel: 'APPROVAL', source: 'Inbox', title: 'You approve the fix', desc: 'Lands in Inbox, waits up to 1h', app: 'inbox', last: 'waits' },
  { id: 'post-summary', kind: 'connector', x: 477, y: 420, kindLabel: 'CONNECTOR', source: 'Chat', title: 'Post summary to #Engineering', desc: 'No action needed — FYI only', app: 'chat', last: '0.2s' },
  { id: 'draft-pr', kind: 'ai', x: 77, y: 560, kindLabel: 'AI STEP', source: 'Dev', title: 'Draft a fix PR', desc: 'Opens PR with rollback guard', helper: 'dev', last: '41s' },
  { id: 'notify', kind: 'connector', x: 277, y: 712, kindLabel: 'CONNECTOR', source: 'Slack', title: 'Notify on-call', desc: 'Message #oncall with cause + PR link', app: 'slack', last: '0.3s' },
]

export const TRIAGE_EDGES: FlowEdge[] = [
  { from: 'trigger', to: 'read-logs', plus: true },
  { from: 'read-logs', to: 'if-sev' },
  { from: 'if-sev', to: 'approve', via: 391, branch: 'yes' },
  { from: 'if-sev', to: 'post-summary', via: 391, branch: 'no' },
  { from: 'approve', to: 'draft-pr', plus: true },
  { from: 'draft-pr', to: 'notify', via: 684 },
  { from: 'post-summary', to: 'notify', via: 614 },
]

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
export const AI_DETAIL: Record<string, AiStepDetail> = {
  'read-logs': {
    instructionsLead: 'Read the logs from',
    input: 'Trigger.logs',
    instructions: 'Say what broke in one sentence, the most likely cause, and rate severity P0–P3. Never re-run the deploy.',
    returns: ['summary', 'cause', 'severity'],
    guardrails: [
      { label: 'Read-only — can’t change code or infra', on: true },
      { label: 'Stop after 3 tool calls', on: true },
      { label: 'Ask in Inbox if unsure', on: false },
    ],
    costNote: 'Only AI step in this flow · ~$0.015 a run',
  },
  'draft-pr': {
    instructionsLead: 'Using',
    input: 'ReadLogs.cause',
    instructions: 'Write the smallest fix that makes the deploy pass. Open a PR with a rollback guard; never merge it yourself.',
    returns: ['pr_url', 'diff_summary'],
    guardrails: [
      { label: 'Read-only on main — PRs only', on: true },
      { label: 'Stop after 8 tool calls', on: true },
      { label: 'Ask in Inbox if unsure', on: true },
    ],
    costNote: 'Runs after your approval · ~$0.004 a run',
  },
}

// ── Test run (emtFw) ──────────────────────────────────────────────────────────

export interface TestStep {
  label: string
  result: string
  time: string
  tone: 'ok' | 'wait'
}
export const TEST_RUN = {
  summary: 'Ran with last run’s data · 14s · nothing was sent',
  steps: [
    { label: 'Trigger · new resident message', result: '1 message', time: '0.2s', tone: 'ok' },
    { label: 'Support drafts a reply', result: '142 words', time: '6.1s', tone: 'ok' },
    { label: 'Check dues in sahabat-db', result: 'Rp 150.000 unpaid', time: '1.4s', tone: 'ok' },
    { label: 'Ask owner before sending payment link', result: 'Would wait for you', time: '—', tone: 'wait' },
    { label: 'Send on WhatsApp', result: 'Skipped in test', time: 'dry run', tone: 'ok' },
  ] as TestStep[],
}

// ── Draft annotations (SgKgq) ─────────────────────────────────────────────────

export const DRAFT_NOTES = [
  { id: 'by-hand', x: 547, y: 186, w: 180, text: 'You did this step by hand 4× — usually in 6–10 min' },
]

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
export const RUNS: FlowRun[] = [
  { id: 'r214', number: 214, status: 'waiting', when: '12m ago', what: 'api@4f2c1 · migration step failed', meta: '51s · $0.018' },
  { id: 'r213', number: 213, status: 'succeeded', when: 'Yesterday', what: 'web@91aa0 · flaky test, re-run passed', meta: '38s · $0.014' },
  { id: 'r212', number: 212, status: 'noop', when: 'Yesterday', what: 'docs@77b1e · P3, posted FYI', meta: '9s · $0.011' },
  { id: 'r211', number: 211, status: 'failed', when: 'Mon', what: 'api@e03d9 · Ops step timed out', meta: '2m 0s · $0.020', retry: true },
  { id: 'r210', number: 210, status: 'succeeded', when: 'Mon', what: 'api@a1c44 · rollback guard PR merged', meta: '4m 12s · $0.019' },
  { id: 'r209', number: 209, status: 'succeeded', when: 'Sun', what: 'worker@5d2e1 · env var missing', meta: '44s · $0.016' },
]

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

export const RUN_DETAIL: Record<string, { title: string; chip: string; sub: string; steps: RunStep[] }> = {
  r214: {
    title: 'Run #214',
    chip: 'Waiting for you · 3m',
    sub: 'Started 12m ago by GitHub · deploy api@4f2c1 failed on main · $0.018 so far',
    steps: [
      { kind: 'TRIGGER', title: 'Deploy fails on main', sub: 'api@4f2c1 · job #8812 · 312 lines of logs', state: 'done', time: '0.1s' },
      {
        kind: 'AI · OPS', title: 'Read logs, find the cause', state: 'done', time: '8.4s · $0.015',
        output: [
          ['summary', 'Migration 0142 failed: column referral_code already exists'],
          ['cause', 'Migration ran twice after a retried deploy'],
          ['severity', 'P1 — checkout signups failing since 10:31'],
        ],
      },
      { kind: 'IF', title: 'Severity is P0 or P1 → Yes', state: 'done', time: '0s' },
      {
        kind: 'APPROVAL', title: 'You approve the fix', state: 'waiting', time: 'waiting 3m',
        approval: { text: 'Ops suggests: mark migration 0142 as applied, then redeploy. Dev will open the PR and the rollback guard stays on.' },
      },
      { kind: 'AI · DEV', title: 'Draft a fix PR', state: 'queued', time: 'queued' },
      { kind: 'SLACK', title: 'Notify on-call', state: 'queued', time: 'queued' },
    ],
  },
}

/** Fallback run detail for runs without a hand-written one. */
export function runDetail(run: FlowRun) {
  const known = RUN_DETAIL[run.id]
  if (known) return known
  const failed = run.status === 'failed'
  const noop = run.status === 'noop'
  const [commit] = run.what.split(' · ')
  const steps: RunStep[] = [
    { kind: 'TRIGGER', title: 'Deploy fails on main', sub: `${commit} · deploy job failed`, state: 'done', time: '0.1s' },
    { kind: 'AI · OPS', title: 'Read logs, find the cause', sub: run.what.split(' · ')[1], state: failed ? 'failed' : 'done', time: failed ? 'timed out' : '7.9s' },
    ...(failed
      ? []
      : noop
        ? [
            { kind: 'IF', title: 'Severity is P0 or P1 → No', state: 'done' as const, time: '0s' },
            { kind: 'CHAT', title: 'Post summary to #Engineering', state: 'done' as const, time: '0.2s' },
          ]
        : [
            { kind: 'IF', title: 'Severity is P0 or P1 → Yes', state: 'done' as const, time: '0s' },
            { kind: 'APPROVAL', title: 'You approved the fix', state: 'done' as const, time: '4m' },
            { kind: 'AI · DEV', title: 'Draft a fix PR', state: 'done' as const, time: '38s' },
            { kind: 'SLACK', title: 'Notify on-call', state: 'done' as const, time: '0.3s' },
          ]),
  ]
  const chip = failed ? 'Failed' : noop ? 'No action needed' : 'Succeeded'
  return { title: `Run #${run.number}`, chip, sub: `${run.when} · ${run.what} · ${run.meta}`, steps }
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
  costCap: string
  monthlyBudget: string
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

export const DEFAULT_SETTINGS: FlowSettings = {
  name: 'Deploy failure triage',
  description: 'When a deploy on main fails, Ops reads the logs and rates severity. P0–P1 come to you for a fix; the rest is posted to #Engineering.',
  areaId: 'ch-engineering',
  owner: 'ops',
  branches: 'main',
  quietHours: false,
  quietFrom: '22:00',
  quietTo: '07:00',
  overlap: 'queue',
  costCap: '0.10',
  monthlyBudget: '20',
  maxSteps: '12',
  runTimeout: '10 min',
  approvers: ['Dede Kurniawan'],
  approvalWait: '1 hour',
  onTimeout: 'remind',
  autoApproveLow: false,
  notifyFail: true,
  notifyWaiting: true,
  notifyWhatsApp: false,
  weeklySummary: true,
}

export const SPENT_THIS_MONTH = 3.12

export interface FlowVersion {
  id: string
  label: string
  note: string
  when: string
  by: string
}
export const VERSIONS: FlowVersion[] = [
  { id: 'v7', label: 'v7', note: 'Added “Notify on-call” after the fix PR', when: '2 days ago', by: 'You' },
  { id: 'v6', label: 'v6', note: 'Approval waits up to 1h instead of 30m', when: 'Oct 14', by: 'You' },
  { id: 'v5', label: 'v5', note: 'Ops step is read-only', when: 'Oct 9', by: 'Ops (suggested)' },
  { id: 'v4', label: 'v4', note: 'First version — drafted by Dev', when: 'Oct 2', by: 'Dev' },
]
