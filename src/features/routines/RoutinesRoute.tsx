import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { CalendarSync, Check, ChevronLeft, ChevronRight, Plus, Users } from 'lucide-react'
import { Button, IconButton } from '../../ui/ds/Button'
import { Topbar } from '../../ui/ds/Frame'
import { notify } from '../../ui/ds/Toaster'
import { useCommands } from '../../app/CommandsProvider'
import {
  useApplyRoutineSuggestion,
  useCancelJob,
  useCreateRoutine,
  useDeleteRoutine,
  useDismissRoutineSuggestion,
  useResendRoutineRun,
  useRoutine,
  useRoutineRun,
  useRoutineRunFeedback,
  useRoutineSchedule,
  useRoutineSuggestions,
  useRoutines,
  useSkipRoutineNext,
  useUpdateRoutine,
} from '../../app/queries'
import type { Routine, RoutineSuggestion } from '../../core/domain/types'
import { routinesToGroups, routineToDetail } from './routineAdapters'
import {
  TEMPLATES,
  browserTimeZone,
  buildLanes,
  fmtDayDate,
  fmtDayTime,
  fmtShort,
  runDetailFromApi,
  runSummaryDetail,
  weekRange,
  type Banner,
  type RoutineDrawerState,
  type RoutinesState,
  type RoutinesView,
  type WeekChip,
} from './data'
import { NewRoutineDrawer, RoutineDrawer, RunDetailDrawer, RunOutputDrawer, type NewRoutineData, type RoutineSavePatch } from './Drawers'
import { EmptyState } from './EmptyState'
import { ListView, SuggestionCard } from './ListView'
import { AppliedToast, DeleteConfirm, FailurePopover, RowMenu, type Anchor, type FailureInfo } from './Overlays'
import { Field, SecondaryButton, Segmented } from './ui'
import { ChiefBanner, WeekView } from './WeekView'
import { pickHelperForArea, useHelperLookup } from './useHelperLookup'

const VIEWS = ['Week', 'List'] as const

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? `${fallback}: ${e.message}` : fallback)

