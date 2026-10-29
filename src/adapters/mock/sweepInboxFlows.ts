// ── sweep/inbox-flows ──
// Mock-mode state for inbox decisions (proposal links, read state, undo) and
// flows (run step logs, versions, suggestions). Imported by mockRepos and
// mockCommands; it decorates the shared fixture arrays once at module load so
// the demo keeps working offline with the same shapes the HTTP API returns.

import type {
  Flow,
  FlowRun,
  FlowRunStep,
  FlowSuggestion,
  FlowVersionInfo,
  InboxItem,
  ProposalDetail,
} from '../../core/domain/types'
import { flowRuns, flows, inboxItems } from './fixtures'

const nowIso = () => new Date().toISOString()
const agoIso = (ms: number) => new Date(Date.now() - ms).toISOString()

// ── Inbox: link decisions to proposals ──────────────────────────────────────

const PROPOSAL_LINKS: Record<string, string[]> = {
  'inbox-passkey-tasks': ['prp-passkey-web', 'prp-passkey-android', 'prp-passkey-comms'],
  'inbox-ad-budget': ['prp-ad-budget'],
  'inbox-arunika': ['prp-arunika'],
  'inbox-venue': ['prp-venue'],
}

export const mockProposals: Record<string, ProposalDetail> = {}

function proposal(id: string, title: string, bodyMd: string, extra: Partial<ProposalDetail> = {}): ProposalDetail {
  return {
    id, type: 'task', risk: 'low', title, bodyMd, status: 'pending', helperId: 'h-chief',
    assignee: null, due: null, params: null, createdAt: agoIso(3_600_000), revisions: [], ...extra,
  }
}

Object.assign(mockProposals, {
  'prp-passkey-web': proposal('prp-passkey-web', 'Ship passkeys on web + iOS',
    'Add passkey sign-in on web and iOS behind a 10% flag. Password login stays as a fallback until the rollout reaches 100%.',
    { params: { branch: 'web/passkeys', estimate: '~4 days of Dev time' } }),
  'prp-passkey-android': proposal('prp-passkey-android', 'Android password fallback flow',
    'Keep password + OTP for Android < 9 (6% of users). Show a one-time banner explaining why, and log who stays on passwords so we can nudge them later.',
    { params: { branch: 'android/password-fallback', estimate: '~2 days of Dev time' } }),
  'prp-passkey-comms': proposal('prp-passkey-comms', 'Launch comms to all users',
    'Email, in-app banner and a short help article announcing passkeys once web + iOS are at 100%.',
    { params: { estimate: '~1 day of Growth time' } }),
  'prp-ad-budget': proposal('prp-ad-budget', 'Approve $4,800 ad budget for the referral launch',
    '14-day spend cap across Meta and TikTok.',
    { type: 'spend', risk: 'medium', params: { amount: 4800, run_for: '14 days' } }),
  'prp-arunika': proposal('prp-arunika', 'Pilot contract redlines from Arunika', 'Two redlines on the pilot contract need a yes or no.'),
  'prp-venue': proposal('prp-venue', 'Pick an offsite venue — 3 options', 'Three venues within budget for the Q1 offsite.'),
})

/** Last approval per proposal (for undo). */
const approvedAt: Record<string, number> = {}

for (const item of inboxItems) {
  const ids = PROPOSAL_LINKS[item.id]
  if (ids) {
    if (item.proposals?.length) {
      item.proposals = item.proposals.map((p, i) => ({ ...p, proposalId: ids[i] }))
    } else {
      item.proposals = ids.map((pid) => ({
        who: item.asker, area: item.askerArea, text: item.title, due: '', proposalId: pid,
      }))
    }
  }
  // Done items finished today in the demo; decisions are unread.
  if (item.status === 'done') {
    item.updatedAt = nowIso()
    item.readAt = item.readAt ?? nowIso()
  }
}

/** Decision items in mock mode are ordered newest first like the API. */
inboxItems.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

function itemsFor(proposalId: string): InboxItem[] {
  return inboxItems.filter((i) => i.proposals?.some((p) => p.proposalId === proposalId))
}

