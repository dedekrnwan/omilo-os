import { useNavigate, useParams } from '@tanstack/react-router'
import { ArrowRight, ArrowUpRight, CalendarSync, Check, ChevronRight, CircleCheck, CircleX, Inbox, ListFilter, Reply } from 'lucide-react'
import { useState, useEffect } from 'react'
import type React from 'react'
import type { Channel, Helper, HelperArea, InboxItem, RoutineSuggestion } from '../../core/domain/types'
import { useChannels, useDecide, useHelpers, useInbox, useInboxItem, useProposal, useRoutines, useRoutineSuggestions, useApplyRoutineSuggestion, useDismissRoutineSuggestion } from '../../app/queries'
import { ChatSession } from '../../ui/ChatSession/ChatSession'
import { AreaChip } from '../../ui/ds/AreaChip'
import { Button } from '../../ui/ds/Button'
import { Topbar } from '../../ui/ds/Frame'
import { MoreMenu } from '../../ui/ds/ItemMenu'
import { Mascot } from '../../ui/ds/Mascot'
import { notify } from '../../ui/ds/Toaster'
import { useUIStore } from '../../app/store'
import type { AreaFilter } from '../shell/area'
import { InboxReviewDialog } from './InboxReviewDialog'
import type { ReviewResult } from './InboxReviewDialog'
import { InboxChangeAmountDialog } from './InboxChangeAmountDialog'
import { amountOf, currencyOf, formatAmount, daysOf, decisionsFor, isDecidable, isToday, linkedEntries, runAll } from './decisions'
import { Toast } from './ui'

