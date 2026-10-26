import { useState } from 'react'
import { ArrowRight, Check, Ellipsis, Repeat } from 'lucide-react'
import { Button, IconButton } from '../../ui/ds/Button'
import { Mascot } from '../../ui/ds/Mascot'
import { AGENTS, LIST_MORE, SUGGESTION, colorOf, type RoutineGroup, type RoutineRow, type RunResult } from './data'
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

function Runs({ runs }: { runs: RunResult[] }) {
  const ok = runs.filter((r) => r === 'ok').length
  return (
    <div className="flex w-[80px] shrink-0 items-end gap-[2px]" aria-label={`${ok} of last ${runs.length} runs succeeded`} role="img">
      {runs.map((r, i) => (
        <span
          key={i}
          className="w-[6px] rounded-[1.5px]"
          style={{ height: r === 'none' ? 5 : 14, background: RUN_COLOR[r] }}
        />
      ))}
    </div>
  )
}

const COLS = { when: 'w-[170px]', next: 'w-[110px]', by: 'w-[90px]' }

function Row({
  row,
  nameOverride,
  compact,
  onOpen,
  onMenu,
  menuOpen,
}: {
  row: RoutineRow
  nameOverride?: string
  compact?: boolean
  onOpen: (id: string) => void
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
      <Runs runs={row.runs} />
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
  onMenu,
}: {
  groups: RoutineGroup[]
  compact?: boolean
  firstNameOverride?: string
  menuFor?: string | null
  onOpen: (id: string) => void
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
