import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { MoreHorizontal, Users } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { Button } from '../../ui/ds/Button'
import { Inset, Topbar } from '../../ui/ds/Frame'
import { helperColor } from '../../ui/tokens'
import type { HelperArea } from '../../core/domain/types'
import { HELPERS } from './teamData'
import type { HelperRecord, HelperStatus } from './teamData'
import { HireDialog } from './HireDialog'
import { RolesModelsDialog } from './RolesModelsDialog'

// ── Status chip ───────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<HelperStatus, { bg: string; ink: string }> = {
  'Working':            { bg: 'var(--color-ok-tint)',   ink: 'var(--color-ok)' },
  'Needs you':          { bg: 'var(--color-warn-tint)', ink: 'var(--color-warn)' },
  'Caught up':          { bg: '#E0F2FE',                ink: '#0369A1' },
  'Idle':               { bg: 'var(--color-line-strong)', ink: 'var(--color-muted)' },
  'Always on':          { bg: 'var(--color-ok-tint)',   ink: 'var(--color-ok)' },
  'Planning next week': { bg: '#E0E7FF',                ink: '#4338CA' },
}

function StatusChip({ status }: { status: HelperStatus }) {
  const st = STATUS_STYLE[status]
  return (
    <span
      className="inline-flex h-[18px] shrink-0 items-center rounded-pill px-[7px] text-[11px] font-medium"
      style={{ background: st.bg, color: st.ink }}
    >
      {status}
    </span>
  )
}

// ── Chief banner ──────────────────────────────────────────────────────────────