/** Next scheduled routine for the "Running now" footer (earliest enabled nextAt). */
function useNextRoutine(): { area: HelperArea; text: string } | null {
  const { data: routines = [] } = useRoutines()
  const { data: helpers = [] } = useHelpers()
  const next = routines
    .filter((r) => r.enabled && !r.paused && r.nextAt)
    .sort((a, b) => (a.nextAt! < b.nextAt! ? -1 : 1))[0]
  if (!next) return null
  const when = new Date(next.nextAt!)
  const day = when.toLocaleDateString('en-US', { weekday: 'long' })
  const time = when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const area = (helpers.find((h) => h.id === next.helperId)?.area ?? 'brand') as HelperArea
  return { area, text: `${next.name} · ${day} ${time}` }
}

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
  return channel ? <AreaChip accent={channel.accent} label={channel.name} area={channel} /> : null
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
  onReject,
  onReviewOneByOne,
  onChangeAmount,
  approvedText,
  onUndo,
  busy,
}: {
  item: InboxItem
  channel?: Channel
  onOpen: () => void
  onApprove: () => void
  onReject: () => void
  onReviewOneByOne: () => void
  onChangeAmount: () => void
  /** Set once approved: the green banner replaces the action row. */
  approvedText?: string
  onUndo: () => void
  busy?: boolean
}) {
  function handlerFor(label: string) {
    const l = label.toLowerCase()
    if (l.startsWith('approve')) return onApprove
    if (l.startsWith('reject') || l.startsWith('decline')) return onReject
    if (l.startsWith('review')) return onReviewOneByOne
    if (l.startsWith('change')) return onChangeAmount
    return onOpen // Reply / Request changes → open the thread
  }
  const many = (item.proposals?.length ?? 0) > 1

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

      {many && item.proposals && (
        <ul className="m-0 flex w-full list-none flex-col rounded-md bg-soft p-0 outline-1 -outline-offset-1 outline-line">
          {item.proposals.map((p, i) => (
            <li
              key={p.proposalId ?? p.text}
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
              disabled={busy}
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

/** Chief's routine suggestion (pen BoenW) — from GET /v1/routines/suggestions. */
function RoutineSuggestionCard({
  suggestion: s,
  helpers,
  applied,
  busy,
  onApply,
  onSee,
  onDismiss,
}: {
  suggestion: RoutineSuggestion
  helpers: Helper[]
  applied: boolean
  busy: boolean
  onApply: () => void
  onSee: () => void
  onDismiss: () => void
}) {
  const areaOf = (id: string): HelperArea => {
    const a = helpers.find((h) => h.id === id)?.area
    return (a ?? 'ops') as HelperArea
  }
  const n = s.moves.length
  return (
    <article
      aria-label={s.title}
      className="flex w-full flex-col gap-[12px] rounded-lg bg-surface p-[16px] outline-1 -outline-offset-1 outline-line-strong"
    >
      <div className="flex w-full items-center gap-[8px]">
        <Mascot size={22} radius={6} area="brand" />
        <span className="text-[13px] font-semibold text-ink">Chief</span>
        <span className="text-[12px] text-faint">suggestion</span>
        <span className="h-px flex-1" />
        <span className="inline-flex h-[22px] items-center gap-[4px] rounded-sm bg-soft px-[8px] outline-1 -outline-offset-1 outline-line-strong">
          <CalendarSync size={12} aria-hidden className="text-ink-2" />
          <span className="text-[12px] font-medium text-ink-2">Routines</span>
        </span>
      </div>
      <div className="flex w-full flex-col gap-[4px]">
        <h3 className="m-0 text-[14.5px] font-semibold text-ink">{s.title}</h3>
        <p className="m-0 text-[13px] leading-[1.5] text-ink-2">{s.desc}</p>
      </div>
      {n > 0 && (
        <ul className="m-0 flex w-full list-none flex-col rounded-md bg-soft p-0 outline-1 -outline-offset-1 outline-line">
          {s.moves.map((m, i) => (
            <li
              key={m.routineId}
              className={`flex items-center gap-[10px] px-[12px] py-[9px] ${i < n - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''}`}
            >
              <Mascot size={18} radius={5} area={areaOf(m.helperId)} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{m.name}</span>
              <span className="text-[12px] text-faint">{m.from}</span>
              <ArrowRight size={12} aria-hidden className="text-faint" />
              <span className="text-[12px] font-semibold text-ink">{m.to}</span>
            </li>
          ))}
        </ul>
      )}
      {applied ? (
        <div className="flex w-full items-center gap-[8px] rounded-base bg-ok-tint px-[12px] py-[8px] outline-1 -outline-offset-1 outline-ok-line">
          <CircleCheck size={14} aria-hidden className="shrink-0 text-ok" />
          <span className="min-w-0 truncate text-[12.5px] font-medium text-ok">
            {s.kind === 'failing' ? 'Applied · routine paused' : `Applied · ${n} routine${n === 1 ? '' : 's'} moved`}
          </span>
          <span className="h-px flex-1" />
          <button type="button" onClick={onSee} className="text-[12px] whitespace-nowrap text-link hover:underline">
            See in Routines
          </button>
        </div>
      ) : (
        <div className="flex w-full items-center gap-[6px]">
          <Button height={28} variant="primary" icon={Check} onClick={onApply} disabled={busy}>
            {s.kind === 'failing' ? 'Pause it' : n === 2 ? 'Apply both' : n > 2 ? `Apply all ${n}` : 'Apply'}
          </Button>
          <Button height={28} variant="secondary" icon={CalendarSync} onClick={onSee}>
            See in Routines
          </Button>
          <Button height={28} variant="secondary" onClick={onDismiss} disabled={busy}>
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
  const nextRoutine = useNextRoutine()
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
      {nextRoutine && (
        <div className="flex items-center gap-[8px] shadow-[inset_0_1px_0_var(--color-line)] pt-[8px]">
          <span className="text-[12px] text-muted">Next</span>
          <Mascot size={16} radius={4} area={nextRoutine.area} />
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{nextRoutine.text}</span>
        </div>
      )}
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

/** Screenshot-able states: `?state=review|amount`. */
type InboxState = 'review' | 'amount'

function readState(): InboxState | undefined {
  if (typeof window === 'undefined') return undefined
  const v = new URLSearchParams(window.location.search).get('state')
  return v === 'review' || v === 'amount' ? v : undefined
}

function fmtFor(item: InboxItem) {
  const c = currencyOf(item)
  return (n: number) => formatAmount(n, c)
}

function approvedTextFor(item: InboxItem, results: ReviewResult[], amount?: number) {
  const fmt = fmtFor(item)
  if ((item.proposals?.length ?? 0) <= 1) {
    const value = amount ?? amountOf(item)
    return `You approved ${value != null ? fmt(value) : 'this'} · ${item.asker} started`
  }
  const ok = results.filter((r) => r.decision === 'approved')
  const who = [...new Set(ok.map((r) => item.proposals![r.proposalIndex]?.who).filter(Boolean))]
  const n = ok.length
  return `You approved ${n} task${n === 1 ? '' : 's'}${who.length ? ` · ${who.join(' and ')} started` : ''}`
}

/** Toast after approving: what was approved and who goes ahead. */
function approvedToast(item: InboxItem, results: ReviewResult[], amount?: number) {
  const fmt = fmtFor(item)
  const ok = results.filter((r) => r.decision === 'approved')
  if ((item.proposals?.length ?? 0) > 1) {
    const who = [...new Set(ok.map((r) => item.proposals![r.proposalIndex]?.who).filter(Boolean))]
    return {
      title: `${ok.length} task${ok.length === 1 ? '' : 's'} approved`,
      body: who.length ? `${who.join(' and ')} ${who.length === 1 ? 'starts' : 'start'} now.` : undefined,
    }
  }
  if (amount != null) return { title: `${fmt(amount)} approved`, body: `${item.asker} goes ahead with ${fmt(amount)}.` }
  return { title: `${item.title.replace(/^Approve /, '')} approved`, body: `${item.asker} started.` }
}

interface Approved {
  results: ReviewResult[]
  amount?: number
}

function AreaFilterButton({ label, channels }: { label: string; channels: Channel[] }) {
  const setArea = useUIStore((s) => s.setArea)
  return (
    <MoreMenu
      label="Filter by area"
      trigger={
        <Button variant="secondary" height={28} icon={ListFilter} aria-label={`Filter by area: ${label}`}>
          {label}
        </Button>
      }
      items={[
        { label: 'All areas', onSelect: () => setArea(null) },
        { type: 'separator' },
        ...channels.map((c) => ({ label: c.name, onSelect: () => setArea(c.id) })),
      ]}
    />
  )
}

function InboxList({ area }: { area: AreaFilter }) {
  const navigate = useNavigate()
  const { data: all = [], isLoading, isError } = useInbox()
  const { data: channels = [] } = useChannels()
  const decide = useDecide()
  const channelOf = (id: string) => channels.find((c) => c.id === id)
  const [initial] = useState(readState)

  // ── Interactive state ──────────────────────────────────────────────────────
  const [approved, setApproved] = useState<Record<string, Approved>>({})
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [changing, setChanging] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ title: string; body?: string } | null>(null)
  // Chief's routine suggestion (GET /v1/routines/suggestions) — shown company-wide.
  const { data: helpers = [] } = useHelpers()
  const { data: suggestions = [] } = useRoutineSuggestions()
  const applySuggestion = useApplyRoutineSuggestion()
  const dismissSuggestion = useDismissRoutineSuggestion()
  // Keep the applied card on screen after the list refetches without it.
  const [appliedSnap, setAppliedSnap] = useState<RoutineSuggestion | null>(null)
  const appliedSuggestion = appliedSnap?.id ?? null
  const suggestion: RoutineSuggestion | undefined = appliedSnap ?? (area == null ? suggestions[0] : undefined)

  const items = area ? all.filter((i) => i.channelId === area) : all
  // Approved cards stay in place (green banner + Undo) until you leave the page.
  const pending = items.filter((i) => i.status === 'pending' || approved[i.id])
  const cards = pending.filter((i) => !i.compact)
  const rows = pending.filter((i) => i.compact && !approved[i.id])
  const running = items.filter((i) => i.status === 'running')
  const done = items
    .filter((i) => i.status === 'done' && !approved[i.id] && isToday(i.updatedAt ?? i.createdAt))
    .sort((a, b) => ((b.updatedAt ?? b.createdAt) > (a.updatedAt ?? a.createdAt) ? 1 : -1))
  const open = (item: InboxItem) =>
    void navigate({ to: '/inbox/$itemId', params: { itemId: item.id } })
  const areaName = area ? channelOf(area)?.name : undefined
  const multi = cards.find((c) => (c.proposals?.length ?? 0) > 1)
  const budget = cards.find((c) => c.actions?.some((a) => a.label.toLowerCase().startsWith('change')))

  // Seed the requested design state once the items are loaded.
  const [seeded, setSeeded] = useState(false)
  useEffect(() => {
    if (seeded || isLoading) return
    setSeeded(true)
    if (initial === 'review' && multi) setReviewing(multi.id)
    if (initial === 'amount' && budget) setChanging(budget.id)
  }, [seeded, isLoading, initial, multi, budget])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  function markApproved(item: InboxItem, results: ReviewResult[], amount?: number) {
    if (!results.some((r) => r.decision === 'approved')) return
    setApproved((prev) => ({ ...prev, [item.id]: { results, amount } }))
    setToast(approvedToast(item, results, amount))
  }

  async function approveAll(item: InboxItem) {
    if (!isDecidable(item)) return open(item)
    setBusy(item.id)
    try {
      await runAll(decisionsFor(item, 'approve'), (d) => decide.mutateAsync(d))
      markApproved(item, (item.proposals ?? [{}]).map((_, i) => ({ proposalIndex: i, decision: 'approved' as const })))
    } catch {
      notify('Could not approve — try again')
    } finally {
      setBusy(null)
    }
  }

  async function rejectAll(item: InboxItem) {
    if (!isDecidable(item)) return open(item)
    setBusy(item.id)
    try {
      await runAll(decisionsFor(item, 'reject'), (d) => decide.mutateAsync(d))
      notify(`Rejected · ${item.asker} won’t go ahead`)
    } catch {
      notify('Could not reject — try again')
    } finally {
      setBusy(null)
    }
  }

  async function undo(item: InboxItem) {
    const ids = linkedEntries(item).map((p) => p.proposalId).filter((x): x is string => !!x)
    try {
      await runAll(ids.map((proposalId) => ({ kind: 'undo' as const, proposalId })), (d) => decide.mutateAsync(d))
      setApproved((prev) => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
      setToast(null)
      notify('Approval undone')
    } catch {
      notify('Too late to undo — it already started')
    }
  }

  const reviewingItem = cards.find((c) => c.id === reviewing)
  const changingItem = cards.find((c) => c.id === changing)
  const needsCount =
    pending.filter((i) => !approved[i.id]).length + (suggestion && appliedSuggestion !== suggestion.id ? 1 : 0)
  const asked = changingItem ? amountOf(changingItem) ?? 0 : 0
  const days = changingItem ? daysOf(changingItem) : null

  return (
    <>
      <Topbar
        icon={Inbox}
        title="Inbox"
        meta={`${needsCount} need you`}
        actions={<AreaFilterButton label={areaName ?? 'All areas'} channels={channels} />}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-[24px] py-[20px]">
        <header className="flex flex-col gap-[4px]">
          <h1 className="m-0 font-display text-[22px] font-semibold tracking-[-0.4px] text-ink">Inbox</h1>
          <p className="m-0 text-[13px] text-muted">
            Your agents propose, you decide. Whatever you approve is done exactly as written.
          </p>
        </header>

        {isLoading ? null : isError ? (
          <p role="alert" className="m-0 text-[13px] text-muted">
            Could not load the inbox. Please refresh to try again.
          </p>
        ) : items.length === 0 ? (
          <p className="m-0 text-[13px] text-muted">No items in this area yet.</p>
        ) : (
          <div className="flex w-full gap-[20px]">
            <section aria-label="Needs you" className="flex min-w-0 flex-1 flex-col gap-[10px]">
              <SectionTitle title="Needs you" count={needsCount} />
              {suggestion && (
                <RoutineSuggestionCard
                  suggestion={suggestion}
                  helpers={helpers}
                  applied={appliedSuggestion === suggestion.id}
                  busy={applySuggestion.isPending || dismissSuggestion.isPending}
                  onApply={() =>
                    applySuggestion.mutate(suggestion.id, {
                      onSuccess: () => setAppliedSnap(suggestion),
                      onError: (e) => notify(e instanceof Error ? `Couldn't apply — ${e.message}` : "Couldn't apply the suggestion"),
                    })
                  }
                  onSee={() => void navigate({ to: '/routines' })}
                  onDismiss={() =>
                    dismissSuggestion.mutate(suggestion.id, {
                      onError: () => notify("Couldn't dismiss the suggestion"),
                    })
                  }
                />
              )}
              {cards.length === 0 && rows.length === 0 && !suggestion && (
                <p className="m-0 text-[13px] text-muted">Nothing needs you right now.</p>
              )}
              {cards.map((item) => {
                const a = approved[item.id]
                return (
                  <DecisionCard
                    key={item.id}
                    item={item}
                    channel={channelOf(item.channelId)}
                    onOpen={() => open(item)}
                    onApprove={() => void approveAll(item)}
                    onReject={() => void rejectAll(item)}
                    onReviewOneByOne={() => setReviewing(item.id)}
                    onChangeAmount={() => setChanging(item.id)}
                    approvedText={a ? approvedTextFor(item, a.results, a.amount) : undefined}
                    onUndo={() => void undo(item)}
                    busy={busy === item.id}
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
              <button
                type="button"
                onClick={() => void navigate({ to: '/control-panel/$section', params: { section: 'activity' } })}
                className="self-start text-[12px] text-muted hover:text-ink-2"
              >
                See all activity →
              </button>
            </aside>
          </div>
        )}
      </div>

      {reviewingItem && (
        <InboxReviewDialog
          open
          item={reviewingItem}
          onDecide={async (index, decision) => {
            const entry = reviewingItem.proposals?.[index]
            if (!entry || decision === 'skipped') return
            const ds = decisionsFor(reviewingItem, decision === 'approved' ? 'approve' : 'reject', { only: [entry] })
            await runAll(ds, (d) => decide.mutateAsync(d))
          }}
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
          forecastArea={changingItem.askerArea}
          asked={asked}
          currency={currencyOf(changingItem)}
          options={[Math.round(asked / 3 / 100) * 100, Math.round((asked * 5) / 8 / 100) * 100, asked].filter((v, i, arr) => v > 0 && arr.indexOf(v) === i)}
          defaultAmount={Math.round((asked * 5) / 8 / 100) * 100 || asked}
          days={days}
          onClose={() => setChanging(null)}
          onApprove={async (amount, note) => {
            const item = changingItem
            try {
              await runAll(decisionsFor(item, 'approve', { params: { amount }, note: note || undefined }), (d) => decide.mutateAsync(d))
              markApproved(item, [{ proposalIndex: 0, decision: 'approved' }], amount)
              setChanging(null)
            } catch {
              notify('Could not approve — try again')
            }
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

// ── Item → shared ChatSession (or the decision itself when it has no thread) ──

/** A decision raised outside a chat (flow publish, flow-run approval): no thread to open. */
function DecisionDetail({ item }: { item: InboxItem }) {
  const navigate = useNavigate()
  const decide = useDecide()
  const entry = linkedEntries(item)[0]
  const { data: proposal } = useProposal(entry?.proposalId)
  const [state, setState] = useState<'idle' | 'busy'>('idle')
  const decided = item.status === 'done'

  async function act(kind: 'approve' | 'reject') {
    setState('busy')
    try {
      await runAll(decisionsFor(item, kind), (d) => decide.mutateAsync(d))
      notify(kind === 'approve' ? 'Approved' : 'Rejected')
    } catch {
      notify('Could not save your decision — try again')
    } finally {
      setState('idle')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[24px] py-[20px]">
      <article aria-label={item.title} className="mx-auto flex w-full max-w-[680px] flex-col gap-[12px] rounded-lg bg-surface p-[16px] outline-1 -outline-offset-1 outline-line-strong">
        <CardTop area={item.askerArea} who={item.asker} when={item.askedAgo} />
        <div className="flex w-full flex-col gap-[4px]">
          <h1 className="m-0 text-[14.5px] font-semibold text-ink">{item.title}</h1>
          <p className="m-0 text-[13px] leading-[1.5] whitespace-pre-line text-ink-2">
            {(proposal?.bodyMd ?? item.summary).replace(/\*\*/g, '')}
          </p>
        </div>
        {proposal && (
          <span className="text-[12px] text-muted">
            {proposal.type.replace(/_/g, ' ')} · {proposal.risk} risk · revision {Math.max(1, proposal.revisions.length)}
          </span>
        )}
        {decided ? (
          <div className="flex w-full items-center gap-[8px] rounded-base bg-ok-tint px-[12px] py-[8px] outline-1 -outline-offset-1 outline-ok-line">
            <CircleCheck size={14} aria-hidden className="shrink-0 text-ok" />
            <span className="text-[12.5px] font-medium text-ok">Decided</span>
          </div>
        ) : (
          <div className="flex w-full items-center gap-[6px]">
            <Button height={28} icon={Check} disabled={state === 'busy' || !entry} onClick={() => void act('approve')}>
              Approve
            </Button>
            <Button height={28} variant="secondary" icon={CircleX} disabled={state === 'busy' || !entry} onClick={() => void act('reject')}>
              Reject
            </Button>
            <span className="h-px flex-1" />
            {entry?.flowId && (
              <OpenLink
                title="flow"
                onOpen={() => void navigate({ to: '/flows/$flowId/runs', params: { flowId: entry.flowId! } })}
              />
            )}
          </div>
        )}
      </article>
    </div>
  )
}

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
  // Decisions raised outside a chat (flow publish / flow-run approvals) carry no session.
  if (!item.sessionId) return <DecisionDetail item={item} />
  // Keystone: resolve item → sessionId → render the same ChatSession primitive
  return <ChatSession key={item.sessionId} sessionId={item.sessionId} />
}

// ── InboxRoute ────────────────────────────────────────────────────────────────

/**
 * Main content for /inbox and /inbox/$itemId.
 * The OfficeSidebar and Inset wrapper are provided by OfficeLayout.
 */
export function InboxRoute() {
  const { itemId } = useParams({ strict: false })
  const area = useUIStore((s) => s.areaId)

  return itemId ? <InboxItemView itemId={itemId} /> : <InboxList area={area} />
}