function syncItem(item: InboxItem) {
  const linked = (item.proposals ?? []).filter((p) => p.proposalId)
  if (!linked.length) return
  const open = linked.some((p) => (mockProposals[p.proposalId!]?.status ?? 'pending') === 'pending')
  item.status = open ? 'pending' : 'done'
  if (!open) item.updatedAt = nowIso()
  item.proposals = item.proposals!.map((p) =>
    p.proposalId ? { ...p, status: mockProposals[p.proposalId]?.status } : p,
  )
}

export function mockDecide(proposalId: string, status: 'done' | 'rejected' | 'changes_requested', params?: Record<string, unknown>) {
  const p = mockProposals[proposalId]
  if (p) {
    p.status = status
    if (params) p.params = { ...(p.params ?? {}), ...params }
    if (status === 'done') approvedAt[proposalId] = Date.now()
  }
  itemsFor(proposalId).forEach(syncItem)
}

export function mockUndo(proposalId: string) {
  const p = mockProposals[proposalId]
  const at = approvedAt[proposalId]
  if (!p || p.status !== 'done' || !at || Date.now() - at > 5 * 60_000) {
    return Promise.reject(new Error('Nothing to undo'))
  }
  p.status = 'pending'
  delete approvedAt[proposalId]
  itemsFor(proposalId).forEach(syncItem)
  return Promise.resolve()
}

export function mockUpdateProposal(proposalId: string, input: { assignee?: string | null; due?: string | null }) {
  const p = mockProposals[proposalId]
  if (!p) return
  if (input.assignee !== undefined) p.assignee = input.assignee
  if (input.due !== undefined) p.due = input.due
  for (const item of itemsFor(proposalId)) {
    item.proposals = item.proposals!.map((e) =>
      e.proposalId === proposalId
        ? { ...e, who: p.assignee ?? e.who, due: p.due ?? e.due }
        : e,
    )
  }
}

export function mockMarkRead(id: string) {
  const item = inboxItems.find((i) => i.id === id)
  if (item && !item.readAt) item.readAt = nowIso()
}

export function mockMarkAllRead(before?: string) {
  let n = 0
  for (const item of inboxItems) {
    if (item.readAt) continue
    if (before && item.createdAt > before) continue
    item.readAt = nowIso()
    n += 1
  }
  return n
}

// ── Flows ────────────────────────────────────────────────────────────────────

/** The demo "Deploy failure triage" flow, in the API's node/edge shape. */
const TRIAGE_FLOW: Flow = {
  id: 'flw-deploy-triage',
  title: 'Deploy failure triage',
  status: 'published',
  enabled: true,
  count: 7,
  areas: ['ch-engineering'],
  createdAt: '2026-10-02T09:00:00Z',
  version: 7,
  createdBy: 'operator',
  trigger: { kind: 'connector_poll', spec: { event: 'deploy_failed' } },
  nodes: [
    { id: 'trigger', kind: 'trigger', label: 'Deploy fails on main', sublabel: 'Deploy job on main ends in failure', x: 277, y: 36, config: { ui: { kindLabel: 'TRIGGER', source: 'GitHub', app: 'github' } } },
    { id: 'read-logs', kind: 'ai_step', label: 'Read logs, find the cause', sublabel: 'Summary, likely cause, severity', x: 277, y: 176, config: { ui: { kindLabel: 'AI STEP', source: 'Ops', helper: 'ops' }, brief: 'Read logs, find the cause' } },
    { id: 'if-sev', kind: 'condition', label: 'If severity is P0 or P1', sublabel: '', x: 297, y: 318, config: { ui: { kindLabel: 'IF' }, keyword: 'P1' } },
    { id: 'approve', kind: 'approval', label: 'You approve the fix', sublabel: 'Lands in Inbox, waits up to 1h', x: 77, y: 420, config: { ui: { kindLabel: 'APPROVAL', source: 'Inbox', app: 'inbox' } } },
    { id: 'post-summary', kind: 'connector', label: 'Post summary to #Engineering', sublabel: 'No action needed — FYI only', x: 477, y: 420, config: { ui: { kindLabel: 'CONNECTOR', source: 'Chat', app: 'chat' } } },
    { id: 'draft-pr', kind: 'ai_step', label: 'Draft a fix PR', sublabel: 'Opens PR with rollback guard', x: 77, y: 560, config: { ui: { kindLabel: 'AI STEP', source: 'Dev', helper: 'dev' }, brief: 'Draft a fix PR' } },
    { id: 'notify', kind: 'connector', label: 'Notify on-call', sublabel: 'Message #oncall with cause + PR link', x: 277, y: 712, config: { ui: { kindLabel: 'CONNECTOR', source: 'Slack', app: 'slack' } } },
  ],
  edges: [
    { id: 'e1', from: 'trigger', to: 'read-logs', plus: true },
    { id: 'e2', from: 'read-logs', to: 'if-sev' },
    { id: 'e3', from: 'if-sev', to: 'approve', via: 391, label: 'Yes' },
    { id: 'e4', from: 'if-sev', to: 'post-summary', via: 391, label: 'No' },
    { id: 'e5', from: 'approve', to: 'draft-pr', plus: true },
    { id: 'e6', from: 'draft-pr', to: 'notify', via: 684 },
    { id: 'e7', from: 'post-summary', to: 'notify', via: 614 },
  ],
  settings: {},
}