function ChiefBanner({ chief }: { chief: HelperRecord }) {
  const color = helperColor[chief.area]
  return (
    <Link
      to="/team/$helperId"
      params={{ helperId: chief.id }}
      className="flex items-center gap-[16px] rounded-lg px-[16px] py-[14px] outline-1 -outline-offset-1 outline-line-strong hover:bg-soft transition-colors"
    >
      <Mascot size={52} radius={14} area={chief.area as HelperArea} title={chief.name} />
      <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
        <div className="flex items-center gap-[8px]">
          <span className="text-[15px] font-semibold text-ink">{chief.name}</span>
          <span className="text-[12px] text-muted">{chief.roleLabel}</span>
          <StatusChip status={chief.status} />
        </div>
        <p className="m-0 text-[12.5px] text-ink-2 line-clamp-2">
          Turns goals into jobs, routes them to the right helper, and talks with you. Every chat starts here.
        </p>
        <span className="text-[11.5px] text-muted">{chief.statsLine}</span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-[8px]">
        <div className="flex gap-[20px]">
          <div className="flex flex-col items-center gap-[2px]">
            <span className="font-display text-[22px] font-semibold text-ink leading-none">42</span>
            <span className="text-[11px] text-muted">Jobs routed</span>
          </div>
          <div className="flex flex-col items-center gap-[2px]">
            <span className="font-display text-[22px] font-semibold leading-none" style={{ color }}>2</span>
            <span className="text-[11px] text-muted">Waiting on you</span>
          </div>
          <div className="flex flex-col items-center gap-[2px]">
            <span className="font-display text-[22px] font-semibold text-ink leading-none">$88</span>
            <span className="text-[11px] text-muted">This month</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

// ── Filter tabs ───────────────────────────────────────────────────────────────

type FilterTab = 'All' | 'Working' | 'Needs you' | 'Idle'
const FILTER_TABS: FilterTab[] = ['All', 'Working', 'Needs you', 'Idle']

function filterHelper(h: HelperRecord, tab: FilterTab): boolean {
  if (tab === 'All') return true
  if (tab === 'Working') return h.status === 'Working' || h.status === 'Always on'
  if (tab === 'Needs you') return h.status === 'Needs you'
  if (tab === 'Idle') return h.status === 'Idle'
  return true
}

// ── Helper card ───────────────────────────────────────────────────────────────

function HelperCard({ helper }: { helper: HelperRecord }) {
  return (
    <Link
      to="/team/$helperId"
      params={{ helperId: helper.id }}
      className="relative flex flex-col gap-[10px] rounded-lg p-[14px] outline-1 -outline-offset-1 outline-line-strong bg-surface hover:bg-soft transition-colors"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-[10px]">
          <Mascot size={36} radius={10} area={helper.area as HelperArea} title={helper.name} />
          <div className="flex flex-col gap-[2px]">
            <span className="text-[13.5px] font-semibold text-ink">{helper.name}</span>
            <span className="text-[12px] text-muted">{helper.roleArea}</span>
          </div>
        </div>
        <button
          type="button"
          aria-label="More options"
          onClick={(e) => e.preventDefault()}
          className="flex size-[24px] items-center justify-center rounded-sm text-faint hover:text-muted hover:bg-hover transition-colors"
        >
          <MoreHorizontal size={14} aria-hidden />
        </button>
      </div>

      <StatusChip status={helper.status} />

      <p className="m-0 text-[12px] text-ink-2 line-clamp-2">{helper.now}</p>

      <div className="flex items-center justify-between pt-[2px]">
        <span className="text-[11.5px] text-muted">
          {helper.loopCount} loop{helper.loopCount !== 1 ? 's' : ''} · {helper.loopTags}
        </span>
        <span className="text-[11.5px] text-muted">{helper.earnings}</span>
      </div>
    </Link>
  )
}

// ── Hire CTA card ─────────────────────────────────────────────────────────────

function HireCTACard({ onHire }: { onHire: () => void }) {
  const areas: HelperArea[] = ['brand', 'support', 'marketing']
  return (
    <div className="flex flex-col items-center gap-[10px] rounded-lg p-[14px] outline-1 -outline-offset-1 outline-line-strong bg-soft">
      <div className="flex gap-[-6px]">
        {areas.map((area, i) => (
          <span key={area} style={{ marginLeft: i === 0 ? 0 : -8 }}>
            <Mascot
              size={28}
              radius={8}
              area={area}
              tile={false}
              className="outline-2 outline-surface"
            />
          </span>
        ))}
      </div>
      <div className="text-center">
        <p className="m-0 text-[12.5px] font-medium text-ink">Hire a helper</p>
        <p className="m-0 mt-[2px] text-[11.5px] text-muted">
          Retro, Ops or one you describe. Give it a job and a loop — it starts on the next run.
        </p>
      </div>
      <button
        type="button"
        onClick={onHire}
        className="text-[12px] font-medium text-link hover:underline"
      >
        Browse helpers
      </button>
    </div>
  )
}

// ── TeamRoster ────────────────────────────────────────────────────────────────

/**
 * Main content for /team.
 * Chief is shown in a banner above the grid; subordinates in a 3-col grid.
 */
export function TeamRoster() {
  const [filterTab, setFilterTab] = useState<FilterTab>('All')
  const [hireOpen, setHireOpen] = useState(false)
  const [rolesOpen, setRolesOpen] = useState(false)

  const chief = HELPERS[0]
  const subordinates = HELPERS.slice(1)
  const filtered = subordinates.filter((h) => filterHelper(h, filterTab))

  return (
    <>
      <Inset label="Team">
        <Topbar
          icon={Users}
          title="Team"
          meta="Sahabat Warga"
          actions={
            <div className="flex items-center gap-[6px]">
              <Button variant="secondary" onClick={() => setRolesOpen(true)}>
                Roles &amp; models
              </Button>
              <Button onClick={() => setHireOpen(true)}>
                + Hire helper
              </Button>
            </div>
          }
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[24px] py-[20px] gap-[24px]">
          {/* Page heading */}
          <div>
            <h2 className="m-0 font-display text-[22px] font-semibold tracking-[-0.4px] text-ink">Team</h2>
            <p className="mt-[4px] mb-0 text-[13.5px] text-muted">
              Six helpers run Sahabat Warga. Each owns a job, works on loops, and checks in only when a decision is yours.
            </p>
          </div>

          {/* Chief banner */}
          <ChiefBanner chief={chief} />

          {/* Reports section */}
          <div>
            <div className="flex items-center justify-between mb-[12px]">
              <h3 className="m-0 text-[13px] font-medium text-ink">
                Reports to Chief <span className="text-muted font-normal">{subordinates.length} helpers</span>
              </h3>
              {/* Filter tabs */}
              <div className="flex items-center gap-[2px] rounded-md bg-[#E7E5E4] p-[3px]">
                {FILTER_TABS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setFilterTab(tab)}
                    className={`h-[22px] rounded-sm px-[8px] text-[11.5px] font-medium transition-colors ${
                      filterTab === tab
                        ? 'bg-surface text-ink shadow-[0_1px_3px_#0C0A091F]'
                        : 'text-muted hover:text-ink-2'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* 3-col grid */}
            <div className="grid grid-cols-3 gap-[10px]">
              {filtered.map((h) => (
                <HelperCard key={h.id} helper={h} />
              ))}
              <HireCTACard onHire={() => setHireOpen(true)} />
            </div>
          </div>
        </div>
      </Inset>

      {hireOpen && <HireDialog onClose={() => setHireOpen(false)} />}
      {rolesOpen && <RolesModelsDialog onClose={() => setRolesOpen(false)} />}
    </>
  )
}
