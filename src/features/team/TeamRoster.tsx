import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { ArrowUpRight, Cpu, Ellipsis, Pause, Play, Plus, UserMinus } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { Inset } from '../../ui/ds/Frame'
import { MenuItemBody, MenuSeparatorLine, menuItemClass, menuSurface } from '../../ui/ds/Menu'
import { notify } from '../../ui/ds/Toaster'
import type { HelperArea } from '../../core/domain/types'
import {
  useCompanySettings,
  useCreateHelper,
  useHelpers,
  useInbox,
  useRetireHelper,
  useUpdateHelperEverywhere,
} from '../../app/queries'
import { useSession } from '../../app/session'
import { formatCredits } from '../analytics/format'
import { buildHelperRecord, companyDefaultModel } from './model'
import type { HelperRecord } from './teamData'
import { StatusChip, TeamTopbar } from './StatusChip'
import { Btn, Chip, IconBtn, Segmented } from './ui'
import { HireDialog } from './HireDialog'
import { SetupDialog } from './SetupDialog'
import type { HireSubmit } from './SetupDialog'
import { RolesModelsDialog } from './RolesModelsDialog'
import { LetGoDialog } from './LetGoDialog'

type RosterHelper = HelperRecord

// ── Lead · Chief (pen FEsXM) ──────────────────────────────────────────────────

function ChiefLead({
  chief,
  jobs,
  waiting,
  cost,
}: {
  chief: RosterHelper
  jobs: number
  waiting: number
  cost: number
}) {
  return (
    <Link
      to="/team/$helperId"
      params={{ helperId: chief.id }}
      className="flex w-full items-center gap-[20px] rounded-lg bg-surface p-[20px] outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
    >
      <Mascot helper size={64} radius={18} area={chief.area} title={chief.name} />
      <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
        <div className="flex items-center gap-[8px]">
          <span className="font-display text-[18px] font-semibold tracking-[-0.2px] text-ink">{chief.name}</span>
          <Chip tone="neutral">{chief.role}</Chip>
          <StatusChip status={chief.rosterStatus} />
        </div>
        <p className="m-0 text-[13px] leading-[1.45] text-ink-2">
          Turns goals into jobs, routes them to the right helper, and talks with you. Every chat starts here.
        </p>
        <span className="font-mono text-[11px] text-muted">{chief.rosterMeta}</span>
      </div>
      <span className="h-[64px] w-px shrink-0 bg-line-strong" aria-hidden />
      <div className="flex shrink-0 gap-[28px]">
        <Stat value={String(jobs)} label="Jobs routed" />
        <Stat value={String(waiting)} label="Waiting on you" warn={waiting > 0} />
        <Stat value={formatCredits(cost)} label="This month" />
      </div>
    </Link>
  )
}

function Stat({ value, label, warn }: { value: string; label: string; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className={`font-mono text-[22px] ${warn ? 'text-warn' : 'text-ink'}`}>{value}</span>
      <span className="text-[12px] text-muted">{label}</span>
    </div>
  )
}

// ── Helper card more-options menu ────────────────────────────────────────────

