// ── Static data for Office Flows feature ─────────────────────────────────────
// All data is local — no queries, no store imports.

import type { HelperArea } from '../../../core/domain/types'

// ── Shared types ──────────────────────────────────────────────────────────────

export type FlowTab = 'Yours' | 'Suggested' | 'Templates' | 'Runs'

export type FlowRunStatus = 'Running' | 'Needs you' | 'Done' | 'Failed'

export type FlowArea = 'Engineering' | 'Marketing' | 'Business' | 'Growth'

export interface FlowCard {
  id: string
  title: string
  status: string
  enabled: boolean
  areas: HelperArea[]
  bars: number[]
}

export interface SuggestedFlow {
  id: string
  title: string
  sub: string
  hint: string
  area: FlowArea
  runsAs: FlowArea
}

export interface TemplateFlow {
  id: string
  title: string
  desc: string
  areas: HelperArea[]
}

export interface FlowRunRow {
  id: string
  flowId: string
  flowTitle: string
  status: FlowRunStatus
  trigger: string
  startedBy: string
  startedAt: string
  duration: string
  cost: string
  waitingFor?: string
}

// ── Flow cards (Yours tab) ────────────────────────────────────────────────────

export const OFFICE_FLOWS: FlowCard[] = [
  {
    id: 'of-deploy-triage',
    title: 'Deploy failure triage',
    status: '12m ago',
    enabled: true,
    areas: ['brand', 'dev', 'ops'],
    bars: [2, 4, 3, 5, 4, 3, 5, 4, 5, 4, 3, 4, 5, 4, 3],
  },
  {
    id: 'of-latency',
    title: 'Weekly latency report',
    status: 'Mon',
    enabled: false,
    areas: ['brand', 'ops'],
    bars: [1, 1, 2, 1, 2, 3, 2, 3, 4, 3, 4, 5, 4, 5, 4],
  },
  {
    id: 'of-freeze',
    title: 'Freeze-window guard',
    status: 'waiting for you',
    enabled: true,
    areas: ['brand', 'dev'],
    bars: [5, 4, 5, 4, 5, 3, 4, 3, 5, 4, 5, 4, 3, 4, 5],
  },
  {
    id: 'of-oncall',
    title: 'On-call digest',
    status: 'today 08:00',
    enabled: true,
    areas: ['brand'],
    bars: [3, 2, 3, 2, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3],
  },
  {
    id: 'of-referral',
    title: 'Referral program monitor',
    status: 'Yesterday',
    enabled: true,
    areas: ['marketing', 'brand'],
    bars: [4, 3, 4, 5, 4, 5, 4, 3, 4, 5, 4, 3, 4, 5, 4],
  },
  {
    id: 'of-sales-digest',
    title: 'Sales pipeline digest',
    status: 'Mon',
    enabled: false,
    areas: ['sales'],
    bars: [2, 3, 2, 3, 2, 3, 4, 3, 4, 3, 4, 5, 4, 5, 4],
  },
]

// ── Suggested flows ───────────────────────────────────────────────────────────

export const SUGGESTED_FLOWS: SuggestedFlow[] = [
  {
    id: 'sf-triage',
    title: 'Triage failed deploys for you?',
    sub: 'Dev saw you do it 4× this week',
    hint: 'Dev · Fri 16:00 · ~$0.02 a run',
    area: 'Engineering',
    runsAs: 'Growth',
  },
  {
    id: 'sf-referral-stripe',
    title: 'Track referral signups from Stripe?',
    sub: 'Growth noticed you match signups manually every week',
    hint: 'Growth · Weekly · ~$0.01 a run',
    area: 'Marketing',
    runsAs: 'Growth',
  },
]

// ── Templates ─────────────────────────────────────────────────────────────────

