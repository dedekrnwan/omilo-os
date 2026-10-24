import { useNavigate, useParams } from '@tanstack/react-router'
import { ArrowUpRight, Check, ChevronRight, Inbox, ListFilter, Reply, Undo2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import type { Channel, InboxItem } from '../../core/domain/types'
import { useChannels, useInbox, useInboxItem } from '../../app/queries'
import { ChatSession } from '../../ui/ChatSession/ChatSession'
import { AreaChip } from '../../ui/ds/AreaChip'
import { Button } from '../../ui/ds/Button'
import { Topbar } from '../../ui/ds/Frame'
import { Mascot } from '../../ui/ds/Mascot'
import { useOfficeArea } from './OfficeAreaContext'
import type { AreaFilter } from './OfficeSidebar'
import { InboxReviewDialog } from './InboxReviewDialog'
import type { ReviewResult } from './InboxReviewDialog'
import { InboxChangeAmountDialog } from './InboxChangeAmountDialog'

/** Next scheduled routine under "Running now" (routines aren't wired yet). */
const nextRoutine = { area: 'brand' as const, text: 'Thursday check-in · 09:00' }

// ── Pieces ────────────────────────────────────────────────────────────────────

function SectionTitle({ title, count, className = '' }: { title: string; count: number; className?: string }) {
  return (
    <div className={`flex items-center gap-[6px] ${className}`}>
      <h2 className="m-0 text-[13px] font-semibold text-ink">{title}</h2>
      <span className="text-[12.5px] text-muted">{count}</span>
    </div>
  )
}

function StatusChip({ kind }: { kind: 'needs' | 'done' }) {
  return kind === 'needs' ? (
    <span className="rounded-pill bg-[#EB683414] px-[7px] py-[2px] text-[11px] font-semibold text-[#C2410C]">
      Needs you
    </span>
  ) : (
    <span className="rounded-pill bg-ok-tint px-[7px] py-[2px] text-[11px] font-semibold text-ok">Done</span>
  )
}

function AreaFor({ channel }: { channel?: Channel }) {
  return channel ? <AreaChip accent={channel.accent} label={channel.name} /> : null
}

// ── Inbox interactive state types ─────────────────────────────────────────────

interface ApprovedToast {
  count: number
  label: string
}

// ── ApprovedCardBanner — green toast chip (top-right, auto-dismisses) ─────────

function ApprovedCardBanner({ toast, onUndo, onDismiss }: { toast: ApprovedToast; onUndo: () => void; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-[16px] right-[16px] z-40 flex items-center gap-[10px] rounded-pill bg-ink px-[14px] py-[9px] shadow-[0_8px_24px_#0C0A0933]"
    >
      <Check size={13} aria-hidden className="text-ok" />
      <span className="text-[12.5px] font-medium text-primary-ink">{toast.label}</span>
      <button
        type="button"
        onClick={onUndo}
        className="flex items-center gap-[4px] text-[12px] text-on-ink-2 hover:text-primary-ink transition-colors ml-[4px]"
      >
        <Undo2 size={12} aria-hidden />
        Undo
      </button>
    </div>
  )
}

/** Full decision card (pen `Decision · …`): surface · radius 12 · line-strong · p-16 · gap 12. */
function DecisionCard({
  item,
  channel,
  onOpen,
  onApprove,
  onReviewOneByOne,
  onChangeAmount,
  approved,
  approvedResults,
}: {
  item: InboxItem
  channel?: Channel
  onOpen: () => void
  onApprove: () => void
  onReviewOneByOne: () => void
  onChangeAmount: () => void
  approved?: boolean
  approvedResults?: ReviewResult[]
}) {
  const approvedCount = approvedResults ? approvedResults.filter((r) => r.decision === 'approved').length : 0

  // Detect if this card has a "Change amount" style action (budget approval)
  const hasChangeAmount = item.actions?.some((a) => a.label.toLowerCase().includes('approve $') || a.label.toLowerCase().includes('approve'))
  // Detect if it has multiple proposals (multi-task review)
  const hasProposals = item.proposals && item.proposals.length > 0

  if (approved) {
    // ── Approved state (matches U6qpL8.png) ───────────────────────────────────
    return (
      <article
        aria-label={item.title}
        className="flex w-full flex-col gap-[12px] rounded-lg outline-1 -outline-offset-1 outline-ok-line bg-ok-tint/60 p-[16px]"
      >
        <div className="flex w-full items-center gap-[7px]">
          <Mascot size={20} radius={6} area={item.askerArea} />
          <span className="text-[12.5px] font-medium text-ink">{item.asker}</span>
          {item.askedAgo && <span className="text-[12px] text-muted">{item.askedAgo}</span>}
          <AreaFor channel={channel} />
          <span className="h-px flex-1" />
        </div>

        <div className="flex w-full flex-col gap-[4px]">
          <h3 className="m-0 text-[14.5px] font-semibold text-ink">{item.title}</h3>
          <p className="m-0 text-[13px] leading-[1.5] text-ink-2">{item.summary}</p>
        </div>

        {hasProposals && item.proposals && (
          <ul className="m-0 flex w-full list-none flex-col rounded-md outline-1 -outline-offset-1 outline-ok-line bg-ok-tint/40 p-0">
            {item.proposals.map((p, i) => {
              const result = approvedResults?.find((r) => r.proposalIndex === i)
              return (
                <li
                  key={p.text}
                  className={`flex items-center gap-[10px] px-[12px] py-[9px] ${
                    i < item.proposals!.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-ok-line)]' : ''
                  }`}
                >
                  <Mascot size={18} radius={5} area={p.area} />
                  <span className="w-[56px] shrink-0 text-[12.5px] font-medium text-ink">{p.who}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{p.text}</span>
                  <span className="text-[12px] text-muted">{p.due}</span>
                  {result ? (
                    result.decision === 'approved' ? (
                      <Check size={13} aria-label="Approved" className="text-ok" />
                    ) : (
                      <span className="text-[11px] text-muted capitalize">{result.decision}</span>
                    )
                  ) : (
                    <ChevronRight size={14} aria-hidden className="text-faint" />
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex w-full items-center gap-[6px]">
          <span className="flex items-center gap-[5px] rounded-pill bg-ok-tint px-[8px] py-[3px] outline-1 -outline-offset-1 outline-ok-line text-[12px] font-medium text-ok">
            <Check size={12} aria-hidden />
            {hasProposals
              ? `You approved ${approvedCount} task${approvedCount !== 1 ? 's' : ''}${item.asker ? ` · ${item.asker} and Growth started` : ''}`
              : `You approved ${item.title}`}
          </span>
          <span className="h-px flex-1" />
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Open ${item.title}`}
            className="flex items-center gap-[3px] pl-[8px] text-[12px] font-medium text-ink-2 hover:text-ink"
          >
            Open
            <ArrowUpRight size={12} aria-hidden />
          </button>
        </div>
      </article>
    )
  }

  // ── Default (pending) state ───────────────────────────────────────────────
  return (
    <article
      aria-label={item.title}
      className="flex w-full flex-col gap-[12px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface p-[16px]"
    >
      <div className="flex w-full items-center gap-[7px]">
        <Mascot size={20} radius={6} area={item.askerArea} />
        <span className="text-[12.5px] font-medium text-ink">{item.asker}</span>
        {item.askedAgo && <span className="text-[12px] text-muted">{item.askedAgo}</span>}
        <AreaFor channel={channel} />
        <span className="h-px flex-1" />
        {item.needsYou && <StatusChip kind="needs" />}
      </div>

      <div className="flex w-full flex-col gap-[4px]">
        <h3 className="m-0 text-[14.5px] font-semibold text-ink">{item.title}</h3>
        <p className="m-0 text-[13px] leading-[1.5] text-ink-2">{item.summary}</p>
      </div>

      {item.proposals && item.proposals.length > 0 && (
        <ul className="m-0 flex w-full list-none flex-col rounded-md outline-1 -outline-offset-1 outline-line bg-soft p-0">
          {item.proposals.map((p, i) => (
            <li
              key={p.text}
              className={`flex items-center gap-[10px] px-[12px] py-[9px] ${
                i < item.proposals!.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''
              }`}
            >
              <Mascot size={18} radius={5} area={p.area} />
              <span className="w-[56px] shrink-0 text-[12.5px] font-medium text-ink">{p.who}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{p.text}</span>
              <span className="text-[12px] text-muted">{p.due}</span>
              <ChevronRight size={14} aria-hidden className="text-faint" />
            </li>
          ))}
        </ul>
      )}

      <div className="flex w-full items-center gap-[6px]">
        {/* "Review one by one" replaces / augments the Approve button for multi-proposal cards */}
        {hasProposals ? (
          <>
            <Button
              height={28}
              variant="primary"
              icon={Check}
              onClick={onApprove}
            >
              Approve all {item.proposals?.length}
            </Button>
            <Button
              height={28}
              variant="secondary"
              onClick={onReviewOneByOne}
            >
              Review one by one
            </Button>
          </>
        ) : (
          item.actions?.map((a) => {
            const isApprove = a.icon === 'check' || a.primary
            return (
              <Button
                key={a.label}
                height={28}
                variant={a.primary ? 'primary' : 'secondary'}
                icon={a.icon === 'check' ? Check : a.icon === 'reply' ? Reply : undefined}
                onClick={isApprove ? onApprove : undefined}
              >
                {a.label}
              </Button>
            )
          })
        )}

        {/* "Change amount" link for budget-type cards */}
        {hasChangeAmount && !hasProposals && (
          <button
            type="button"
            onClick={onChangeAmount}
            className="flex items-center gap-[3px] text-[12px] font-medium text-ink-2 hover:text-ink transition-colors"
          >
            Change amount
          </button>
        )}

        <span className="h-px flex-1" />
        {item.reassurance && <span className="text-[12px] text-muted">{item.reassurance}</span>}
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${item.title}`}
          className="flex items-center gap-[3px] pl-[8px] text-[12px] font-medium text-ink-2 hover:text-ink"
        >
          Open
          <ArrowUpRight size={12} aria-hidden />
        </button>
      </div>
    </article>
  )
}

/** Compact "more needs you" row: mascot 20 · title 13/500 · area chip · when · chevron. */
function CompactRow({
  item,
  channel,
  last,
  onOpen,
}: {
  item: InboxItem
  channel?: Channel
  last: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-center gap-[10px] px-[14px] py-[11px] text-left transition-colors hover:bg-soft ${
        last ? '' : 'shadow-[inset_0_-1px_0_var(--color-line)]'
      }`}
    >
      <Mascot size={20} radius={6} area={item.askerArea} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{item.title}</span>
      <AreaFor channel={channel} />
      <span className="text-[12px] whitespace-nowrap text-muted">{item.askedAgo}</span>
      <ChevronRight size={14} aria-hidden className="text-faint" />
    </button>
  )
}

function RunningCard({ items }: { items: InboxItem[] }) {
  return (
    <div className="flex w-full flex-col gap-[12px] rounded-lg outline-1 -outline-offset-1 outline-line bg-soft p-[14px]">
      {items.map((r) => {
        const p = r.progress!
        return (
          <div key={r.id} className="flex flex-col gap-[6px]">
            <div className="flex items-center gap-[8px]">
              <span aria-label="running" className="size-[7px] shrink-0 rounded-full bg-ok" />
              <Mascot size={18} radius={5} area={r.askerArea} working />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{r.title}</span>
            </div>
            <div className="h-[4px] w-full overflow-hidden rounded-pill bg-[#E7E5E4]">
              <div className="h-full rounded-pill bg-ok" style={{ width: `${(p.step / p.total) * 100}%` }} />
            </div>
            <span className="text-[11.5px] text-muted">
              Step {p.step} of {p.total} · {p.elapsed}
            </span>
          </div>
        )
      })}
      <div className="flex items-center gap-[8px] shadow-[inset_0_1px_0_var(--color-line)] pt-[8px]">
        <span className="text-[12px] text-muted">Next</span>
        <Mascot size={16} radius={4} area={nextRoutine.area} />
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{nextRoutine.text}</span>
      </div>
    </div>
  )
}

function DoneCard({ item }: { item: InboxItem }) {
  return (
    <div className="flex w-full flex-col gap-[6px] rounded-lg outline-1 -outline-offset-1 outline-line-strong p-[14px]">
      <div className="flex items-center gap-[8px]">
        <Mascot size={18} radius={5} area={item.askerArea} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{item.title}</span>
        <StatusChip kind="done" />
      </div>
      <p className="m-0 text-[12.5px] leading-[1.5] text-ink-2">{item.summary}</p>
      {item.meta && <span className="text-[11.5px] text-muted">{item.meta}</span>}
    </div>
  )
}

// ── Inbox list (pen `Office · Inbox`) ─────────────────────────────────────────

/** "Done today" shows the latest cards; the rest live behind "See all activity". */
const DONE_PREVIEW = 2

function InboxList({ area }: { area: AreaFilter }) {
  const navigate = useNavigate()
  const { data: all = [], isLoading } = useInbox()
  const { data: channels = [] } = useChannels()
  const channelOf = (id: string) => channels.find((c) => c.id === id)

  const items = area ? all.filter((i) => i.channelId === area) : all
  const needs = items.filter((i) => i.status === 'pending')
  const cards = needs.filter((i) => !i.compact)
  const rows = needs.filter((i) => i.compact)
  const running = items.filter((i) => i.status === 'running')
  const done = items.filter((i) => i.status === 'done')
  const open = (item: InboxItem) =>
    void navigate({ to: '/office/inbox/$itemId', params: { itemId: item.id } })

  const areaName = area ? channelOf(area)?.name : undefined

  // ── Interactive state ──────────────────────────────────────────────────────
  /** itemId → { approved, results } */
  const [approvedMap, setApprovedMap] = useState<Record<string, { results: ReviewResult[] }>>({})
  /** Currently open review dialog */
  const [reviewingItem, setReviewingItem] = useState<InboxItem | null>(null)
  /** Currently open change-amount dialog */
  const [changingItem, setChangingItem] = useState<InboxItem | null>(null)
  /** Toast shown after an approve action */
  const [toast, setToast] = useState<(ApprovedToast & { id: string }) | null>(null)

  function markApproved(item: InboxItem, results: ReviewResult[]) {
    setApprovedMap((prev) => ({ ...prev, [item.id]: { results } }))
    const approvedCount = results.filter((r) => r.decision === 'approved').length || 1
    const label = item.proposals?.length
      ? `${approvedCount} task${approvedCount !== 1 ? 's' : ''} approved`
      : `${item.title} approved`
    setToast({ id: item.id, count: approvedCount, label })
  }

  function handleApproveAll(item: InboxItem) {
    const results: ReviewResult[] = (item.proposals ?? []).map((_, i) => ({
      proposalIndex: i,
      decision: 'approved',
    }))
    markApproved(item, results)
  }

  function handleReviewClose(results: ReviewResult[]) {
    if (reviewingItem) markApproved(reviewingItem, results)
    setReviewingItem(null)
  }

  function handleChangeAmountApprove(amount: number, _note: string) {
    if (changingItem) {
      markApproved(changingItem, [{ proposalIndex: 0, decision: 'approved' }])
    }
    setChangingItem(null)
    // amount + _note would go to real adapter; visual-only here
    void amount
  }

  function handleUndo(id: string) {
    setApprovedMap((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setToast(null)
  }

  // Static budget options (visual-only) — used for all budget-style cards.
  const BUDGET_OPTIONS: [number, number, number] = [1900, 3000, 4800]

  return (
    <>
      <Topbar
        icon={Inbox}
        title="Inbox"
        meta={`${needs.length} need you`}
        actions={
          <Button variant="secondary" height={28} icon={ListFilter}>
            {areaName ?? 'All areas'}
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-[24px] py-[20px]">
        <header className="flex flex-col gap-[4px]">
          <h1 className="m-0 font-display text-[22px] font-semibold tracking-[-0.4px] text-ink">Inbox</h1>
          <p className="m-0 text-[13px] text-muted">
            Your agents propose, you decide. Whatever you approve is done exactly as written.
          </p>
        </header>

        {isLoading ? null : items.length === 0 ? (
          <p className="m-0 text-[13px] text-muted">No items in this area yet.</p>
        ) : (
          <div className="flex w-full gap-[20px]">
            {/* Main column */}
            <section aria-label="Needs you" className="flex min-w-0 flex-1 flex-col gap-[10px]">
              <SectionTitle title="Needs you" count={needs.length} />
              {cards.map((item) => {
                const approvedState = approvedMap[item.id]
                return (
                  <DecisionCard
                    key={item.id}
                    item={item}
                    channel={channelOf(item.channelId)}
                    onOpen={() => open(item)}
                    onApprove={() => handleApproveAll(item)}
                    onReviewOneByOne={() => setReviewingItem(item)}
                    onChangeAmount={() => setChangingItem(item)}
                    approved={!!approvedState}
                    approvedResults={approvedState?.results}
                  />
                )
              })}
              {rows.length > 0 && (
                <div className="flex w-full flex-col overflow-hidden rounded-lg outline-1 -outline-offset-1 outline-line-strong">
                  {rows.map((item, i) => (
                    <CompactRow
                      key={item.id}
                      item={item}
                      channel={channelOf(item.channelId)}
                      last={i === rows.length - 1}
                      onOpen={() => open(item)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Side column */}
            <aside className="flex w-[320px] shrink-0 flex-col gap-[10px]">
              {running.length > 0 && (
                <>
                  <SectionTitle title="Running now" count={running.length} />
                  <RunningCard items={running} />
                </>
              )}
              {done.length > 0 && (
                <>
                  <SectionTitle title="Done today" count={done.length} className="pt-[8px]" />
                  {done.slice(0, DONE_PREVIEW).map((item) => (
                    <DoneCard key={item.id} item={item} />
                  ))}
                </>
              )}
              <a href="#" className="text-[12px] text-muted hover:text-ink-2">
                See all activity →
              </a>
            </aside>
          </div>
        )}
      </div>

      {/* ── Dialogs & toast ─────────────────────────────────────────────── */}
      {reviewingItem && (
        <InboxReviewDialog
          open={!!reviewingItem}
          item={reviewingItem}
          onClose={handleReviewClose}
        />
      )}

      {changingItem && (
        <InboxChangeAmountDialog
          open={!!changingItem}
          context={`${changingItem.asker} asked for ${changingItem.reassurance ?? '14 days'} for the referral launch.`}
          options={BUDGET_OPTIONS}
          defaultOption={1}
          runFor="14 days"
          dailyCap="$215"
          onClose={() => setChangingItem(null)}
          onApprove={handleChangeAmountApprove}
        />
      )}

      {toast && (
        <ApprovedCardBanner
          toast={toast}
          onUndo={() => handleUndo(toast.id)}
          onDismiss={() => setToast(null)}
        />
      )}
    </>
  )
}

// ── Item → shared ChatSession ─────────────────────────────────────────────────

function InboxItemView({ itemId }: { itemId: string }) {
  const { data: item, isLoading } = useInboxItem(itemId)
  if (isLoading) return null
  if (!item) {
    return (
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-[6px] px-[24px] text-center">
        <p className="m-0 text-[13.5px] font-medium text-ink">Not found</p>
        <p className="m-0 text-[13px] text-muted">This inbox item does not exist.</p>
      </div>
    )
  }
  // Keystone: resolve item → sessionId → render the same ChatSession primitive
  return <ChatSession key={item.sessionId} sessionId={item.sessionId} />
}

// ── InboxRoute ────────────────────────────────────────────────────────────────

/**
 * Main content for /office/inbox and /office/inbox/$itemId.
 * The OfficeSidebar and Inset wrapper are provided by OfficeLayout.
 */
export function InboxRoute() {
  const { itemId } = useParams({ strict: false })
  const { area } = useOfficeArea()

  return itemId ? <InboxItemView itemId={itemId} /> : <InboxList area={area} />
}