function CardMoreMenu({
  helper,
  paused,
  onClose,
  onPause,
  onLetGo,
}: {
  helper: RosterHelper
  paused: boolean
  onClose: () => void
  onPause: () => void
  onLetGo: () => void
}) {
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Actions for ${helper.name}`}
      className={`absolute top-[44px] right-[16px] z-40 flex w-[180px] flex-col ${menuSurface}`}
    >
      <button
        type="button"
        role="menuitem"
        className={menuItemClass}
        onClick={() => {
          onClose()
          void navigate({ to: '/team/$helperId', params: { helperId: helper.id } })
        }}
      >
        <MenuItemBody icon={ArrowUpRight} label={`Open ${helper.name}`} />
      </button>
      <button type="button" role="menuitem" className={menuItemClass} onClick={onPause}>
        <MenuItemBody icon={paused ? Play : Pause} label={`${paused ? 'Resume' : 'Pause'} ${helper.name}`} />
      </button>
      <MenuSeparatorLine />
      <button type="button" role="menuitem" className={menuItemClass} onClick={onLetGo}>
        <MenuItemBody icon={UserMinus} label={`Let ${helper.name} go`} danger />
      </button>
    </div>
  )
}

// ── Helper card (pen "Helper · Builder" QbN3H) ────────────────────────────────

function HelperCard({ helper }: { helper: RosterHelper }) {
  const area = helper.area as HelperArea
  const [menuOpen, setMenuOpen] = useState(false)
  const [letGoOpen, setLetGoOpen] = useState(false)
  const updateHelper = useUpdateHelperEverywhere()
  const retire = useRetireHelper()
  const paused = helper.paused

  function togglePause() {
    setMenuOpen(false)
    updateHelper.mutate(
      { id: helper.id, input: { status: paused ? 'active' : 'paused' } },
      {
        onSuccess: () => notify(paused ? `${helper.name} resumed` : `${helper.name} paused`),
        onError: () => notify(`Couldn't ${paused ? 'resume' : 'pause'} ${helper.name}`),
      },
    )
  }
  function letGo() {
    retire.mutate(helper.id, {
      onSuccess: () => notify(`${helper.name} let go`),
      onError: () => notify(`Couldn't let ${helper.name} go`),
    })
  }
  return (
    <div className="relative flex h-[218px] min-w-0 flex-1">
      <Link
        to="/team/$helperId"
        params={{ helperId: helper.id }}
        className="flex min-w-0 flex-1 flex-col gap-[14px] rounded-lg bg-surface px-[16px] pt-[16px] outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
      >
        <div className="flex w-full gap-[14px]">
          <Mascot helper size={64} radius={18} area={area} title={helper.name} />
          <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
            <span className="font-display text-[16px] font-semibold text-ink">{helper.name}</span>
            <span className="text-[12px] text-muted">{helper.roleArea}</span>
            {paused ? (
              <Chip tone="idle" icon={Pause} className="self-start">Paused</Chip>
            ) : (
              <StatusChip status={helper.rosterStatus} className="self-start" />
            )}
          </div>
          <span className="size-[28px] shrink-0" aria-hidden />
        </div>
        <div className="flex min-h-0 w-full flex-1 flex-col gap-[3px] rounded-base bg-soft px-[11px] py-[9px]">
          <span className="font-mono text-[10.5px] tracking-[0.8px] text-faint">{helper.nowLabel}</span>
          <p className="m-0 text-[12.5px] leading-[1.4] text-ink-2">{helper.now}</p>
        </div>
        <div className="flex w-full items-center shadow-[inset_0_1px_0_var(--color-line)] py-[10px]">
          <span className="text-[12px] text-muted">{helper.rosterMeta}</span>
          <span className="h-px flex-1" />
          <span className="font-mono text-[11.5px] text-ink-2">{helper.cost}</span>
        </div>
      </Link>
      <IconBtn
        icon={Ellipsis}
        label={`More for ${helper.name}`}
        className="absolute top-[16px] right-[16px]"
        onClick={(e) => { e.preventDefault(); setMenuOpen((v) => !v) }}
      />
      {menuOpen && (
        <CardMoreMenu
          helper={helper}
          paused={paused}
          onClose={() => setMenuOpen(false)}
          onPause={togglePause}
          onLetGo={() => { setMenuOpen(false); setLetGoOpen(true) }}
        />
      )}
      {letGoOpen && <LetGoDialog helper={helper} onClose={() => setLetGoOpen(false)} onLetGo={letGo} />}
    </div>
  )
}

// ── Hire card (pen rtFEe) ─────────────────────────────────────────────────────

function HireCard({ onHire }: { onHire: () => void }) {
  const minis: HelperArea[] = ['retro', 'ops', 'support']
  return (
    <div className="flex h-[218px] min-w-0 flex-1 flex-col items-center justify-center gap-[10px] rounded-lg p-[18px] outline-1 -outline-offset-1 outline-wire-strong">
      <div className="flex">
        {minis.map((a, i) => (
          <Mascot
            key={a}
            helper
            size={24}
            radius={7}
            area={a}
            style={{ marginLeft: i ? -6 : 0, boxShadow: '0 0 0 2px var(--color-surface)' }}
          />
        ))}
      </div>
      <span className="text-[14px] font-semibold text-ink">Hire a helper</span>
      <p className="m-0 w-[240px] text-center text-[12.5px] leading-[1.45] text-muted">
        Retro, Ops or one you describe. Give it a job and a loop — it starts on the next run.
      </p>
      <Btn h={30} onClick={onHire}>
        Browse helpers
      </Btn>
    </div>
  )
}

// ── TeamRoster ────────────────────────────────────────────────────────────────

const FILTERS = ['All', 'Working', 'Needs you', 'Idle'] as const
type Filter = (typeof FILTERS)[number]

function matches(h: RosterHelper, f: Filter) {
  if (f === 'All') return true
  if (f === 'Working') return h.rosterStatus === 'Working' || h.rosterStatus === 'Caught up'
  return h.rosterStatus === f
}

type RosterState = 'hire' | 'setup' | 'roles' | undefined

/**
 * /team — pen XaOds. Dialog states (pen jEooC · hkw1l · JYwEe) are reachable
 * with `?state=hire|setup|roles` as well as from the buttons.
 */
