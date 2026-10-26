import { useState } from 'react'
import { ArrowRight, Check, CornerDownLeft, Ellipsis, Repeat } from 'lucide-react'
import { Button, IconButton } from '../../ui/ds/Button'
import { Mascot } from '../../ui/ds/Mascot'
import {
  AGENTS,
  LIST_MORE,
  RUN_STATUS,
  SUGGESTION,
  colorOf,
  runDetail,
  type RoutineGroup,
  type RoutineRow,
  type RunDetail,
  type RunResult,
} from './data'
import { Switch, YouAvatar } from './ui'

/** pen `Chief Suggestion` (CqvAX): #EEF2FF · r14 · p16 · gap12. */
export function SuggestionCard({ onApply, onDismiss }: { onApply: () => void; onDismiss: () => void }) {
  return (
    <section
      aria-label="Chief suggestion"
      className="flex w-full shrink-0 flex-col gap-[12px] rounded-[14px] bg-[#EEF2FF] p-[16px] outline-1 -outline-offset-1 outline-[#C7D2FE]"
    >
      <div className="flex w-full items-center gap-[10px]">
        <Mascot size={26} radius={7} area="brand" />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[14px] font-semibold text-ink">{SUGGESTION.title}</span>
          <span className="text-[12.5px] text-[#4338CA]">{SUGGESTION.desc}</span>
        </div>
      </div>
      <div className="flex w-full gap-[10px]">
        {SUGGESTION.moves.map((m) => (
          <div key={m.name} className="flex min-w-0 flex-1 items-center gap-[8px] rounded-md bg-surface px-[10px] py-[8px]">
            <span className="h-[16px] w-[3px] shrink-0 rounded-[2px]" style={{ background: colorOf(m.agentId) }} />
            <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
              <span className="truncate text-[12.5px] font-medium text-ink">{m.name}</span>
              <span className="text-[11.5px] text-muted">{m.area}</span>
            </div>
            <span className="text-[12px] text-faint">{m.from}</span>
            <ArrowRight size={12} aria-hidden className="text-faint" />
            <span className="text-[12px] font-semibold text-[#4338CA]">{m.to}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-[8px]">
        <Button height={28} icon={Check} onClick={onApply}>
          Apply both
        </Button>
        <Button variant="secondary" height={28} onClick={onDismiss}>
          Not now
        </Button>
        <span className="text-[12px] text-muted">{SUGGESTION.note}</span>
      </div>
    </section>
  )
}

const RUN_COLOR: Record<RunResult, string> = { ok: '#22C55E', skip: '#A8A29E', fail: '#EF4444', none: '#E7E5E4' }
const RUN_DOT: Partial<Record<RunResult, string>> = { ok: '#22C55E', fail: '#EF4444', skip: '#A8A29E' }

/** Dark tooltip pinned above a hovered run bar (fixed, so it escapes the table's clipping). */
function RunTooltip({ detail: d, anchor }: { detail: RunDetail; anchor: DOMRect }) {
  const W = 240
  const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - W / 2, window.innerWidth - W - 8))
  const below = anchor.top < 180
  const style = below
    ? { top: anchor.bottom + 8, left }
    : { top: anchor.top - 8, left, transform: 'translateY(-100%)' }
  return (
    <div
      role="tooltip"
      style={{ ...style, width: W }}
      className="pointer-events-none fixed z-[60] flex flex-col gap-[6px] rounded-[10px] bg-[#1C1917] p-[12px] text-[12.5px] text-[#D6D3D1] shadow-[0_12px_32px_#0C0A0940]"
    >
      <div className="flex items-center gap-[7px]">
        <span className="size-[7px] shrink-0 rounded-full" style={{ background: RUN_DOT[d.result] }} />
        <span className="text-[13px] font-semibold text-white">{d.status}</span>
        <span className="ml-auto text-[11.5px] text-[#A8A29E]">{d.whenShort}</span>
      </div>
      <div className="flex justify-between">
        <span>Ran for</span>
        <span className="font-medium text-white">{d.duration}</span>
      </div>
      <div className="flex justify-between">
        <span>Agent</span>
        <span className="font-medium text-white">{AGENTS[d.agentId].name}</span>
      </div>
      <p className={`m-0 border-t border-white/15 pt-[8px] leading-[1.4] ${d.result === 'fail' ? 'text-[#FCA5A5]' : 'text-[#E7E5E4]'}`}>
        {d.error ?? d.outcome}
      </p>
      <div className="flex items-center gap-[5px] border-t border-white/15 pt-[8px] text-[11px] text-[#A8A29E]">
        <CornerDownLeft size={12} aria-hidden />
        Click to open full run &amp; logs
      </div>
    </div>
  )
}

function Runs({ row, onOpenRun }: { row: RoutineRow; onOpenRun?: (row: RoutineRow, index: number) => void }) {
  const [hover, setHover] = useState<{ i: number; anchor: DOMRect } | null>(null)
  const ok = row.runs.filter((r) => r === 'ok').length
  return (
    <div
      className="relative flex w-[80px] shrink-0 items-end gap-[2px]"
      role="group"
      aria-label={`Last ${row.runs.length} runs — ${ok} succeeded`}
    >
      {row.runs.map((r, i) =>
        r === 'none' ? (
          <span key={i} className="w-[6px] rounded-[1.5px]" style={{ height: 5, background: RUN_COLOR.none }} />
        ) : (
          <button
            key={i}
            type="button"
            aria-label={`${row.name} — run ${i + 1} of ${row.runs.length}: ${RUN_STATUS[r]}`}
            onMouseEnter={(e) => setHover({ i, anchor: e.currentTarget.getBoundingClientRect() })}
            onMouseLeave={() => setHover((h) => (h?.i === i ? null : h))}
            onFocus={(e) => setHover({ i, anchor: e.currentTarget.getBoundingClientRect() })}
            onBlur={() => setHover((h) => (h?.i === i ? null : h))}
            onClick={() => onOpenRun?.(row, i)}
            className="w-[6px] origin-bottom rounded-[1.5px] outline-offset-2 transition-transform hover:scale-y-[1.14] focus-visible:outline-2 focus-visible:outline-ink"
            style={{ height: 14, background: RUN_COLOR[r] }}
          />
        ),
      )}
      {hover && <RunTooltip detail={runDetail(row, hover.i)} anchor={hover.anchor} />}
    </div>
  )
}

const COLS = { when: 'w-[170px]', next: 'w-[110px]', by: 'w-[90px]' }

function Row({
  row,
  nameOverride,
  compact,
  onOpen,
  onOpenRun,
  onMenu,
  menuOpen,
}: {
  row: RoutineRow
  nameOverride?: string
  compact?: boolean
  onOpen: (id: string) => void
  onOpenRun?: (row: RoutineRow, index: number) => void
  onMenu?: (id: string, el: HTMLElement) => void
  menuOpen?: boolean
}) {
  const [on, setOn] = useState(!row.paused)
  return (
    <div
      className={`flex w-full items-center gap-[14px] shadow-[inset_0_-1px_0_var(--color-line)] px-[14px] py-[10px] ${row.paused ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        onClick={() => onOpen(row.id)}
        className="min-w-0 flex-1 truncate text-left text-[13.5px] font-medium text-ink hover:underline"
      >
        {nameOverride ?? row.name}
      </button>
      <div className={`flex ${COLS.when} shrink-0 items-center gap-[6px]`}>
        <Repeat size={13} aria-hidden className="text-muted" />
        <span className="text-[12.5px] whitespace-nowrap text-ink-2">{row.when}</span>
      </div>
      <span className={`${COLS.next} shrink-0 text-[12.5px] ${row.paused ? 'text-warn' : 'text-ink-2'}`}>
        {row.next}
      </span>
      <Runs row={row} onOpenRun={onOpenRun} />
      <div className={`flex ${COLS.by} shrink-0 items-center gap-[5px]`}>
        {row.by === 'chief' ? <Mascot size={16} radius={4} area="brand" /> : <YouAvatar />}
        <span className="text-[12px] text-muted">{row.by === 'chief' ? 'Chief' : 'You'}</span>
      </div>
      <Switch on={on} onChange={setOn} label={`${row.name} on`} />
      {!compact && (
        <IconButton
          icon={Ellipsis}
          aria-label={`More actions for ${row.name}`}
          aria-haspopup="menu"
          aria-expanded={!!menuOpen}
          onClick={(e) => onMenu?.(row.id, e.currentTarget)}
        />
      )}
    </div>
  )
}

/** pen `Routines` table (rProi). `compact` = the backdrop variant behind drawers (no ⋯ column). */
export function ListView({
  groups,
  compact = false,
  firstNameOverride,
  menuFor,
  onOpen,
  onOpenRun,
  onMenu,
}: {
  groups: RoutineGroup[]
  compact?: boolean
  firstNameOverride?: string
  menuFor?: string | null
  onOpen: (id: string) => void
  onOpenRun?: (row: RoutineRow, index: number) => void
  onMenu?: (id: string, el: HTMLElement) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const head = 'shrink-0 text-[10.5px] font-medium tracking-[0.8px] text-faint'
  return (
    <div
      role="region"
      aria-label="Routines"
      className="flex w-full shrink-0 flex-col overflow-hidden rounded-lg outline-1 -outline-offset-1 outline-line-strong"
    >
      <div className="flex w-full gap-[14px] shadow-[inset_0_-1px_0_var(--color-line)] bg-soft px-[14px] py-[8px]">
        <span className={`${head} min-w-0 flex-1`}>
          ROUTINE
        </span>
        <span className={`${head} ${COLS.when}`}>
          WHEN
        </span>
        <span className={`${head} ${COLS.next}`}>
          NEXT
        </span>
        <span className={`${head} w-[80px]`}>
          LAST 8
        </span>
        <span className={`${head} ${COLS.by}`}>
          BY
        </span>
        <span className={`${head} w-[28px]`} />
      </div>
      {groups.map((g, gi) => {
        const agent = AGENTS[g.agentId]
        return (
          <div key={g.agentId} className="contents">
            <div className="flex w-full items-center gap-[8px] shadow-[inset_0_-1px_0_var(--color-line)] bg-soft px-[14px] py-[8px]">
              <Mascot size={20} radius={6} area={agent.area} />
              <span className="text-[12.5px] font-semibold text-ink">{agent.name}</span>
              <span className="text-[12px] text-faint">{g.count} routines</span>
            </div>
            {g.rows.map((r, ri) => (
              <Row
                key={r.id}
                row={r}
                nameOverride={gi === 0 && ri === 0 ? firstNameOverride : undefined}
                compact={compact}
                onOpen={onOpen}
                onOpenRun={onOpenRun}
                onMenu={onMenu}
                menuOpen={menuFor === r.id}
              />
            ))}
          </div>
        )
      })}
      <div className="flex w-full items-center gap-[8px] px-[14px] py-[10px]">
        <span className="min-w-0 flex-1 text-[12.5px] text-muted">
          {expanded ? '' : LIST_MORE.text}
        </span>
        {!expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-[12.5px] font-medium text-link hover:underline"
          >
            {LIST_MORE.link}
          </button>
        )}
        {expanded && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-[12.5px] font-medium text-link hover:underline"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  )
}