if (!flows.some((f) => f.id === TRIAGE_FLOW.id)) flows.unshift(TRIAGE_FLOW)

function steps(kind: 'done' | 'waiting' | 'failed'): FlowRunStep[] {
  const base: FlowRunStep[] = [
    { nodeId: 'trigger', kind: 'trigger', label: 'Deploy fails on main', status: 'done', durationMs: 100 },
    {
      nodeId: 'read-logs', kind: 'ai_step', label: 'Read logs, find the cause', status: kind === 'failed' ? 'failed' : 'done', durationMs: 8400,
      ...(kind === 'failed'
        ? { note: 'Ops step timed out' }
        : { output: { summary: 'Migration 0142 failed: column referral_code already exists', cause: 'Migration ran twice after a retried deploy', severity: 'P1' } }),
    },
  ]
  if (kind === 'failed') return base
  return [
    ...base,
    { nodeId: 'if-sev', kind: 'condition', label: 'If severity is P0 or P1', status: 'done', durationMs: 0, note: 'Yes' },
    kind === 'waiting'
      ? { nodeId: 'approve', kind: 'approval', label: 'You approve the fix', status: 'waiting', durationMs: 0, note: 'Ops suggests: mark migration 0142 as applied, then redeploy.' }
      : { nodeId: 'approve', kind: 'approval', label: 'You approve the fix', status: 'done', durationMs: 0, note: 'You approved' },
    ...(kind === 'done'
      ? [
          { nodeId: 'draft-pr', kind: 'ai_step', label: 'Draft a fix PR', status: 'done', durationMs: 38_000, output: { pr_url: 'PR #482' } },
          { nodeId: 'notify', kind: 'connector', label: 'Notify on-call', status: 'done', durationMs: 300 },
        ] satisfies FlowRunStep[]
      : []),
  ]
}

function triageRun(id: string, status: string, agoMs: number, st: FlowRunStep[], cost: number, duration: number | null): FlowRun {
  return {
    id, flowId: TRIAGE_FLOW.id, status, triggerSummary: 'GitHub · deploy failed on main', startedBy: 'GitHub',
    costCredits: cost, duration, waitingFor: status === 'needs_you' ? 'approve' : null, jobIds: [],
    startedAt: agoIso(agoMs), endedAt: status === 'needs_you' ? null : agoIso(agoMs - (duration ?? 0) * 1000), steps: st,
  }
}

if (!flowRuns.some((r) => r.flowId === TRIAGE_FLOW.id)) {
  flowRuns.unshift(
    triageRun('frn-triage-3', 'needs_you', 12 * 60_000, steps('waiting'), 18, null),
    triageRun('frn-triage-2', 'done', 26 * 3_600_000, steps('done'), 14, 38),
    triageRun('frn-triage-1', 'failed', 3 * 86_400_000, steps('failed'), 20, 120),
  )
}

export function runsForFlow(flowId: string): FlowRun[] {
  return flowRuns.filter((r) => r.flowId === flowId)
}