export const TEMPLATES: TemplateFlow[] = [
  { id: 't1', title: 'Incident → postmortem',     desc: 'Pages on-call, collects the timeline, drafts the postmortem.',          areas: ['brand', 'dev'] },
  { id: 't2', title: 'PR digest to chat',          desc: 'Morning summary of open PRs, reviews needed and blockers.',             areas: ['brand', 'dev', 'ops'] },
  { id: 't3', title: 'Weekly uptime report',        desc: 'Pulls uptime and latency, writes the Friday report.',                  areas: ['brand', 'ops'] },
  { id: 't4', title: 'Deploy failure triage',       desc: 'Reads logs on failed deploys and posts the likely cause.',             areas: ['brand', 'dev'] },
  { id: 't5', title: 'Release notes from merges',   desc: 'Turns merged PRs into readable release notes.',                       areas: ['brand', 'dev', 'ops'] },
  { id: 't6', title: 'Freeze-window guard',          desc: 'Blocks deploys during freeze windows and tells the team.',            areas: ['brand', 'dev'] },
  { id: 't7', title: 'Stale PR nudger',              desc: 'Labels idle PRs and pings the author after 5 days.',                 areas: ['brand', 'dev'] },
  { id: 't8', title: 'On-call handoff',              desc: "Summarises the week's incidents for the next on-call.",              areas: ['brand'] },
  { id: 't9', title: 'Cost spike alert',             desc: 'Watches cloud spend and flags unusual jumps.',                        areas: ['brand', 'ops'] },
  { id: 't10', title: 'Referral signup tracker',    desc: 'Matches Stripe payouts to referral signups weekly.',                  areas: ['marketing', 'brand'] },
  { id: 't11', title: 'Sales pipeline summary',     desc: 'Pulls CRM data and sends a pipeline digest every Monday.',            areas: ['sales'] },
  { id: 't12', title: 'Support ticket triage',      desc: 'Classifies incoming tickets and assigns them to the right helper.',   areas: ['brand', 'support'] },
]

// ── Run rows ──────────────────────────────────────────────────────────────────

export const OFFICE_FLOW_RUNS: FlowRunRow[] = [
  {
    id: 'r214',
    flowId: 'of-deploy-triage',
    flowTitle: 'Deploy failure triage',
    status: 'Needs you',
    trigger: 'GitHub · deploy api@4f2c1',
    startedBy: 'GitHub',
    startedAt: '12m ago',
    duration: '5s',
    cost: '$0.018 so far',
    waitingFor: '3m',
  },
  {
    id: 'r213',
    flowId: 'of-latency',
    flowTitle: 'Weekly latency report',
    status: 'Done',
    trigger: 'Schedule · Fri 16:00',
    startedBy: 'Schedule',
    startedAt: 'Yesterday',
    duration: '38s',
    cost: '$0.014',
  },
  {
    id: 'r212',
    flowId: 'of-oncall',
    flowTitle: 'On-call digest',
    status: 'Running',
    trigger: 'Schedule · daily 08:00',
    startedBy: 'Schedule',
    startedAt: '2m ago',
    duration: '—',
    cost: '$0.020',
  },
  {
    id: 'r211',
    flowId: 'of-deploy-triage',
    flowTitle: 'Deploy failure triage',
    status: 'Failed',
    trigger: 'GitHub · deploy @e03d9',
    startedBy: 'GitHub',
    startedAt: 'Yesterday',
    duration: '1m 12s',
    cost: '$0.011',
  },
  {
    id: 'r210',
    flowId: 'of-referral',
    flowTitle: 'Referral program monitor',
    status: 'Done',
    trigger: 'Schedule · Fri 16:00',
    startedBy: 'Schedule',
    startedAt: 'Mon',
    duration: '44s',
    cost: '$0.016',
  },
  {
    id: 'r209',
    flowId: 'of-latency',
    flowTitle: 'Weekly latency report',
    status: 'Done',
    trigger: 'Schedule · Fri 16:00',
    startedBy: 'Schedule',
    startedAt: 'Sun',
    duration: '44s',
    cost: '$0.016',
  },
]

// ── Canvas: static node/edge data for "Deploy failure triage" ─────────────────

export type NodeKind = 'trigger' | 'ai-step' | 'connector' | 'approval' | 'condition'

