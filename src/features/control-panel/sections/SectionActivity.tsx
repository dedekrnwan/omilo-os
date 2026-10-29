import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Breadcrumb, SectionPane } from '../legacyShared'
import { Mascot } from '../../../ui/ds/Mascot'
import { useCommands } from '../../../app/CommandsProvider'
import { useAuditLog } from '../../../app/queries'
import type { AuditEvent, AuditQuery } from '../../../core/domain/controlPanel'
import type { HelperArea } from '../../../core/domain/types'
import { notify } from '../../../ui/ds/Toaster'
import { errorMessage, initialsOf, saveBlob } from '../format'

const FILTERS: { label: string; query: Pick<AuditQuery, 'type' | 'actor'> }[] = [
  { label: 'All', query: {} },
  { label: 'Agents', query: { actor: 'agent' } },
  { label: 'People', query: { actor: 'person' } },
  { label: 'Approvals', query: { type: 'approvals' } },
  { label: 'Settings', query: { type: 'settings' } },
]

const RANGES = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
]

const PAGE = 100

function PersonAvatar({ initials }: { initials: string }) {
  return (
    <span className="flex size-[24px] shrink-0 items-center justify-center rounded-full bg-[#D6D3D1] text-[10px] font-semibold text-ink-2">
      {initials}
    </span>
  )
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function EventRow({ e }: { e: AuditEvent }) {
  const isSettings = e.type === 'settings'
  const time = new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  const tag = e.channel ?? (isSettings ? 'Settings' : e.type.charAt(0).toUpperCase() + e.type.slice(1))
  return (
    <div className="flex items-center gap-[10px] px-[16px] py-[10px] border-b border-line last:border-b-0">
      <span className="w-[36px] text-[12px] text-muted">{time}</span>
      {e.actorType === 'agent' && e.actorArea ? (
        <Mascot helper size={20} radius={0} area={e.actorArea as HelperArea} tile={false} />
      ) : (
        <PersonAvatar initials={initialsOf(e.actorName || '?')} />
      )}
      <p className="min-w-0 flex-1 text-[12.5px] text-ink">
        <span className="font-medium">{e.actorName || 'Someone'}</span>
        {' '}{e.action}{' '}
        <span className="text-ink-2">{e.target}</span>
      </p>
      <span className={`rounded-pill px-[8px] py-[1px] text-[11px] ${isSettings ? 'text-muted' : 'text-muted border border-line-strong bg-soft'}`}>
        {isSettings ? (
          <span className="flex items-center gap-[4px]">
            <span>⚙</span> {tag}
          </span>
        ) : tag}
      </span>
    </div>
  )
}

export function SectionActivity() {
  const commands = useCommands()
  const [filter, setFilter] = useState(0)
  const [range, setRange] = useState(0)
  const [limit, setLimit] = useState(PAGE)
  const [exporting, setExporting] = useState(false)
  const query: AuditQuery = { ...FILTERS[filter].query, days: RANGES[range].days, limit }
  const { data, isLoading, isError, isFetching } = useAuditLog(query)
  const events = data?.events ?? []

  // Group by calendar day (events arrive newest first).
  const groups: { label: string; events: AuditEvent[] }[] = []
  for (const e of events) {
    const label = dayLabel(e.at)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.events.push(e)
    else groups.push({ label, events: [e] })
  }

  async function exportCsv() {
    setExporting(true)
    try {
      const { limit: _ignored, ...q } = query
      void _ignored
      const blob = await commands.downloadAuditCsv(q)
      saveBlob(blob, `omilo-activity-${new Date().toISOString().slice(0, 10)}.csv`)
    } catch (e) {
      notify(errorMessage(e, 'Could not export the activity log'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Activity log" />
        <div className="ml-auto">
          <Button variant="secondary" height={28} icon={Download} disabled={exporting} onClick={() => void exportCsv()}>
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </div>
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">Activity log</h1>
        <p className="mb-[20px] text-[13px] text-muted">Everything agents and people did — approvals, changes and sends.</p>

        {/* Filters row */}
        <div className="mb-[16px] flex items-center justify-between">
          <div className="flex gap-[4px]">
            {FILTERS.map((f, i) => (
              <button
                key={f.label}
                type="button"
                aria-pressed={i === filter}
                onClick={() => { setFilter(i); setLimit(PAGE) }}
                className={`rounded-pill px-[10px] py-[4px] text-[12px] transition-colors ${
                  i === filter ? 'bg-ink text-white' : 'text-muted hover:text-ink hover:bg-hover'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="relative flex items-center gap-[6px] rounded-btn border border-line-strong bg-surface px-[10px] py-[4px]">
            <span className="text-[13px]">📅</span>
            <select
              aria-label="Date range"
              value={range}
              onChange={(e) => { setRange(Number(e.target.value)); setLimit(PAGE) }}
              className="cursor-pointer appearance-none bg-transparent pr-[16px] text-[12px] text-ink outline-none"
            >
              {RANGES.map((r, i) => (
                <option key={r.label} value={i}>{r.label}</option>
              ))}
            </select>
            <svg width="12" height="12" viewBox="0 0 12 12" className="pointer-events-none absolute right-[10px] text-muted" aria-hidden>
              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </label>
        </div>

        {/* Events */}
        {isLoading && <p className="text-[13px] text-muted">Loading activity…</p>}
        {isError && <p className="text-[13px] text-muted">Could not load the activity log. Please try again.</p>}
        {!isLoading && !isError && events.length === 0 && (
          <div className="rounded-lg border border-line-strong bg-surface px-[16px] py-[20px] text-center">
            <p className="text-[13px] text-muted">Nothing here yet for {RANGES[range].label.toLowerCase()}.</p>
          </div>
        )}
        {groups.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-line-strong bg-surface">
            {groups.map((g, gi) => (
              <div key={g.label}>
                <div className={`border-b border-line bg-soft px-[16px] py-[8px] ${gi > 0 ? 'border-t' : ''}`}>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.8px] text-faint">{g.label}</span>
                </div>
                {g.events.map((e) => <EventRow key={e.id} e={e} />)}
              </div>
            ))}
          </div>
        )}
        {data?.nextCursor && (
          <div className="mt-[12px] flex justify-center">
            <Button variant="secondary" height={28} disabled={isFetching || limit >= 200} onClick={() => setLimit((l) => Math.min(l + PAGE, 200))}>
              {isFetching ? 'Loading…' : 'Show more'}
            </Button>
          </div>
        )}
      </SectionPane>
    </div>
  )
}
