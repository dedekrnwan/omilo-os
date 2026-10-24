import { Check, Filter, Edit } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { Button } from '../../ui/ds/Button'
import { COMPANY_NAME, INBOX_JOBS, GETTING_STARTED_ITEMS } from './data'
import type { HelperArea } from '../../core/domain/types'

interface StepInboxProps {
  /** Called when user clicks "Approve all" or any individual "Approve" — leads into the real app. */
  onApproveAll: () => void
}

const NAV_ITEMS = [
  { label: 'Goals', icon: '○' },
  { label: 'Inbox', icon: '□', active: true, badge: 5 },
  { label: 'Flows', icon: '↺' },
  { label: 'Routines', icon: '⟳' },
  { label: 'Docs', icon: '📄' },
  { label: 'Analytics', icon: '📊' },
]

const AREAS = [
  { label: 'All areas', count: 14, active: true },
  { label: 'General', count: 2, color: '#A8A29E' },
  { label: 'Engineering', count: 5, color: 'var(--color-helper-dev)' },
  { label: 'Marketing', count: 4, color: 'var(--color-helper-marketing)' },
  { label: 'Business', count: 3, color: 'var(--color-helper-sales)' },
]

export function StepInbox({ onApproveAll }: StepInboxProps) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Simulated app sidebar — Office layout */}
      <div
        className="flex w-[180px] shrink-0 flex-col py-[14px]"
        style={{ borderRight: '1px solid var(--color-line-strong)', background: 'var(--color-surface)' }}
      >
        {/* Workspace */}
        <div className="flex items-center gap-[8px] px-[12px] pb-[12px]">
          <div
            className="flex size-[28px] shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-primary-ink"
            style={{ background: 'var(--color-primary)' }}
          >
            SW
          </div>
          <div className="flex flex-col">
            <span className="text-[12.5px] font-semibold text-ink">{COMPANY_NAME}</span>
            <span className="text-[11px] text-muted">Office · 5 areas</span>
          </div>
        </div>

        {/* Nav */}
        <div className="flex flex-col gap-[1px] px-[6px]">
          {NAV_ITEMS.map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-[8px] rounded-md px-[8px] py-[5px]"
              style={{
                background: item.active ? 'var(--color-hover)' : 'transparent',
              }}
            >
              <span className="text-[12px] text-muted">{item.icon}</span>
              <span
                className="flex-1 text-[12.5px]"
                style={{
                  fontWeight: item.active ? 500 : 400,
                  color: item.active ? 'var(--color-ink)' : 'var(--color-ink-2)',
                }}
              >
                {item.label}
              </span>
              {item.badge && (
                <span
                  className="flex h-[16px] items-center rounded-pill px-[5px] text-[10.5px] font-semibold text-primary-ink"
                  style={{ background: 'var(--color-primary)' }}
                >
                  {item.badge}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="px-[14px] py-[8px]">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
            Areas
          </span>
        </div>

        <div className="flex flex-col gap-[1px] px-[6px]">
          {AREAS.map((area) => (
            <div
              key={area.label}
              className="flex items-center gap-[8px] rounded-md px-[8px] py-[5px]"
              style={{ background: area.active ? 'var(--color-hover)' : 'transparent' }}
            >
              {area.color ? (
                <span
                  className="size-[6px] shrink-0 rounded-full"
                  style={{ background: area.color }}
                />
              ) : (
                <span className="size-[6px]" />
              )}
              <span
                className="flex-1 text-[12px]"
                style={{
                  fontWeight: area.active ? 500 : 400,
                  color: area.active ? 'var(--color-ink)' : 'var(--color-ink-2)',
                }}
              >
                {area.label}
              </span>
              <span className="text-[11px] text-muted">{area.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main inbox content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Inbox header */}
        <div
          className="flex h-[44px] shrink-0 items-center gap-[10px] px-[20px]"
          style={{ borderBottom: '1px solid var(--color-line-strong)' }}
        >
          <h1 className="m-0 text-[16px] font-semibold text-ink">Inbox</h1>
          <div className="flex-1" />
          <button
            type="button"
            className="flex items-center gap-[5px] rounded-btn px-[8px] py-[4px] text-[12px] text-muted transition-colors hover:bg-hover"
          >
            <Filter size={12} aria-hidden />
            All areas
          </button>
        </div>

        <div className="flex min-h-0 flex-1 overflow-y-auto px-[20px] py-[16px]">
          {/* Team ready banner */}
          <div
            className="mb-[20px] flex items-center gap-[14px] rounded-lg p-[16px]"
            style={{ border: '1px solid var(--color-line-strong)', background: 'var(--color-soft)' }}
          >
            <div className="flex items-center" style={{ gap: -6 }}>
              {(['brand', 'dev', 'marketing', 'support'] as HelperArea[]).map((area, i) => (
                <div key={area} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 4 - i }}>
                  <Mascot size={28} radius={8} area={area} />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-[2px]">
              <p className="m-0 text-[13.5px] font-semibold text-ink">Your team is ready, Dede</p>
              <p className="m-0 text-[12.5px] text-muted">
                Chief, Builder, Grower and Support each proposed a first job based on what you told
                me. Nothing runs until you approve.
              </p>
            </div>
          </div>

          {/* First jobs to approve */}
          <div className="mb-[12px] flex items-center gap-[8px]">
            <h2 className="m-0 text-[13px] font-semibold text-ink">First jobs to approve</h2>
            <span
              className="flex h-[18px] items-center rounded-pill px-[6px] text-[11px] font-semibold text-primary-ink"
              style={{ background: 'var(--color-primary)' }}
            >
              {INBOX_JOBS.length}
            </span>
            <div className="flex-1" />
            <Button variant="secondary" height={28} icon={Check} onClick={onApproveAll}>
              Approve all
            </Button>
          </div>

          <div className="flex flex-col gap-[6px]">
            {INBOX_JOBS.map((job) => (
              <InboxJobRow key={job.id} job={job} onApprove={onApproveAll} />
            ))}
          </div>
        </div>
      </div>

      {/* Right — Getting started */}
      <div
        className="flex w-[240px] shrink-0 flex-col gap-[14px] overflow-y-auto px-[20px] py-[20px]"
        style={{ borderLeft: '1px solid var(--color-line-strong)' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] font-semibold text-ink">Getting started</span>
          <span className="text-[12px] text-muted">2 of 6</span>
        </div>

        <div className="flex flex-col gap-[8px]">
          {GETTING_STARTED_ITEMS.map((item) => (
            <div key={item.id} className="flex items-start gap-[8px]">
              <div
                className="mt-[1px] flex size-[16px] shrink-0 items-center justify-center rounded-full"
                style={{
                  background: item.done ? 'var(--color-ok)' : 'transparent',
                  border: item.done ? 'none' : '1.5px solid var(--color-line-strong)',
                }}
              >
                {item.done && <Check size={9} className="text-primary-ink" strokeWidth={3} />}
              </div>
              <span
                className="text-[12.5px] leading-[1.4]"
                style={{
                  color: item.done ? 'var(--color-muted)' : 'var(--color-ink)',
                  textDecoration: item.done ? 'line-through' : 'none',
                }}
              >
                {item.label}
              </span>
            </div>
          ))}
        </div>

        <div
          className="mt-[4px] rounded-base p-[10px] text-[12px] leading-[1.5] text-ink-2"
          style={{ background: 'var(--color-soft)', border: '1px solid var(--color-line-strong)' }}
        >
          Not sure? Ask Chief anything with ⌘J. It knows what your team is doing.
        </div>
      </div>
    </div>
  )
}

function InboxJobRow({
  job,
  onApprove,
}: {
  job: (typeof INBOX_JOBS)[0]
  onApprove: () => void
}) {
  return (
    <div
      className="flex items-center gap-[12px] rounded-lg px-[14px] py-[12px]"
      style={{ border: '1px solid var(--color-line-strong)', background: 'var(--color-surface)' }}
    >
      <Mascot size={32} radius={9} area={job.area} />
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <div className="flex items-center gap-[6px]">
          <span className="text-[12px] text-muted">{job.helper}</span>
          <span className="text-[11.5px] text-muted">·</span>
          <span className="text-[12px] text-muted">{job.cost}</span>
        </div>
        <p className="m-0 text-[13px] font-semibold text-ink">{job.title}</p>
        <p className="m-0 text-[12px] text-muted">{job.desc}</p>
      </div>
      <span className="shrink-0 text-[12px] text-muted">Not now</span>
      <Button variant="secondary" height={28} icon={Edit}>
        Edit
      </Button>
      <Button variant="primary" height={28} onClick={onApprove}>
        Approve
      </Button>
    </div>
  )
}
