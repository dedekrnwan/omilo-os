// Inbox decision helpers shared by Office › Inbox and /notifications.
// An InboxItem's `proposals` entries link to real Proposals (`proposalId`) or
// to a flow run parked at an approval step (`flowId` + `flowRunId`).

import type { InboxItem, InboxProposal } from '../../core/domain/types'
import type { ProposalDecision } from '../../app/queries'

/** Entries that can actually be decided (linked to a proposal or a flow run). */
export function linkedEntries(item: InboxItem): InboxProposal[] {
  return (item.proposals ?? []).filter((p) => p.proposalId || (p.flowId && p.flowRunId))
}

/** True when the item can be approved / rejected from the UI. */
export function isDecidable(item: InboxItem): boolean {
  return linkedEntries(item).length > 0
}

/** Proposals still open (not decided yet). */
function open(entries: InboxProposal[]) {
  return entries.filter((p) => !p.status || p.status === 'pending' || p.status === 'changes_requested')
}

/** One decision per linked entry (optionally only the given proposal indices). */
export function decisionsFor(
  item: InboxItem,
  kind: 'approve' | 'reject' | 'changes',
  opts: { note?: string; params?: Record<string, unknown>; only?: InboxProposal[] } = {},
): ProposalDecision[] {
  const entries = open(opts.only ?? linkedEntries(item))
  return entries.map((p): ProposalDecision => {
    if (!p.proposalId) return { kind: 'flowRun', flowId: p.flowId!, runId: p.flowRunId!, approve: kind === 'approve' }
    if (kind === 'approve') return { kind: 'approve', proposalId: p.proposalId, note: opts.note, params: opts.params }
    const note = opts.note || (kind === 'reject' ? 'Rejected from the inbox' : 'Changes requested from the inbox')
    return kind === 'reject'
      ? { kind: 'reject', proposalId: p.proposalId, note }
      : { kind: 'changes', proposalId: p.proposalId, note }
  })
}

/** "$4,800" in the primary action label → 4800. */
export function amountOf(item: InboxItem): number | null {
  const label = item.actions?.find((a) => a.primary)?.label ?? item.title
  const m = /\$([\d,]+(?:\.\d+)?)/.exec(label)
  return m ? Number(m[1].replace(/,/g, '')) : null
}

/** "14-day" / "14 days" in the summary → 14. */
export function daysOf(item: InboxItem): number | null {
  const m = /(\d+)[- ]day/i.exec(item.summary)
  return m ? Number(m[1]) : null
}

/** Same local calendar day as now. */
export function isToday(iso: string | undefined, now = new Date()): boolean {
  if (!iso) return false
  const d = new Date(iso)
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

/** Run every decision; resolves with the number that succeeded. */
export async function runAll(
  decisions: ProposalDecision[],
  mutate: (d: ProposalDecision) => Promise<unknown>,
): Promise<number> {
  const results = await Promise.allSettled(decisions.map((d) => mutate(d)))
  const failed = results.filter((r) => r.status === 'rejected')
  if (failed.length && failed.length === results.length) throw (failed[0] as PromiseRejectedResult).reason
  return results.length - failed.length
}
