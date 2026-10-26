import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { CalendarSync, Check, ChevronLeft, ChevronRight, Plus, Users } from 'lucide-react'
import { Button, IconButton } from '../../ui/ds/Button'
import { Topbar } from '../../ui/ds/Frame'
import { notify } from '../../ui/ds/Toaster'
import {
  AGENTS,
  BANNERS,
  LIST_GROUPS,
  WEEK_LABEL,
  routineById,
  weekLanes,
  type RoutineDrawerState,
  type RoutinesState,
  type RoutinesView,
} from './data'
import { NewRoutineDrawer, RoutineDrawer, RunOutputDrawer } from './Drawers'
import { EmptyState } from './EmptyState'
import { ListView, SuggestionCard } from './ListView'
import { AppliedToast, DeleteConfirm, FailurePopover, RowMenu, type Anchor } from './Overlays'
import { Field, SecondaryButton, Segmented } from './ui'
import { ChiefBanner, WeekView } from './WeekView'

const VIEWS = ['Week', 'List'] as const

/** Derive a week-range label relative to the base label. */
function weekLabel(offset: number): string {
  if (offset === 0) return WEEK_LABEL
  // Parse "Oct 19 – 25" style: advance by offset weeks.
  const base = new Date('2024-10-19') // anchor date for WEEK_LABEL
  const start = new Date(base)
  start.setDate(base.getDate() + offset * 7)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${end.getDate()}`
}

const AGENT_IDS = Object.keys(AGENTS) as string[]

function RoutinesTopbar({
  view,
  onView,
  empty,
  onNew,
  weekOffset,
  onPrevWeek,
  onToday,
  onNextWeek,
  agentFilter,
  onAgentFilter,
}: {
  view: RoutinesView
  onView: (v: RoutinesView) => void
  empty: boolean
  onNew: () => void
  weekOffset: number
  onPrevWeek: () => void
  onToday: () => void
  onNextWeek: () => void
  agentFilter: string | null
  onAgentFilter: (id: string | null) => void
}) {
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const agentBtnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close agent menu on outside click
  useEffect(() => {
    if (!agentMenuOpen) return
    function handler(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        agentBtnRef.current &&
        !agentBtnRef.current.contains(e.target as Node)
      ) {
        setAgentMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [agentMenuOpen])

  const filterLabel = agentFilter ? (AGENTS[agentFilter]?.name ?? 'All agents') : 'All agents'

  return (
    <Topbar
      icon={CalendarSync}
      title="Routines"
      meta={weekLabel(weekOffset)}
      actions={
        <div className="flex items-center gap-[8px]">
          {!empty && (
            <div className="flex items-center gap-[2px]">
              <IconButton icon={ChevronLeft} aria-label="Previous week" onClick={onPrevWeek} />
              <SecondaryButton height={28} fontSize={12} onClick={onToday}>
                Today
              </SecondaryButton>
              <IconButton icon={ChevronRight} aria-label="Next week" onClick={onNextWeek} />
            </div>
          )}
          <div className="relative">
            <button
              ref={agentBtnRef}
              type="button"
              aria-label="Filter by agent"
              aria-haspopup="listbox"
              aria-expanded={agentMenuOpen}
              className="w-[150px] text-left"
              onClick={() => setAgentMenuOpen((o) => !o)}
            >
              <Field icon={Users} value={filterLabel} chevron />
            </button>
            {agentMenuOpen && (
              <div
                ref={menuRef}
                role="listbox"
                aria-label="Filter by agent"
                className="absolute left-0 top-full z-50 mt-[4px] w-[180px] rounded-lg bg-surface p-[4px] shadow-[0_8px_20px_#0C0A0914] outline-1 -outline-offset-1 outline-line-strong"
              >
                {[{ id: null, name: 'All agents' }, ...AGENT_IDS.map((id) => ({ id, name: AGENTS[id].name }))].map((opt) => {
                  const sel = agentFilter === opt.id
                  return (
                    <button
                      key={opt.id ?? '__all__'}
                      type="button"
                      role="option"
                      aria-selected={sel}
                      onClick={() => { onAgentFilter(opt.id); setAgentMenuOpen(false) }}
                      className={`flex w-full items-center gap-[8px] rounded-btn px-[10px] py-[7px] text-left text-[12.5px] hover:bg-hover ${sel ? 'font-medium text-ink' : 'text-ink-2'}`}
                    >
                      {sel && <Check size={12} aria-hidden className="shrink-0" />}
                      <span className={sel ? '' : 'ml-[20px]'}>{opt.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <Segmented
            items={VIEWS}
            value={view === 'week' ? 'Week' : 'List'}
            onChange={(v) => onView(v === 'Week' ? 'week' : 'list')}
            label="View"
          />
          <Button height={28} icon={Plus} onClick={onNew}>
            New routine
          </Button>
        </div>
      }
    />
  )
}

const anchorOf = (el: Element): Anchor => {
  const r = el.getBoundingClientRect()
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
}

/** Navigation for the routines board — differs between office and chat mounts. */
interface RoutinesNav {
  openRoutine: (id: string, state?: RoutineDrawerState) => void
  closeDrawer: () => void
}

interface BoardProps {
  /** Route-specific navigation (office vs. chat). */
  nav: RoutinesNav
  /** Drawer for this routine (detail route). */
  routineId?: string
  drawerState?: RoutineDrawerState
}

/**
 * Routines board: Week (I5rrK) / List (VUmu8) + every interactive state.
 *  - `?view=week|list`
 *  - `?state=empty|failed|applied|menu|delete|new|clash`
 *  - `…/routines/$routineId?state=running|paused|output|reassign` opens the routine drawer over the list.
 *
 * Mounted in both Office (`/office/routines`) and Chat (`/chat/$channelId/routines`);
 * the `nav` prop carries the mode-specific routing.
 */
function RoutinesBoard({ nav, routineId, drawerState }: BoardProps) {
  const search = useSearch({ strict: false }) as { view?: string; state?: string }
  const initialState = (search.state as RoutinesState | undefined) ?? null

  const defaultView: RoutinesView =
    routineId || initialState === 'menu' || initialState === 'delete' || initialState === 'new' || initialState === 'clash'
      ? 'list'
      : 'week'
  const [view, setView] = useState<RoutinesView>((search.view as RoutinesView) || defaultView)
  const [empty, setEmpty] = useState(initialState === 'empty')
  const [applied, setApplied] = useState(initialState === 'applied')
  const [toast, setToast] = useState(initialState === 'applied')
  const [suggestion, setSuggestion] = useState(initialState !== 'applied')
  const [failed] = useState(initialState === 'failed')
  const [failAnchor, setFailAnchor] = useState<Anchor | null>(null)
  const [menu, setMenu] = useState<{ id: string; anchor: Anchor } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(initialState === 'delete' ? 'morning-brief' : null)
  const [creating, setCreating] = useState<null | 'new' | 'clash'>(
    initialState === 'new' ? 'new' : initialState === 'clash' ? 'clash' : null,
  )
  const [weekOffset, setWeekOffset] = useState(0)
  const [agentFilter, setAgentFilter] = useState<string | null>(null)
  const drawer: RoutineDrawerState = drawerState ?? 'detail'

  const rootRef = useRef<HTMLDivElement>(null)

  // Screenshot-able states that need an on-screen anchor.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (initialState === 'menu') {
      const btn = root.querySelector('[aria-label="More actions for Morning brief"]')
      if (btn) setMenu({ id: 'morning-brief', anchor: anchorOf(btn) })
    }
    if (initialState === 'failed') {
      const chip = root.querySelector('[data-failed-run]')
      if (chip) setFailAnchor(anchorOf(chip))
    }
  }, [initialState])

  const open = nav.openRoutine
  const closeDrawer = nav.closeDrawer

  const routine = routineId ? routineById(routineId) : null
  const banner = failed ? BANNERS.failed : applied ? BANNERS.applied : BANNERS.default

  return (
    <div ref={rootRef} className="relative flex min-h-0 w-full flex-1 flex-col">
      <RoutinesTopbar
        view={view}
        onView={setView}
        empty={empty}
        onNew={() => setCreating('new')}
        weekOffset={weekOffset}
        onPrevWeek={() => setWeekOffset((o) => o - 1)}
        onToday={() => setWeekOffset(0)}
        onNextWeek={() => setWeekOffset((o) => o + 1)}
        agentFilter={agentFilter}
        onAgentFilter={setAgentFilter}
      />
      {empty ? (
        <EmptyState onScratch={() => setCreating('new')} onSetUp={() => setEmpty(false)} />
      ) : (
        <div className="flex min-h-0 w-full flex-1 flex-col gap-[16px] overflow-y-auto px-[24px] py-[18px]">
          {view === 'week' ? (
            <>
              <ChiefBanner banner={banner} onReview={() => setView('list')} />
              <WeekView
                lanes={weekLanes(applied)}
                failed={failed}
                onOpen={(id) => open(id)}
                onFailed={() => {
                  const chip = rootRef.current?.querySelector('[data-failed-run]')
                  if (chip) setFailAnchor(anchorOf(chip))
                }}
              />
            </>
          ) : (
            <>
              {suggestion && (
                <SuggestionCard
                  onApply={() => {
                    setApplied(true)
                    setSuggestion(false)
                    setToast(true)
                    setView('week')
                  }}
                  onDismiss={() => setSuggestion(false)}
                />
              )}
              <ListView
                groups={LIST_GROUPS}
                compact={!!routine || !!creating}
                firstNameOverride={routine && routineId !== 'morning-brief' ? routine.name : drawer === 'output' ? 'Morning brief · Fri 23' : undefined}
                menuFor={menu?.id}
                onOpen={(id) => open(id)}
                onMenu={(id, el) => setMenu(menu?.id === id ? null : { id, anchor: anchorOf(el) })}
              />
            </>
          )}
        </div>
      )}

      {toast && <AppliedToast onClose={() => setToast(false)} />}

      {failAnchor && (
        <FailurePopover anchor={failAnchor} onClose={() => setFailAnchor(null)} onReconnect={() => setFailAnchor(null)} onRetry={() => setFailAnchor(null)} />
      )}

      {menu && (
        <RowMenu
          anchor={menu.anchor}
          title={routineById(menu.id).name}
          onClose={() => setMenu(null)}
          onEdit={() => open(menu.id)}
          onRun={() => open(menu.id, 'running')}
          onSkip={() => {
            setMenu(null)
            notify('Skipped next run')
          }}
          onDelete={() => setDeleting(menu.id)}
        />
      )}

      {deleting && (
        <DeleteConfirm
          name={routineById(deleting).name}
          onClose={() => setDeleting(null)}
          onPause={() => {
            const id = deleting
            setDeleting(null)
            open(id, 'paused')
          }}
          onDelete={() => setDeleting(null)}
        />
      )}

      {creating && <NewRoutineDrawer clash={creating === 'clash'} onClose={() => setCreating(null)} onCreate={() => setCreating(null)} />}

      {routine &&
        (drawer === 'output' ? (
          <RunOutputDrawer onClose={closeDrawer} onOpenRoutine={() => open(routine.id)} />
        ) : (
          <RoutineDrawer
            routine={routine}
            state={drawer}
            onClose={closeDrawer}
            onRunNow={() => open(routine.id, 'running')}
            onPause={() => open(routine.id, 'paused')}
            onResume={() => open(routine.id)}
            onStop={() => open(routine.id)}
            onSave={closeDrawer}
            onOpenRun={() => open(routine.id, 'output')}
          />
        ))}
    </div>
  )
}

/** Routes to the mode-neutral routines URLs (`/routines…`). */
function useRoutinesNav(): RoutinesNav {
  const navigate = useNavigate()
  return {
    openRoutine: (id, state) =>
      void navigate({
        to: '/routines/$routineId',
        params: { routineId: id },
        search: state && state !== 'detail' ? { state } : {},
      } as never),
    closeDrawer: () => void navigate({ to: '/routines', search: { view: 'list' } } as never),
  }
}

const drawerStateFrom = (state?: string): RoutineDrawerState =>
  (['running', 'paused', 'output', 'reassign'] as const).find((s) => s === state) ?? 'detail'

/** Routines — pen diQBZ (Empty) / I5rrK (Week) / VUmu8 (List) + states. */
export function RoutinesRoute() {
  const nav = useRoutinesNav()
  return <RoutinesBoard nav={nav} />
}

/** Routines · Detail — pen xuAoe (+ a2xdN, oTi8l, SHLKI, H4Cdpf, rljUL). */
export function RoutineDetailRoute() {
  const { routineId } = useParams({ strict: false }) as { routineId: string }
  const { state } = useSearch({ strict: false }) as { state?: string }
  const nav = useRoutinesNav()
  return <RoutinesBoard key="board" nav={nav} routineId={routineId} drawerState={drawerStateFrom(state)} />
}