export function TeamRoster() {
  const search = useSearch({ strict: false }) as { state?: string }
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('All')
  const [pickedOption, setPickedOption] = useState('sales')
  const state = search.state as RosterState
  const setState = (s: RosterState) =>
    void navigate({ to: '/team', search: (s ? { state: s } : {}) as never, replace: true })

  const createHelper = useCreateHelper()
  const onHire = (input: HireSubmit) => {
    createHelper.mutate(
      {
        name: input.name,
        area: input.area,
        role: input.role,
        jobDescription: input.jobDescription || undefined,
        model: input.model || undefined,
        reportsTo: input.reportsTo,
        channels: input.channels,
        look: input.look.color || input.look.picture ? input.look : undefined,
      },
      {
        onSuccess: () => {
          notify(`${input.name} hired`)
          setState(undefined)
        },
        onError: () => notify(`Couldn't hire ${input.name}`),
      },
    )
  }

  const companyName = useSession((st) => st.company?.name) ?? ''
  const ownerName = useSession((st) => st.user?.name) ?? 'you'
  const { data: settings } = useCompanySettings()
  const { data: inbox = [] } = useInbox()
  const { data: rawHelpers, isLoading, isError } = useHelpers()
  const live = rawHelpers ?? []
  const ctx = { helpers: live, ownerName, defaultModel: companyDefaultModel(settings) }
  const allHelpers = live.map((h) => buildHelperRecord(h, ctx))
  const teamJobs = live.reduce((n, h) => n + (h.jobsMonth ?? 0), 0)
  const teamCost = live.reduce((n, h) => n + (h.costMonth ?? 0), 0)
  const waiting = inbox.filter((i) => i.needsYou && i.status === 'pending').length
  const chief = allHelpers.find((h) => h.helper.isChief)
  const reports = allHelpers.filter((h) => !h.helper.isChief)
  const shown = reports.filter((h) => matches(h, filter))
  const cells: (RosterHelper | 'hire')[] = [...shown, 'hire']
  const rows: (RosterHelper | 'hire')[][] = []
  for (let i = 0; i < cells.length; i += 3) rows.push(cells.slice(i, i + 3))

  return (
    <>
      <Inset label="Team">
        <TeamTopbar meta={companyName} />
        <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto">
          <div className="flex w-[1040px] max-w-full flex-col gap-[20px] py-[24px]">
            <div className="flex w-full items-end gap-[10px]">
              <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
                <h2 className="m-0 font-display text-[22px] font-semibold tracking-[-0.4px] text-ink">Team</h2>
                <p className="m-0 text-[13px] text-muted">
                  Helpers run your company. Each owns a job, works on loops, and checks in only when a decision is
                  yours.
                </p>
              </div>
              <Btn icon={Cpu} fs={14} onClick={() => setState('roles')}>
                Roles &amp; models
              </Btn>
              <Btn variant="primary" icon={Plus} fs={14} onClick={() => setState('hire')}>
                Hire helper
              </Btn>
            </div>

            {isLoading && (
              <div className="flex w-full items-center justify-center py-[40px] text-[13px] text-muted">
                Loading helpers…
              </div>
            )}

            {isError && (
              <div className="flex w-full items-center justify-center py-[40px] text-[13px] text-muted">
                Could not load helpers. Please try again.
              </div>
            )}

            {!isLoading && !isError && allHelpers.length === 0 && (
              <div className="flex w-full items-center justify-center py-[40px] text-[13px] text-muted">
                No helpers on your team yet.{' '}
                <button type="button" className="ml-[4px] text-link hover:underline" onClick={() => setState('hire')}>
                  Hire your first helper
                </button>
              </div>
            )}

            {chief && <ChiefLead chief={chief} jobs={teamJobs} waiting={waiting} cost={teamCost} />}

            {!isLoading && !isError && (
              <div className="flex w-full items-center gap-[8px] pt-[8px]">
                <h3 className="m-0 text-[14px] font-semibold text-ink">Reports to Chief</h3>
                <span className="font-mono text-[12px] text-muted">{reports.length} helpers</span>
                <span className="h-px flex-1" />
                <Segmented items={FILTERS} value={filter} onChange={setFilter} />
              </div>
            )}

            {rows.map((row, i) => (
              <div key={i} className="grid w-full grid-cols-3 gap-[12px]">
                {row.map((c) =>
                  c === 'hire' ? (
                    <HireCard key="hire" onHire={() => setState('hire')} />
                  ) : (
                    <HelperCard key={c.id} helper={c} />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </Inset>

      {state === 'hire' && (
        <HireDialog
          onClose={() => setState(undefined)}
          onNext={(optionId) => {
            setPickedOption(optionId)
            setState('setup')
          }}
        />
      )}
      {state === 'setup' && (
        <SetupDialog
          optionId={pickedOption}
          onClose={() => setState(undefined)}
          onBack={() => setState('hire')}
          onHire={onHire}
          submitting={createHelper.isPending}
        />
      )}
      {state === 'roles' && <RolesModelsDialog onClose={() => setState(undefined)} />}
    </>
  )
}
