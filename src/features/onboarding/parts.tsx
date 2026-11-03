/**
 * Small pen components used across the onboarding steps:
 * Button/Primary (h-40), Button/Quiet (p38fT), Icon Tile (vwHMT),
 * Chip/Neutral (KMRv6), Chip/Run (y85gB), Radio On/Off, Switch On/Off,
 * suggestion pills, and the 1120×720 wizard card.
 */
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { stepPosition } from './steps'
import type { OnboardingStep } from './steps'

/**
 * Chief mascot + a dynamic "Step N of M" label, derived from the single
 * NUMBERED_STEPS source so the per-step counter can never drift from the header.
 * Renders just the mascot for non-numbered steps (welcome/inbox).
 */
export function StepEyebrow({ step }: { step: OnboardingStep }) {
  const pos = stepPosition(step)
  return (
    <div className="flex items-center gap-[10px]">
      <Mascot helper area="brand" size={24} radius={7} title="Chief of Staff" />
      {pos && <span className="text-[12px] text-muted">Step {pos.n} of {pos.total}</span>}
    </div>
  )
}

export function PrimaryButton({
  icon: Icon,
  children,
  px = 18,
  onClick,
}: {
  icon?: LucideIcon
  children: ReactNode
  px?: number
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[40px] shrink-0 items-center justify-center gap-[6px] rounded-btn bg-primary text-[14px] font-medium text-primary-ink transition-colors hover:bg-primary-hover"
      style={{ paddingInline: px }}
    >
      {Icon && <Icon size={16} aria-hidden />}
      {children}
    </button>
  )
}

/** pen Button/Quiet: h-32 · px 14 · gap 6 · icon 16 muted · label 14 muted. */
export function QuietButton({
  icon: Icon,
  children,
  onClick,
}: {
  icon?: LucideIcon
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[32px] shrink-0 items-center justify-center gap-[6px] rounded-btn px-[14px] text-[14px] text-muted transition-colors hover:bg-hover"
    >
      {Icon && <Icon size={16} aria-hidden />}
      {children}
    </button>
  )
}

/** pen Icon Tile: 32 · radius 10 · soft fill · 1px line · icon 16 ink-2. */
export function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-[32px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line">
      <Icon size={16} aria-hidden className="text-ink-2" />
    </span>
  )
}

export function ChipNeutral({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-[22px] shrink-0 items-center gap-[4px] rounded-sm bg-soft px-[8px] text-[12px] font-medium text-ink-2 outline-1 -outline-offset-1 outline-line-strong">
      {children}
    </span>
  )
}

export function ChipInfo({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-[22px] shrink-0 items-center gap-[4px] rounded-sm bg-info-tint px-[8px] text-[12px] font-medium text-info outline-1 -outline-offset-1 outline-info-line">
      {children}
    </span>
  )
}

export function Radio({ on }: { on: boolean }) {
  return on ? (
    <span aria-hidden className="flex size-[16px] shrink-0 items-center justify-center rounded-full bg-primary">
      <span className="size-[6px] rounded-full bg-primary-ink" />
    </span>
  ) : (
    <span
      aria-hidden
      className="size-[16px] shrink-0 rounded-full bg-surface outline-1 -outline-offset-1 outline-[#A8A29E]"
    />
  )
}

export function Switch({
  on,
  label,
  disabled = false,
  onChange,
}: {
  on: boolean
  label: string
  disabled?: boolean
  onChange?: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      className={`flex h-[18px] w-[32px] shrink-0 rounded-[9px] p-[2px] ${on ? 'justify-end bg-primary' : 'bg-line-strong'} ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <span className="size-[14px] rounded-full bg-white" style={{ boxShadow: '0 1px 2px #0000002E' }} />
    </button>
  )
}

/** Suggestion pill (Suggest · …): surface · pill · 1px line-strong · 6/10 · 12 ink-2. */
export function Pill({ icon: Icon, children, onClick }: { icon?: LucideIcon; children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-[6px] rounded-pill bg-surface px-[10px] py-[6px] text-[12px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
    >
      {Icon && <Icon size={13} aria-hidden className="text-muted" />}
      {children}
    </button>
  )
}

/** A 1px inside stroke painted above the children (pen strokes draw on top). */
export function Stroke({ color = 'var(--color-line-strong)', width = 1 }: { color?: string; width?: number }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-[inherit]"
      style={{ boxShadow: `inset 0 0 0 ${width}px ${color}` }}
    />
  )
}

/**
 * The centred wizard card. On desktop (lg+) it's a fixed 1120×720 two-column
 * panel whose columns scroll internally. Below lg the two columns STACK and the
 * card grows to its content and scrolls as one — so a long step (e.g. the AI
 * step with many detected harnesses) is never clipped on a narrow or short
 * viewport.
 *
 * `stack` keeps it a single column at every width (header → content → footer),
 * for the full-width steps: Your company, Check, Your team. Without it the
 * built-in `lg:flex-row` lays those children side by side on desktop.
 */
export function WizardCard({
  children,
  className = '',
  stack = false,
}: {
  children: ReactNode
  className?: string
  stack?: boolean
}) {
  const layout = stack
    ? 'gap-[18px] px-[20px] py-[24px] sm:px-[40px] sm:py-[32px]'
    : 'lg:flex-row lg:overflow-hidden'
  return (
    <div className="flex min-h-0 w-full flex-1 items-center justify-center px-[16px] pt-[8px] pb-[16px] sm:px-[24px] sm:pb-[24px]">
      <section
        className={`relative flex min-h-0 w-[1120px] max-h-full max-w-full flex-col overflow-y-auto overscroll-contain rounded-lg bg-surface lg:h-[720px] ${layout} ${className}`}
        style={{ boxShadow: '0 12px 40px #0C0A0914' }}
      >
        {children}
        <Stroke />
      </section>
    </div>
  )
}