export interface CanvasNode {
  id: string
  kind: NodeKind
  label: string
  sublabel: string
  x: number
  y: number
  width: number
  height: number
  /** connector source (id, dot) for edges leaving this node */
  selected?: boolean
}

export const CANVAS_NODES: CanvasNode[] = [
  {
    id: 'n-trigger',
    kind: 'trigger',
    label: 'Deploy fails on main',
    sublabel: 'Deploy job on main ends in failure',
    x: 320,
    y: 20,
    width: 220,
    height: 64,
  },
  {
    id: 'n-read-logs',
    kind: 'ai-step',
    label: 'Read logs, find the cause',
    sublabel: 'Summary, likely cause, severity',
    x: 295,
    y: 136,
    width: 270,
    height: 68,
    selected: true,
  },
  {
    id: 'n-condition',
    kind: 'condition',
    label: 'If severity is P0 or P1',
    sublabel: '',
    x: 325,
    y: 260,
    width: 210,
    height: 40,
  },
  {
    id: 'n-approval',
    kind: 'approval',
    label: 'You approve the fix',
    sublabel: 'Lands in Inbox, wait up to 1h',
    x: 160,
    y: 358,
    width: 200,
    height: 68,
  },
  {
    id: 'n-post-eng',
    kind: 'connector',
    label: 'Post summary to #Engineering',
    sublabel: 'No action needed — FYI only',
    x: 490,
    y: 358,
    width: 210,
    height: 68,
  },
  {
    id: 'n-draft-pr',
    kind: 'ai-step',
    label: 'Draft a fix PR',
    sublabel: 'Opens PR with rollback guard',
    x: 120,
    y: 488,
    width: 180,
    height: 68,
  },
  {
    id: 'n-notify-oncall',
    kind: 'connector',
    label: 'Notify on-call',
    sublabel: 'Message #oncall with cause + PR link',
    x: 390,
    y: 488,
    width: 230,
    height: 68,
  },
]

export interface CanvasEdge {
  id: string
  from: string
  to: string
  label?: string
}

export const CANVAS_EDGES: CanvasEdge[] = [
  { id: 'e1', from: 'n-trigger',   to: 'n-read-logs' },
  { id: 'e2', from: 'n-read-logs', to: 'n-condition' },
  { id: 'e3', from: 'n-condition', to: 'n-approval',  label: 'Yes' },
  { id: 'e4', from: 'n-condition', to: 'n-post-eng',  label: 'No' },
  { id: 'e5', from: 'n-approval',  to: 'n-draft-pr' },
  { id: 'e6', from: 'n-approval',  to: 'n-notify-oncall' },
]

// ── Canvas step palette ───────────────────────────────────────────────────────

export interface StepPaletteGroup {
  label: string
  items: Array<{ label: string; kind: NodeKind }>
}

export const STEP_PALETTE: StepPaletteGroup[] = [
  {
    label: 'TRIGGERS',
    items: [
      { label: 'Schedule',    kind: 'trigger' },
      { label: 'App event',   kind: 'trigger' },
      { label: 'Webhook',     kind: 'trigger' },
    ],
  },
  {
    label: 'AI STEPS',
    items: [
      { label: 'Ask an agent',    kind: 'ai-step' },
      { label: 'Classify',        kind: 'ai-step' },
      { label: 'Extract fields',  kind: 'ai-step' },
    ],
  },
  {
    label: 'LOGIC',
    items: [
      { label: 'If / branch',  kind: 'condition' },
      { label: 'Wait',         kind: 'condition' },
      { label: 'Approval',     kind: 'approval' },
    ],
  },
  {
    label: 'CONNECTORS',
    items: [
      { label: 'GitHub',       kind: 'connector' },
      { label: 'Slack',        kind: 'connector' },
      { label: 'Gmail',        kind: 'connector' },
      { label: 'Stripe',       kind: 'connector' },
      { label: 'Google Sheets', kind: 'connector' },
      { label: 'WhatsApp',     kind: 'connector' },
    ],
  },
]