/** Decorate a flow with the card/detail extras the API computes. */
export function withFlowExtras(f: Flow): Flow {
  const runs = runsForFlow(f.id)
  const days = [0, 0, 0, 0, 0, 0, 0]
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (const r of runs) {
    if (!r.startedAt) continue
    const d = new Date(r.startedAt)
    d.setHours(0, 0, 0, 0)
    const idx = 6 - Math.round((today.getTime() - d.getTime()) / 86_400_000)
    if (idx >= 0 && idx < 7) days[idx] += 1
  }
  const nodes = (Array.isArray(f.nodes) ? f.nodes : []) as { kind?: string; config?: { ui?: { app?: string; source?: string } } }[]
  const apps = nodes
    .filter((n) => n.kind === 'trigger' || n.kind === 'connector' || n.kind === 'approval')
    .map((n) => (n.config?.ui?.app ?? n.config?.ui?.source ?? n.kind ?? '').toLowerCase())
  const pending = Object.values(mockProposals).find((p) => p.type === 'flow_publish' && p.status === 'pending' && p.params?.flow_id === f.id)
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  return {
    ...f,
    triggerKind: f.trigger?.kind ?? null,
    apps,
    aiSteps: nodes.filter((n) => n.kind === 'ai_step').length,
    runs7d: days,
    lastRun: runs[0] ?? null,
    spentThisMonthCredits: runs
      .filter((r) => r.startedAt && new Date(r.startedAt) >= monthStart)
      .reduce((s, r) => s + r.costCredits, 0),
    publishState: pending ? 'pending' : f.status === 'published' ? 'live' : 'draft',
    pendingProposalId: pending?.id ?? null,
    publishedVersion: f.status === 'published' ? f.version ?? 1 : null,
  }
}

export const mockFlowVersions: Record<string, FlowVersionInfo[]> = {
  [TRIAGE_FLOW.id]: [
    { id: 'flv-7', flowId: TRIAGE_FLOW.id, version: 7, title: TRIAGE_FLOW.title, note: 'Published', status: 'live', createdBy: 'operator', nodeCount: 7, createdAt: agoIso(2 * 86_400_000) },
    { id: 'flv-4', flowId: TRIAGE_FLOW.id, version: 4, title: TRIAGE_FLOW.title, note: 'First version', status: 'superseded', createdBy: 'operator', nodeCount: 5, createdAt: agoIso(27 * 86_400_000) },
  ],
}

export function mockSnapshot(f: Flow, note: string) {
  const list = (mockFlowVersions[f.id] ??= [])
  const version = f.version ?? 1
  const row: FlowVersionInfo = {
    id: `flv-${f.id}-${version}`, flowId: f.id, version, title: f.title, note, status: 'pending',
    createdBy: 'operator', nodeCount: Array.isArray(f.nodes) ? f.nodes.length : 0, createdAt: nowIso(),
  }
  const i = list.findIndex((v) => v.version === version)
  if (i >= 0) list[i] = row
  else list.unshift(row)
  return row
}

/** Mock graph snapshots per version (restore puts them back). */
const graphs: Record<string, { nodes: unknown[]; edges: unknown[] }> = {}
export function rememberGraph(f: Flow) {
  graphs[`${f.id}@${f.version ?? 1}`] = { nodes: f.nodes ?? [], edges: f.edges ?? [] }
}
export function graphAt(flowId: string, version: number) {
  return graphs[`${flowId}@${version}`]
}
rememberGraph(TRIAGE_FLOW)

export const mockFlowSuggestions: FlowSuggestion[] = [
  {
    id: 'sg-stripe-payout-digest',
    title: 'Summarise Stripe payouts every Friday?',
    sub: 'Stripe is connected — Growth can match payouts to signups',
    hint: 'Growth · 2 steps',
    area: 'Business',
    runsAs: 'Growth',
    helperArea: 'marketing',
    from: 'chart-line',
    to: 'mail',
    count: 1,
    source: 'connector',
    draft: {
      title: 'Summarise Stripe payouts every Friday',
      trigger: { kind: 'schedule', spec: { cron: '0 16 * * 5' } },
      nodes: [
        { id: 'trigger', kind: 'trigger', label: 'Summarise Stripe payouts every Friday', sublabel: '', x: 277, y: 36, config: { ui: { app: 'chart-line' } } },
        { id: 'step-1', kind: 'ai_step', label: 'Match payouts to signups', sublabel: '', x: 277, y: 176, config: { brief: 'Match payouts to signups' } },
        { id: 'send', kind: 'connector', label: 'Send the summary', sublabel: '', x: 277, y: 316, config: { ui: { app: 'mail' } } },
      ],
      edges: [
        { id: 'e1', from: 'trigger', to: 'step-1' },
        { id: 'e2', from: 'step-1', to: 'send' },
      ],
    },
  },
]

