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

export type AmountCurrency = 'IDR' | 'USD'

function amountMatch(item: InboxItem): { value: number; currency: AmountCurrency } | null {
  const label = item.actions?.find((a) => a.primary)?.label ?? item.title
  const rp = /Rp\.?\s?([\d.]+(?:,\d+)?)\s*(rb|ribu|jt|juta)?/i.exec(label)
  if (rp) {
    let value = Number(rp[1].replace(/\./g, '').replace(',', '.'))
    const unit = rp[2]?.toLowerCase()
    if (unit === 'rb' || unit === 'ribu') value *= 1_000
    if (unit === 'jt' || unit === 'juta') value *= 1_000_000
    return { value, currency: 'IDR' }
  }
  const usd = /\$([\d,]+(?:\.\d+)?)/.exec(label)
  return usd ? { value: Number(usd[1].replace(/,/g, '')), currency: 'USD' } : null
}

/** The money amount a decision asks for ("Approve Rp 1,5 jt" / "Approve $300"). */
export function amountOf(item: InboxItem): number | null {
  return amountMatch(item)?.value ?? null
}

/** Currency the request was written in (defaults to Rupiah). */
export function currencyOf(item: InboxItem): AmountCurrency {
  return amountMatch(item)?.currency ?? 'IDR'
}

/** "Rp 1.500.000" / "$300" */
export function formatAmount(n: number, currency: AmountCurrency): string {
  return currency === 'USD' ? `$${n.toLocaleString('en-US')}` : `Rp ${n.toLocaleString('id-ID')}`
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
