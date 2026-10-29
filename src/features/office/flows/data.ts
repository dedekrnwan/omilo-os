// ── Office Flows: shared types + the static template catalog ─────────────────
// Flows, runs and suggestions come from the API; templates stay a static catalog
// ("Use" creates a real draft flow from one).

import type { HelperArea } from '../../../core/domain/types'
import type { FlowIconId } from '../../../ui/ds/FlowChain'

// ── Shared types ──────────────────────────────────────────────────────────────

export type FlowTab = 'Yours' | 'Suggested' | 'Templates' | 'Runs'

export type FlowRunStatus = 'Running' | 'Needs you' | 'Done' | 'Failed'

export type FlowArea = 'Engineering' | 'Marketing' | 'Business' | 'Growth'

/** Integration chain for a flow card: source app → AI (+N steps) → destination app. */
export interface FlowChainData {
  from: FlowIconId
  to: FlowIconId
  count: number
}

export interface TemplateFlow extends FlowChainData {
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

// ── Templates ─────────────────────────────────────────────────────────────────

export const TEMPLATES: TemplateFlow[] = [
  { id: 't1', title: 'Incident → postmortem',     desc: 'Pages on-call, collects the timeline, drafts the postmortem.',          areas: ['brand', 'dev'], from: 'siren', to: 'file-text', count: 1 },
  { id: 't2', title: 'PR digest to chat',          desc: 'Morning summary of open PRs, reviews needed and blockers.',             areas: ['brand', 'dev', 'ops'], from: 'github', to: 'message-circle', count: 1 },
  { id: 't3', title: 'Weekly uptime report',        desc: 'Pulls uptime and latency, writes the Friday report.',                  areas: ['brand', 'ops'], from: 'clock', to: 'mail', count: 1 },
  { id: 't4', title: 'Deploy failure triage',       desc: 'Reads logs on failed deploys and posts the likely cause.',             areas: ['brand', 'dev'], from: 'github', to: 'slack', count: 1 },
  { id: 't5', title: 'Release notes from merges',   desc: 'Turns merged PRs into readable release notes.',                       areas: ['brand', 'dev', 'ops'], from: 'github', to: 'file-text', count: 1 },
  { id: 't6', title: 'Freeze-window guard',          desc: 'Blocks deploys during freeze windows and tells the team.',            areas: ['brand', 'dev'], from: 'github', to: 'user-check', count: 1 },
  { id: 't7', title: 'Stale PR nudger',              desc: 'Labels idle PRs and pings the author after 5 days.',                 areas: ['brand', 'dev'], from: 'github', to: 'message-circle', count: 1 },
  { id: 't8', title: 'On-call handoff',              desc: "Summarises the week's incidents for the next on-call.",              areas: ['brand'], from: 'siren', to: 'file-text', count: 1 },
  { id: 't9', title: 'Cost spike alert',             desc: 'Watches cloud spend and flags unusual jumps.',                        areas: ['brand', 'ops'], from: 'chart-line', to: 'message-circle', count: 1 },
  { id: 't10', title: 'Referral signup tracker',    desc: 'Matches Stripe payouts to referral signups weekly.',                  areas: ['marketing', 'brand'], from: 'chart-line', to: 'mail', count: 1 },
  { id: 't11', title: 'Sales pipeline summary',     desc: 'Pulls CRM data and sends a pipeline digest every Monday.',            areas: ['sales'], from: 'clock', to: 'message-circle', count: 1 },
  { id: 't12', title: 'Support ticket triage',      desc: 'Classifies incoming tickets and assigns them to the right helper.',   areas: ['brand', 'support'], from: 'message-circle', to: 'user-check', count: 1 },
]

// ── Node kinds (shared run/status chips) ──────────────────────────────────────

export type NodeKind = 'trigger' | 'ai-step' | 'connector' | 'approval' | 'condition'