function RoutinesTopbar({
  view,
  onView,
  empty,
  onNew,
  weekLabel,
  onPrevWeek,
  onToday,
  onNextWeek,
  agentFilter,
  onAgentFilter,
  agents,
}: {
  view: RoutinesView
  onView: (v: RoutinesView) => void
  empty: boolean
  onNew: () => void
  weekLabel: string
  onPrevWeek: () => void
  onToday: () => void
  onNextWeek: () => void
  agentFilter: string | null
  onAgentFilter: (id: string | null) => void
  agents: { id: string; name: string }[]
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

  const filterLabel = agentFilter ? (agents.find((a) => a.id === agentFilter)?.name ?? 'All agents') : 'All agents'

  return (
    <Topbar
      icon={CalendarSync}
      title="Routines"
      meta={weekLabel}
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
                {[{ id: null as string | null, name: 'All agents' }, ...agents].map((opt) => {
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

/** Navigation for the routines board. */
interface RoutinesNav {
  openRoutine: (id: string, state?: RoutineDrawerState, runId?: string) => void
  closeDrawer: () => void
}

interface BoardProps {
  nav: RoutinesNav
  /** Drawer for this routine (detail route). */
  routineId?: string
  drawerState?: RoutineDrawerState
  /** Run shown by the running / output drawer states (`?run=`). */
  runId?: string
}

/** Builds the Chief banner from real failures, suggestions and the next run. */
function bannerFor(
  routines: Routine[],
  helperCount: number,
  failures: WeekChip[],
  suggestions: RoutineSuggestion[],
  applied: boolean,
  nameOf: (routineId: string) => string,
  errorOf: (chip: WeekChip) => string | null,
): Banner {
  const active = routines.filter((r) => r.enabled && !r.paused && r.nextAt)
  const next = [...active].sort((a, b) => (a.nextAt ?? '').localeCompare(b.nextAt ?? ''))[0]
  const nextText = next ? `Next: ${next.name}, ${fmtDayTime(next.nextAt)}` : 'Nothing scheduled'
  if (failures.length > 0) {
    const f = failures[failures.length - 1]
    const why = errorOf(f)
    return {
      tone: 'bad',
      title: `${failures.length} routine run${failures.length === 1 ? '' : 's'} failed this week`,
      desc: [nameOf(f.routineId), fmtShort(f.at), why].filter(Boolean).join(' · '),
      review: suggestions.length > 0,
    }
  }
  if (applied && suggestions.length === 0) {
    return { tone: 'ok', title: 'Schedule updated — no clashes left', desc: nextText, review: false }
  }
  const sug = suggestions.length
  return {
    tone: 'info',
    title: `Chief keeps ${routines.length} routine${routines.length === 1 ? '' : 's'} running across ${helperCount} agent${helperCount === 1 ? '' : 's'}`,
    desc: sug ? `${nextText} · ${sug} suggestion${sug === 1 ? '' : 's'} from Chief` : nextText,
    review: sug > 0,
  }
}

/**
 * Routines board: Week (I5rrK) / List (VUmu8) + every interactive state.
 *  - `?view=week|list`
 *  - `?state=empty|new|clash` (+ `/routines/$id?state=delete|running|paused|output|reassign&run=…`)
 */
function RoutinesBoard({ nav, routineId, drawerState, runId }: BoardProps) {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { view?: string; state?: string }
  const initialState = (search.state as RoutinesState | undefined) ?? null
  const { helpers, info } = useHelperLookup()

  const defaultView: RoutinesView =
    routineId || initialState === 'menu' || initialState === 'delete' || initialState === 'new' || initialState === 'clash'
      ? 'list'
      : 'week'
  const [view, setView] = useState<RoutinesView>((search.view as RoutinesView) || defaultView)
  const [forceEmpty, setForceEmpty] = useState(initialState === 'empty')
  const [applied, setApplied] = useState(false)
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null)
  const [failure, setFailure] = useState<{ anchor: Anchor; chip: WeekChip } | null>(null)
  const [menu, setMenu] = useState<{ id: string; anchor: Anchor } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(initialState === 'delete' && routineId ? routineId : null)
  const [creating, setCreating] = useState(initialState === 'new' || initialState === 'clash')
  const [weekOffset, setWeekOffset] = useState(0)
  const [agentFilter, setAgentFilter] = useState<string | null>(null)
  const [runOpen, setRunOpen] = useState<{ routineId: string; runId: string; name: string } | null>(null)
  const [settingUp, setSettingUp] = useState(false)
  const drawer: RoutineDrawerState = drawerState ?? 'detail'

  const rootRef = useRef<HTMLDivElement>(null)
  const open = nav.openRoutine
  const closeDrawer = nav.closeDrawer

  // ── Live data + mutations (port-swappable: mock or HTTP) ──────────────────────
  const commands = useCommands()
  const createRoutine = useCreateRoutine()
  const updateRoutine = useUpdateRoutine()
  const deleteRoutine = useDeleteRoutine()
  const skipRoutineNext = useSkipRoutineNext()
  const cancelJob = useCancelJob()
  const feedback = useRoutineRunFeedback()
  const resend = useResendRoutineRun()
  const applySuggestion = useApplyRoutineSuggestion()
  const dismissSuggestion = useDismissRoutineSuggestion()

  const { data: routinesData = [], isLoading, isError } = useRoutines()
  const { data: suggestions = [] } = useRoutineSuggestions()
  const range = useMemo(() => weekRange(weekOffset), [weekOffset])
  const { data: schedule } = useRoutineSchedule(range.start.toISOString(), range.end.toISOString())

  const filtered = agentFilter ? routinesData.filter((r) => r.helperId === agentFilter) : routinesData
  const groups = routinesToGroups(filtered)
  const routineCount = (helperId: string) => routinesData.filter((r) => r.helperId === helperId).length
  const routineNameById = (id: string) => routinesData.find((r) => r.id === id)?.name ?? 'Routine'

  const scheduleItems = (schedule?.items ?? []).filter((i) => !agentFilter || i.helperId === agentFilter)
  const lanes = buildLanes(scheduleItems, range, routineCount)
  const failedChips = lanes.flatMap((l) => l.chips.filter((c) => c.failed))

  // Agents that own routines (topbar filter).
  const agents = [...new Set(routinesData.map((r) => r.helperId))].map((id) => ({ id, name: info(id).name }))

  // Fetch the detail-pane routine from the repo.
  const { data: rawRoutine } = useRoutine(routineId ?? '')
  const routine = routineId && rawRoutine ? routineToDetail(rawRoutine, info(rawRoutine.helperId).name) : null

  // Run shown in the running / output states: `?run=` or the latest run.
  const activeRunId = runId ?? routine?.latestRunId ?? null
  const { data: activeRun, isLoading: activeRunLoading } = useRoutineRun(
    routine && (drawer === 'running' || drawer === 'output') ? routine.id : null,
    activeRunId,
  )
  const { data: openRunDetail } = useRoutineRun(runOpen?.routineId ?? null, runOpen?.runId ?? null)

  // Show empty state when: forced by ?state=empty OR the repo returned no routines.
  const showEmpty = forceEmpty || (!isLoading && !isError && routinesData.length === 0)

  const errorOfChip = (chip: WeekChip) => {
    const r = routinesData.find((x) => x.id === chip.routineId)
    return r?.runs?.find((x) => x.id === chip.runId)?.error ?? null
  }
  const banner = bannerFor(routinesData, new Set(routinesData.map((r) => r.helperId)).size, failedChips, suggestions, applied, routineNameById, errorOfChip)
  const setByYou = routinesData.filter((r) => !r.managedByChief).length

  // ── Run now ─────────────────────────────────────────────────────────────────
  const runNow = async (id: string) => {
    try {
      const res = await commands.runRoutineNow(id)
      open(id, 'running', res.runId)
    } catch (e) {
      notify(errMsg(e, 'Couldn’t start the run'))
    }
  }

  // ── Create / save / delete / skip handlers ────────────────────────────────────
  const handleCreate = (data: NewRoutineData) => {
    createRoutine.mutate(
      {
        helperId: data.helperId,
        name: data.name,
        instructions: data.prompt,
        freq: data.freq,
        at: data.at,
        days: data.days,
        monthly: data.monthly,
        timezone: data.timezone,
        allowChiefShift: data.allowChiefShift,
      },
      {
        onSuccess: () => {
          notify('Routine created')
          setCreating(false)
          setForceEmpty(false)
        },
        onError: (e) => notify(errMsg(e, 'Couldn’t create the routine')),
      },
    )
  }

  const handleSetUp = async (ids: string[]) => {
    const picked = TEMPLATES.filter((t) => ids.includes(t.id))
    if (helpers.length === 0) {
      notify('Add a helper first — routines need someone to run them')
      return
    }
    setSettingUp(true)
    const timezone = browserTimeZone()
    let ok = 0
    for (const t of picked) {
      const h = pickHelperForArea(helpers, t.area)
      if (!h) continue
      try {
        await createRoutine.mutateAsync({
          helperId: h.id,
          name: t.name,
          instructions: t.instructions,
          freq: t.freq,
          at: t.at,
          days: t.days ?? [],
          timezone,
        })
        ok += 1
      } catch {
        // keep going; reported below
      }
    }
    setSettingUp(false)
    setForceEmpty(false)
    notify(ok === picked.length ? `${ok} routines set up` : `${ok} of ${picked.length} routines set up`)
  }

  const handleSave = (patch: RoutineSavePatch) => {
    if (!routine) return
    updateRoutine.mutate(
      { id: routine.id, input: patch },
      {
        onSuccess: () => {
          notify('Routine updated')
          closeDrawer()
        },
        onError: (e) => notify(errMsg(e, 'Couldn’t save the routine')),
      },
    )
  }

  const setPaused = (id: string, paused: boolean, then?: () => void) => {
    updateRoutine.mutate(
      { id, input: { paused } },
      {
        onSuccess: () => {
          notify(paused ? 'Routine paused' : 'Routine resumed')
          then?.()
        },
        onError: (e) => notify(errMsg(e, paused ? 'Couldn’t pause' : 'Couldn’t resume')),
      },
    )
  }

  const handleDelete = (id: string) => {
    deleteRoutine.mutate(id, {
      onSuccess: () => {
        notify('Routine deleted')
        if (routineId === id) closeDrawer()
      },
      onError: (e) => notify(errMsg(e, 'Couldn’t delete the routine')),
    })
    setDeleting(null)
  }

  const handleSkip = (id: string) => {
    skipRoutineNext.mutate(id, {
      onSuccess: (res) => notify(res.nextAt ? `Skipped — next run ${fmtDayTime(res.nextAt)}` : 'Skipped next run'),
      onError: (e) => notify(errMsg(e, 'Couldn’t skip')),
    })
  }

  const handleApply = (s: RoutineSuggestion) => {
    applySuggestion.mutate(s.id, {
      onSuccess: () => {
        setApplied(true)
        setToast({
          title: s.kind === 'failing' ? 'Routine paused' : `${s.moves.length} routine${s.moves.length === 1 ? '' : 's'} moved`,
          body: s.moves.map((m) => `${m.name} → ${m.to}`).join(' · '),
        })
        setView('week')
      },
      onError: (e) => notify(errMsg(e, 'Couldn’t apply the suggestion')),
    })
  }

  const avgTokens = (helperId: string) => {
    const runs = routinesData.filter((r) => r.helperId === helperId).flatMap((r) => r.runs ?? []).filter((x) => x.outcome === 'ok' && (x.tokens ?? 0) > 0)
    return runs.length ? Math.round(runs.reduce((s, x) => s + (x.tokens ?? 0), 0) / runs.length) : null
  }

  const failureInfo = (chip: WeekChip): FailureInfo => {
    const r = routinesData.find((x) => x.id === chip.routineId)
    const why = errorOfChip(chip) ?? 'The run hit an error. Open it to see the steps and logs.'
    return {
      title: `${r?.name ?? 'Routine'} failed`,
      meta: fmtShort(chip.at),
      why,
      area: info(r?.helperId ?? '').area,
      actionLabel: /connect|expired|token|auth|credential/i.test(why) ? 'Check connectors' : 'View run',
    }
  }

  const menuRoutine = menu ? routinesData.find((r) => r.id === menu.id) : undefined

  return (
    <div ref={rootRef} className="relative flex min-h-0 w-full flex-1 flex-col">
      <RoutinesTopbar
        view={view}
        onView={setView}
        empty={showEmpty}
        onNew={() => setCreating(true)}
        weekLabel={range.label}
        onPrevWeek={() => setWeekOffset((o) => o - 1)}
        onToday={() => setWeekOffset(0)}
        onNextWeek={() => setWeekOffset((o) => o + 1)}
        agentFilter={agentFilter}
        onAgentFilter={setAgentFilter}
        agents={agents}
      />
      {isError ? (
        <div role="alert" className="flex min-h-0 w-full flex-1 items-center justify-center p-[24px] text-[14px] text-bad">
          Failed to load routines. Please refresh.
        </div>
      ) : showEmpty ? (
        <EmptyState onScratch={() => setCreating(true)} onSetUp={(ids) => void handleSetUp(ids)} busy={settingUp} />
      ) : (
        <div className="flex min-h-0 w-full flex-1 flex-col gap-[16px] overflow-y-auto px-[24px] py-[18px]">
          {isLoading && routinesData.length === 0 && (
            <div className="py-[6px] text-[13px] text-muted">Loading routines…</div>
          )}
          {view === 'week' ? (
            <>
              <ChiefBanner banner={banner} onReview={() => setView('list')} />
              <WeekView
                lanes={lanes}
                range={range}
                setByYou={setByYou}
                timeZone={browserTimeZone()}
                onOpen={(id) => open(id)}
                onFailed={(chip, el) => setFailure({ anchor: anchorOf(el), chip })}
              />
            </>
          ) : (
            <>
              {suggestions[0] && (
                <SuggestionCard
                  suggestion={suggestions[0]}
                  busy={applySuggestion.isPending}
                  onApply={() => handleApply(suggestions[0])}
                  onDismiss={() =>
                    dismissSuggestion.mutate(suggestions[0].id, {
                      onError: (e) => notify(errMsg(e, 'Couldn’t dismiss')),
                    })
                  }
                />
              )}
              <ListView
                groups={groups}
                compact={!!routine || creating || !!runOpen}
                menuFor={menu?.id}
                onOpen={(id) => open(id)}
                onOpenRun={(row, index) => {
                  const ref = row.runRefs[index]
                  if (ref) setRunOpen({ routineId: row.id, runId: ref.id, name: row.name })
                }}
                onMenu={(id, el) => setMenu(menu?.id === id ? null : { id, anchor: anchorOf(el) })}
                onToggle={(id, on) => setPaused(id, !on)}
              />
            </>
          )}
        </div>
      )}

      {toast && <AppliedToast title={toast.title} body={toast.body} onClose={() => setToast(null)} />}

      {failure && (
        <FailurePopover
          anchor={failure.anchor}
          failure={failureInfo(failure.chip)}
          onClose={() => setFailure(null)}
          onAction={() => {
            const f = failure
            setFailure(null)
            if (failureInfo(f.chip).actionLabel === 'Check connectors') {
              void navigate({ to: '/control-panel/$section', params: { section: 'connectors' } } as never)
            } else if (f.chip.runId) {
              setRunOpen({ routineId: f.chip.routineId, runId: f.chip.runId, name: routineNameById(f.chip.routineId) })
            }
          }}
          onRetry={() => {
            const id = failure.chip.routineId
            setFailure(null)
            void runNow(id)
          }}
        />
      )}

      {menu && (
        <RowMenu
          anchor={menu.anchor}
          title={routineNameById(menu.id)}
          skipHint={menuRoutine?.nextAt ? fmtDayDate(menuRoutine.nextAt) : undefined}
          onClose={() => setMenu(null)}
          onEdit={() => open(menu.id)}
          onRun={() => void runNow(menu.id)}
          onSkip={() => {
            handleSkip(menu.id)
            setMenu(null)
          }}
          onDelete={() => setDeleting(menu.id)}
        />
      )}

      {deleting && (
        <DeleteConfirm
          name={routineNameById(deleting)}
          onClose={() => setDeleting(null)}
          onPause={() => {
            const id = deleting
            setDeleting(null)
            setPaused(id, true, () => open(id, 'paused'))
          }}
          onDelete={() => handleDelete(deleting)}
        />
      )}

      {creating && (
        <NewRoutineDrawer
          onClose={() => setCreating(false)}
          onCreate={handleCreate}
          avgTokens={avgTokens}
          busy={createRoutine.isPending}
        />
      )}

      {runOpen && (
        <RunDetailDrawer
          detail={
            openRunDetail
              ? runDetailFromApi(openRunDetail)
              : (() => {
                  const r = routinesData.find((x) => x.id === runOpen.routineId)
                  const ref = r?.runs?.find((x) => x.id === runOpen.runId)
                  return ref ? runSummaryDetail(ref, r!.helperId) : runSummaryDetail(
                    { id: runOpen.runId, routineId: runOpen.routineId, jobId: null, at: null, outcome: 'ok', duration: null, costCredits: 0, tokens: 0, trigger: null, error: null, feedback: null },
                    r?.helperId ?? '',
                  )
                })()
          }
          routineName={runOpen.name}
          onClose={() => setRunOpen(null)}
          onOpenRoutine={() => {
            const id = runOpen.routineId
            setRunOpen(null)
            open(id)
          }}
          onRerun={() => {
            const id = runOpen.routineId
            setRunOpen(null)
            void runNow(id)
          }}
        />
      )}

      {routine &&
        (drawer === 'output' ? (
          <RunOutputDrawer
            detail={activeRun}
            loading={activeRunLoading}
            onClose={closeDrawer}
            onOpenRoutine={() => open(routine.id)}
            onResend={() => {
              if (!activeRun) return
              resend.mutate(activeRun.run.id, {
                onSuccess: (res) => notify(res.message || (res.resent ? 'Sent again' : 'Ran again')),
                onError: (e) => notify(errMsg(e, 'Couldn’t re-send')),
              })
            }}
            onDiscuss={() => void navigate({ to: '/chat' } as never)}
            onVote={(vote) => {
              if (!activeRun) return
              feedback.mutate(
                { runId: activeRun.run.id, vote },
                {
                  onSuccess: () => notify(vote ? 'Thanks — Chief will use this' : 'Feedback cleared'),
                  onError: (e) => notify(errMsg(e, 'Couldn’t save feedback')),
                },
              )
            }}
          />
        ) : (
          <RoutineDrawer
            key={`${routine.id}-${drawer}`}
            routine={routine}
            state={drawer}
            run={activeRun}
            routineCount={routineCount}
            onClose={closeDrawer}
            onRunNow={() => void runNow(routine.id)}
            onPause={() => setPaused(routine.id, true, () => open(routine.id, 'paused'))}
            onPauseUntil={(date) =>
              updateRoutine.mutate(
                { id: routine.id, input: { pausedUntil: new Date(`${date}T00:00:00`).toISOString() } },
                {
                  onSuccess: () => notify(`Paused until ${date}`),
                  onError: (e) => notify(errMsg(e, 'Couldn’t set the date')),
                },
              )
            }
            onResume={() => setPaused(routine.id, false, () => open(routine.id))}
            onStop={() => {
              const jobId = activeRun?.job?.id ?? routine.latestJobId
              if (!jobId) {
                open(routine.id)
                return
              }
              cancelJob.mutate(jobId, {
                onSuccess: () => {
                  notify('Run stopped')
                  open(routine.id)
                },
                onError: (e) => notify(errMsg(e, 'Couldn’t stop the run')),
              })
            }}
            onSave={handleSave}
            onOpenRun={(rid) => setRunOpen({ routineId: routine.id, runId: rid, name: routine.name })}
            onSeeOutput={() => open(routine.id, 'output', activeRun?.run.id)}
          />
        ))}
    </div>
  )
}

/** Routes to the mode-neutral routines URLs (`/routines…`). */
function useRoutinesNav(): RoutinesNav {
  const navigate = useNavigate()
  return {
    openRoutine: (id, state, runId) =>
      void navigate({
        to: '/routines/$routineId',
        params: { routineId: id },
        search: {
          ...(state && state !== 'detail' ? { state } : {}),
          ...(runId ? { run: runId } : {}),
        },
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
  const { state, run } = useSearch({ strict: false }) as { state?: string; run?: string }
  const nav = useRoutinesNav()
  return <RoutinesBoard key="board" nav={nav} routineId={routineId} drawerState={drawerStateFrom(state)} runId={run} />
}
