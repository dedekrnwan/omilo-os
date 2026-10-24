import { useState } from 'react'
import { ArrowLeft, Sparkles, MapPin } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { Button } from '../../ui/ds/Button'
import { COMPANY_NAME, TEAM_HELPERS } from './data'
import type { TeamHelper } from './data'

interface StepTeamProps {
  onBack: () => void
  onNext: () => void
}

export function StepTeam({ onBack, onNext }: StepTeamProps) {
  const [helpers, setHelpers] = useState<TeamHelper[]>(TEAM_HELPERS)

  function toggleHelper(id: string) {
    setHelpers((prev) =>
      prev.map((h) => (h.id === id && !h.alwaysIncluded ? { ...h, on: !h.on } : h)),
    )
  }

  const activeCount = helpers.filter((h) => h.on).length

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Content */}
      <div className="flex min-h-0 flex-1 flex-col gap-[24px] overflow-y-auto px-[40px] py-[32px]">
        {/* Heading */}
        <div className="flex flex-col gap-[6px]">
          <h2
            className="m-0 font-display text-[26px] font-semibold leading-tight tracking-[-0.4px] text-ink"
            style={{ fontVariationSettings: '"opsz" 96' }}
          >
            Your team for {COMPANY_NAME}
          </h2>
          <p className="m-0 text-[13px] text-muted">
            Picked from your goals. After you create them, each helper proposes its own job, and
            nothing runs until you approve it in Inbox.
          </p>
        </div>

        {/* Helpers list */}
        <div className="flex flex-col gap-[6px]">
          {helpers.map((helper) => (
            <HelperRow
              key={helper.id}
              helper={helper}
              onToggle={() => toggleHelper(helper.id)}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div
        className="flex h-[56px] shrink-0 items-center gap-[12px] px-[40px]"
        style={{ borderTop: '1px solid var(--color-line-strong)' }}
      >
        <Button variant="secondary" icon={ArrowLeft} onClick={onBack}>
          Back
        </Button>
        <span className="flex-1 text-[12px] text-muted">
          {activeCount} helper{activeCount !== 1 ? 's' : ''} · they sleep until they have work
        </span>
        <Button variant="primary" icon={Sparkles} onClick={onNext}>
          Create my team
        </Button>
      </div>
    </div>
  )
}

function HelperRow({ helper, onToggle }: { helper: TeamHelper; onToggle: () => void }) {
  return (
    <div
      className="flex items-center gap-[14px] rounded-lg px-[16px] py-[12px]"
      style={{ border: '1px solid var(--color-line-strong)', background: 'var(--color-surface)' }}
    >
      {/* Avatar */}
      <Mascot size={40} radius={11} area={helper.area} />

      {/* Info */}
      <div className="flex flex-1 flex-col gap-[3px]">
        <div className="flex items-center gap-[8px]">
          <span className="text-[13.5px] font-semibold text-ink">{helper.name}</span>
          <span className="text-[12px] text-muted">{helper.role}</span>
          {helper.alwaysIncluded && (
            <span
              className="rounded-pill px-[7px] py-[1px] text-[11px] font-medium text-muted"
              style={{ background: 'var(--color-soft)', border: '1px solid var(--color-line-strong)' }}
            >
              Always included
            </span>
          )}
          {helper.badge && (
            <span
              className="rounded-pill px-[7px] py-[1px] text-[11px] font-semibold"
              style={{ background: '#DCFCE7', color: '#15803D' }}
            >
              {helper.badge}
            </span>
          )}
        </div>
        <p className="m-0 text-[12.5px] text-muted">{helper.description}</p>
        {helper.reason && (
          <div className="flex items-center gap-[4px] text-[11.5px] text-muted">
            <MapPin size={10} aria-hidden />
            {helper.reason}
          </div>
        )}
      </div>

      {/* Toggle */}
      {helper.alwaysIncluded ? (
        /* Non-interactive "always on" track */
        <div
          aria-label={`${helper.name} always included`}
          className="flex h-[20px] w-[36px] shrink-0 items-center rounded-pill px-[2px]"
          style={{ background: 'var(--color-line-strong)' }}
        >
          <div className="ml-auto size-[16px] rounded-full bg-surface" />
        </div>
      ) : (
        <button
          type="button"
          role="switch"
          aria-checked={helper.on}
          aria-label={`${helper.on ? 'Disable' : 'Enable'} ${helper.name}`}
          onClick={onToggle}
          className="flex h-[20px] w-[36px] shrink-0 items-center rounded-pill px-[2px] transition-colors"
          style={{ background: helper.on ? 'var(--color-primary)' : 'var(--color-line-strong)' }}
        >
          <div
            className="size-[16px] rounded-full bg-surface transition-transform"
            style={{ transform: helper.on ? 'translateX(16px)' : 'translateX(0)' }}
          />
        </button>
      )}
    </div>
  )
}