/** Flow-publish proposals raised in mock mode. */
export function mockPublishProposal(f: Flow) {
  const id = `prp-publish-${f.id}-${f.version ?? 1}`
  const snap = mockSnapshot(f, 'Published')
  rememberGraph(f)
  mockProposals[id] = proposal(id, `Publish flow: ${f.title}`, 'Approving will publish the flow and register its trigger.', {
    type: 'flow_publish', risk: 'medium', params: { flow_id: f.id, version: snap.version },
  })
  inboxItems.unshift({
    id: `inbox-${id}`, title: `Publish flow: ${f.title}`, summary: 'Approving will publish the flow and register its trigger.',
    sessionId: '', channelId: '', kind: 'decision', status: 'pending', createdAt: nowIso(),
    asker: 'Chief', askerArea: 'brand', needsYou: true,
    proposals: [{ who: 'Chief', area: 'brand', text: `Publish flow: ${f.title}`, due: '', proposalId: id, type: 'flow_publish', risk: 'medium' }],
    actions: [{ label: 'Approve', primary: true }, { label: 'Reject' }],
  })
  return mockProposals[id]
}

/** Approving a mock flow_publish proposal publishes the flow. */
export function applyMockFlowPublish(proposalId: string, approved: boolean) {
  const p = mockProposals[proposalId]
  if (!p || p.type !== 'flow_publish') return
  const f = flows.find((x) => x.id === p.params?.flow_id)
  if (!f) return
  f.status = approved ? 'published' : 'draft'
  f.enabled = approved
  for (const v of mockFlowVersions[f.id] ?? []) {
    if (v.version === p.params?.version) v.status = approved ? 'live' : 'pending'
    else if (approved && v.status === 'live') v.status = 'superseded'
  }
}

/** Simulated engine for mock test-runs / runs: every node "runs" in order. */
export function mockRun(f: Flow, test: boolean): FlowRun {
  const nodes = (Array.isArray(f.nodes) ? f.nodes : []) as { id: string; kind: string; label?: string; sublabel?: string }[]
  const st: FlowRunStep[] = []
  let status = 'done'
  for (const n of nodes) {
    if (n.kind === 'approval' && !test) {
      st.push({ nodeId: n.id, kind: n.kind, label: n.label ?? 'Approval', status: 'waiting', durationMs: 0, note: n.sublabel || 'Waiting for your approval' })
      status = 'needs_you'
      break
    }
    st.push({
      nodeId: n.id, kind: n.kind, label: n.label ?? n.kind,
      status: n.kind === 'connector' && test ? 'skipped' : 'done',
      durationMs: n.kind === 'ai_step' ? 1200 : 100,
      ...(n.kind === 'ai_step' ? { output: { result: `${n.label ?? 'Step'} — done` } } : {}),
      ...(n.kind === 'connector' && test ? { note: 'Skipped in test' } : {}),
      ...(n.kind === 'approval' && test ? { note: 'Would wait for you' } : {}),
    })
  }
  const run: FlowRun = {
    id: `frn-mock-${Date.now().toString(36)}-${st.length}`, flowId: f.id, status, triggerSummary: test ? 'test-run' : 'manual',
    startedBy: 'operator', costCredits: 4 * nodes.filter((n) => n.kind === 'ai_step').length, duration: status === 'done' ? 2 : null,
    waitingFor: status === 'needs_you' ? st[st.length - 1]?.nodeId ?? null : null, jobIds: [], startedAt: nowIso(),
    endedAt: status === 'done' ? nowIso() : null, steps: st,
  }
  flowRuns.unshift(run)
  return run
}