// ── Test run results (emtFw.png) ──────────────────────────────────────────────

export interface TestRunStep {
  label: string
  outcome: string
  detail: string
  durationMs?: number
  skipped?: boolean
}

export const TEST_RUN_RESULT = {
  status: 'passed' as const,
  dataNote: 'Run with last run\'s data · 14s · nothing was sent',
  steps: [
    { label: 'Trigger · new resident message', outcome: 'ok', detail: '1 message',     durationMs: 200,  skipped: false },
    { label: 'Support drafts a reply',          outcome: 'ok', detail: '143 words',     durationMs: 1100, skipped: false },
    { label: 'Check dues in sahabat-db',        outcome: 'ok', detail: 'Rp 700,000 unpaid', durationMs: 400, skipped: false },
    { label: 'Ask owner before sending payment link', outcome: 'ok', detail: 'Would wait for you', durationMs: 0, skipped: false },
    { label: 'Send on WhatsApp',                outcome: 'skipped', detail: 'Skipped in test', durationMs: 0, skipped: true },
  ] satisfies TestRunStep[],
}

// ── Draft from suggested (SgKgq.png) ─────────────────────────────────────────

export interface DraftAnnotation {
  nodeId: string
  text: string
  kind: 'info' | 'warn' | 'suggestion'
}

export const DRAFT_ANNOTATIONS: DraftAnnotation[] = [
  {
    nodeId: 'n-read-logs',
    text: 'You did this step by hand\n4× — usually in 5–10 min',
    kind: 'info',
  },
  {
    nodeId: 'n-condition',
    text: 'Added because 2 of 4 fixes touched prod',
    kind: 'suggestion',
  },
  {
    nodeId: 'n-notify-oncall',
    text: 'Dev drafted this from 4 triages you did by hand\nCheck each step, run a test on last week\'s failures, then turn it on. Nothing runs until you do.',
    kind: 'suggestion',
  },
]

// ── Runs history detail (GMEPK.png) ──────────────────────────────────────────

export type RunDetailStepStatus = 'done' | 'running' | 'waiting' | 'queued' | 'skipped'

export interface RunDetailStep {
  id: string
  kind: 'trigger' | 'ai' | 'condition' | 'approval' | 'connector'
  label: string
  status: RunDetailStepStatus
  meta?: string
  duration?: string
  fields?: Array<{ key: string; value: string }>
  approveLabel?: string
  approveDetail?: string
}

export const RUN_DETAIL_214: RunDetailStep[] = [
  {
    id: 'rs-trigger',
    kind: 'trigger',
    label: 'Deploy fails on main',
    status: 'done',
    meta: 'api@4f2c1 · job #8812 · 312 lines of logs',
    duration: '0.1s',
  },
  {
    id: 'rs-read-logs',
    kind: 'ai',
    label: 'Read logs, find the cause',
    status: 'done',
    meta: 'AI  OPS',
    duration: '8.4s · $0.015',
    fields: [
      { key: 'summary',  value: 'Migration 0142 failed: column referral_code already exists' },
      { key: 'cause',    value: 'Migration ran twice after a retried deploy' },
      { key: 'severity', value: 'P1 — checkout signups failing since 10-31' },
    ],
  },
  {
    id: 'rs-condition',
    kind: 'condition',
    label: 'Severity is P0 or P1',
    status: 'done',
    meta: 'Yes',
    duration: '0s',
  },
  {
    id: 'rs-approval',
    kind: 'approval',
    label: 'You approve the fix',
    status: 'waiting',
    meta: 'waiting 3m',
    approveLabel: 'Ops suggests: mark migration 0142 as applied, then redeploy. Dev will open the PR and the rollback guard stays on.',
    approveDetail: 'Also in your Inbox',
  },
  {
    id: 'rs-draft-pr',
    kind: 'ai',
    label: 'Draft a fix PR',
    status: 'queued',
  },
  {
    id: 'rs-notify',
    kind: 'connector',
    label: 'Notify on-call',
    status: 'queued',
  },
]
