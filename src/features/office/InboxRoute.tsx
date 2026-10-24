import { useNavigate, useParams } from '@tanstack/react-router'
import { ArrowRight, ArrowUpRight, CalendarSync, Check, ChevronRight, CircleCheck, Inbox, ListFilter, Reply } from 'lucide-react'
import { useState, useEffect } from 'react'
import type React from 'react'
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
import { APPROVED_TOAST, BUDGET, ROUTINE_SUGGESTION } from './data'
import { Toast } from './ui'

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

// ── Approved banner (pen U6qpL8 `Approved`) ──────────────────────────────────

function ApprovedBanner({ text, onUndo }: { text: string; onUndo: () => void }) {
  return (
    <div className="flex w-full items-center gap-[8px] rounded-base bg-ok-tint px-[12px] py-[8px] outline-1 -outline-offset-1 outline-ok-line">
      <CircleCheck size={14} aria-hidden className="shrink-0 text-ok" />
      <span className="min-w-0 truncate text-[12.5px] font-medium text-ok">{text}</span>
      <span className="h-px flex-1" />
      <button type="button" onClick={onUndo} className="text-[12px] whitespace-nowrap text-link hover:underline">
        Undo · 5 min
      </button>
    </div>
  )
}

function OpenLink({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${title}`}
      className="flex items-center gap-[3px] pl-[8px] text-[12px] font-medium text-ink-2 hover:text-ink"
    >
      Open
      <ArrowUpRight size={12} aria-hidden />
    </button>
  )
}

function CardTop({
  area,
  who,
  when,
  chip,
}: {
  area: InboxItem['askerArea']
  who: string
  when?: string
  chip?: React.ReactNode
}) {
  return (
    <div className="flex w-full items-center gap-[7px]">
      <Mascot size={20} radius={6} area={area} />
      <span className="text-[12.5px] font-medium text-ink">{who}</span>
      {when && <span className="text-[12px] text-muted">{when}</span>}
      {chip}
      <span className="h-px flex-1" />
      <StatusChip kind="needs" />
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
  approvedText,
  onUndo,
}: {
  item: InboxItem
  channel?: Channel
  onOpen: () => void
  onApprove: () => void
  onReviewOneByOne: () => void
  onChangeAmount: () => void
  /** Set once approved: the green banner replaces the action row. */
  approvedText?: string
  onUndo: () => void
}) {
  function handlerFor(label: string) {
    const l = label.toLowerCase()
    if (l.startsWith('approve')) return onApprove
    if (l.startsWith('review')) return onReviewOneByOne
    if (l.startsWith('change')) return onChangeAmount
    return onOpen // Reply → open the thread
  }

  return (
    <article
      aria-label={item.title}
      className="flex w-full flex-col gap-[12px] rounded-lg bg-surface p-[16px] outline-1 -outline-offset-1 outline-line-strong"
    >
      <CardTop area={item.askerArea} who={item.asker} when={item.askedAgo} chip={<AreaFor channel={channel} />} />

      <div className="flex w-full flex-col gap-[4px]">
        <h3 className="m-0 text-[14.5px] font-semibold text-ink">{item.title}</h3>
        <p className="m-0 text-[13px] leading-[1.5] text-ink-2">{item.summary}</p>
      </div>

      {item.proposals && item.proposals.length > 0 && (
        <ul className="m-0 flex w-full list-none flex-col rounded-md bg-soft p-0 outline-1 -outline-offset-1 outline-line">
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

      {approvedText ? (
        <ApprovedBanner text={approvedText} onUndo={onUndo} />
      ) : (
        <div className="flex w-full items-center gap-[6px]">
          {item.actions?.map((a) => (
            <Button
              key={a.label}
              height={28}
              variant={a.primary ? 'primary' : 'secondary'}
              icon={a.icon === 'check' ? Check : a.icon === 'reply' ? Reply : undefined}
              onClick={handlerFor(a.label)}
            >
              {a.label}
            </Button>
          ))}
          <span className="h-px flex-1" />
          {item.reassurance && <span className="text-[12px] text-muted">{item.reassurance}</span>}
          <OpenLink title={item.title} onOpen={onOpen} />
        </div>
      )}
    </article>
  )
}

/** Chief's routine suggestion (pen BoenW `Decision · Spread Monday routines`). */
function RoutineSuggestionCard({
  applied,
  onApply,
  onUndo,
  onSee,
  onDismiss,
}: {
  applied: boolean
  onApply: () => void
  onUndo: () => void
  onSee: () => void
  onDismiss: () => void
}) {
  const s = ROUTINE_SUGGESTION
  return (
    <article
      aria-label={s.title}
      className="flex w-full flex-col gap-[12px] rounded-lg bg-surface p-[16px] outline-1 -outline-offset-1 outline-line-strong"
    >
      <CardTop
        area="brand"
        who={s.asker}
        when={s.askedAgo}
        chip={
          <span className="inline-flex h-[22px] items-center gap-[4px] rounded-sm bg-soft px-[8px] outline-1 -outline-offset-1 outline-line-strong">
            <CalendarSync size={12} aria-hidden className="text-ink-2" />
            <span className="text-[12px] font-medium text-ink-2">Routines</span>
          </span>
        }
      />
      <div className="flex w-full flex-col gap-[4px]">
        <h3 className="m-0 text-[14.5px] font-semibold text-ink">{s.title}</h3>
        <p className="m-0 text-[13px] leading-[1.5] text-ink-2">{s.summary}</p>
      </div>
      <ul className="m-0 flex w-full list-none flex-col rounded-md bg-soft p-0 outline-1 -outline-offset-1 outline-line">
        {s.moves.map((m, i) => (
          <li
            key={m.name}
            className={`flex items-center gap-[10px] px-[12px] py-[9px] ${
              i < s.moves.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''
            }`}
          >
            <Mascot size={18} radius={5} area={m.area} />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{m.name}</span>
            <span className="text-[12px] text-faint">{m.from}</span>
            <ArrowRight size={12} aria-hidden className="text-faint" />
            <span className="text-[12px] font-semibold text-ink">{m.to}</span>
          </li>
        ))}
      </ul>
      {applied ? (
        <ApprovedBanner text="Applied · 2 routines moved" onUndo={onUndo} />
      ) : (
        <div className="flex w-full items-center gap-[6px]">
          <Button height={28} variant="primary" icon={Check} onClick={onApply}>
            Apply both
          </Button>
          <Button height={28} variant="secondary" icon={CalendarSync} onClick={onSee}>
            See in Routines
          </Button>
          <Button height={28} variant="secondary" onClick={onDismiss}>
            Not now
          </Button>
        </div>
      )}
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

/** Screenshot-able states: `?state=review|approved|amount|routine`. */
type InboxState = 'review' | 'approved' | 'amount' | 'routine'

function readState(): InboxState | undefined {
  if (typeof window === 'undefined') return undefined
  const v = new URLSearchParams(window.location.search).get('state')
  return v === 'review' || v === 'approved' || v === 'amount' || v === 'routine' ? v : undefined
}

function approvedTextFor(item: InboxItem, results: ReviewResult[]) {
  if (!item.proposals?.length) {
    const amount = /\$[\d,]+/.exec(item.actions?.find((a) => a.primary)?.label ?? '')?.[0]
    return `You approved ${amount ?? 'this'} · ${item.asker} started`
  }
  const ok = results.filter((r) => r.decision === 'approved')
  const who = [...new Set(ok.map((r) => item.proposals![r.proposalIndex].who))]
  const n = ok.length
  return `You approved ${n} task${n === 1 ? '' : 's'}${who.length ? ` · ${who.join(' and ')} started` : ''}`
}

function InboxList({ area }: { area: AreaFilter }) {
  const navigate = useNavigate()
  const { data: all = [], isLoading } = useInbox()
  const { data: channels = [] } = useChannels()
  const channelOf = (id: string) => channels.find((c) => c.id === id)
  const [initial] = useState(readState)

  const items = area ? all.filter((i) => i.channelId === area) : all
  const pending = items.filter((i) => i.status === 'pending')
  const cards = pending.filter((i) => !i.compact)
  const rows = pending.filter((i) => i.compact)
  const running = items.filter((i) => i.status === 'running')
  const done = items.filter((i) => i.status === 'done')
  const open = (item: InboxItem) =>
    void navigate({ to: '/office/inbox/$itemId', params: { itemId: item.id } })
  const areaName = area ? channelOf(area)?.name : undefined
  const multi = cards.find((c) => c.proposals?.length)
  const budget = cards.find((c) => c.actions?.some((a) => a.label.toLowerCase().startsWith('change')))

  // ── Interactive state ──────────────────────────────────────────────────────
  const [approved, setApproved] = useState<Record<string, ReviewResult[]>>({})
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [changing, setChanging] = useState<string | null>(null)
  const [toast, setToast] = useState<{ title: string; body?: string } | null>(null)
  const [suggestion, setSuggestion] = useState<'open' | 'applied' | 'hidden'>(
    initial === 'routine' ? 'open' : 'hidden',
  )

  // Seed the requested design state once the mock items are loaded.
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    if (seeded || isLoading) return
    setSeeded(true)
    if (initial === 'review' && multi) setReviewing(multi.id)
    if (initial === 'amount' && budget) setChanging(budget.id)
    if (initial === 'approved' && multi) {
      setApproved({ [multi.id]: multi.proposals!.map((_, i) => ({ proposalIndex: i, decision: 'approved' })) })
      setToast(APPROVED_TOAST)
    }
  }, [seeded, isLoading, initial, multi, budget])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  function markApproved(item: InboxItem, results: ReviewResult[]) {
    if (!results.some((r) => r.decision === 'approved')) return
    setApproved((prev) => ({ ...prev, [item.id]: results }))
    const n = results.filter((r) => r.decision === 'approved').length
    setToast(
      item.proposals?.length
        ? n === item.proposals.length && item.id === multi?.id
          ? APPROVED_TOAST
          : { title: `${n} task${n === 1 ? '' : 's'} approved` }
        : { title: `${item.title.replace(/^Approve /, '')} approved` },
    )
  }

  function undo(id: string) {
    setApproved((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setToast(null)
  }

  const reviewingItem = cards.find((c) => c.id === reviewing)
  const changingItem = cards.find((c) => c.id === changing)
  const needsCount =
    pending.filter((i) => !approved[i.id]).length + (suggestion === 'open' ? 1 : 0)

  return (
    <>
      <Topbar
        icon={Inbox}
        title="Inbox"
        meta={`${pending.length} need you`}
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
            <section aria-label="Needs you" className="flex min-w-0 flex-1 flex-col gap-[10px]">
              <SectionTitle title="Needs you" count={needsCount} />
              {suggestion !== 'hidden' && (
                <RoutineSuggestionCard
                  applied={suggestion === 'applied'}
                  onApply={() => {
                    setSuggestion('applied')
                    setToast({ title: 'Routines moved', body: 'Instagram report → Mon 11:00 · Dependency updates → Tue 10:00.' })
                  }}
                  onUndo={() => {
                    setSuggestion('open')
                    setToast(null)
                  }}
                  onSee={() => void navigate({ to: '/office/routines' })}
                  onDismiss={() => setSuggestion('hidden')}
                />
              )}
              {cards.map((item) => {
                const results = approved[item.id]
                return (
                  <DecisionCard
                    key={item.id}
                    item={item}
                    channel={channelOf(item.channelId)}
                    onOpen={() => open(item)}
                    onApprove={() =>
                      markApproved(
                        item,
                        (item.proposals ?? [{}]).map((_, i) => ({ proposalIndex: i, decision: 'approved' as const })),
                      )
                    }
                    onReviewOneByOne={() => setReviewing(item.id)}
                    onChangeAmount={() => setChanging(item.id)}
                    approvedText={results ? approvedTextFor(item, results) : undefined}
                    onUndo={() => undo(item.id)}
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
              <a href="#" className="self-start text-[12px] text-muted hover:text-ink-2">
                See all activity →
              </a>
            </aside>
          </div>
        )}
      </div>

      {reviewingItem && (
        <InboxReviewDialog
          open
          item={reviewingItem}
          initialStep={initial === 'review' ? 1 : 0}
          onClose={(results) => {
            markApproved(reviewingItem, results)
            setReviewing(null)
          }}
        />
      )}

      {changingItem && (
        <InboxChangeAmountDialog
          open
          asker={changingItem.asker}
          asked={BUDGET.asked}
          options={BUDGET.options}
          defaultAmount={BUDGET.defaultAmount}
          runFor={BUDGET.runFor}
          dailyCap={BUDGET.dailyCap}
          defaultNote={BUDGET.note}
          onClose={() => setChanging(null)}
          onApprove={(amount) => {
            setApproved((prev) => ({ ...prev, [changingItem.id]: [{ proposalIndex: 0, decision: 'approved' }] }))
            setToast({ title: `$${amount.toLocaleString('en-US')} budget approved`, body: `${changingItem.asker} starts the referral ads.` })
            setChanging(null)
          }}
        />
      )}

      {toast && (
        <div className="fixed top-[60px] right-[24px] z-40">
          <Toast
            icon={CircleCheck}
            iconClassName="text-ok"
            title={toast.title}
            body={toast.body}
            onClose={() => setToast(null)}
          />
        </div>
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
