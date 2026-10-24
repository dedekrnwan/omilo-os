import { LogOut } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { COMPANY_NAME } from './data'

export type OnboardingStep = 'welcome' | 'your-ai' | 'know-you' | 'check' | 'team' | 'inbox'

const STEPS: { id: OnboardingStep; label: string }[] = [
  { id: 'your-ai', label: 'Your AI' },
  { id: 'know-you', label: 'Get to know you' },
  { id: 'check', label: 'Check' },
  { id: 'team', label: 'Your team' },
]

function StepIndicator({
  steps,
  current,
}: {
  steps: { id: OnboardingStep; label: string }[]
  current: OnboardingStep
}) {
  const currentIdx = steps.findIndex((s) => s.id === current)

  return (
    <nav aria-label="Onboarding steps" className="flex items-center gap-[6px]">
      {steps.map((step, idx) => {
        const done = idx < currentIdx
        const active = idx === currentIdx
        return (
          <div key={step.id} className="flex items-center gap-[6px]">
            {idx > 0 && (
              <div
                aria-hidden
                className="h-px w-[20px]"
                style={{ background: done ? 'var(--color-primary)' : 'var(--color-line-strong)' }}
              />
            )}
            <div className="flex items-center gap-[6px]">
              <div
                aria-hidden
                className="flex size-[20px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                style={{
                  background: active
                    ? 'var(--color-primary)'
                    : done
                      ? 'var(--color-primary)'
                      : 'var(--color-line-strong)',
                  color: active || done ? 'var(--color-primary-ink)' : 'var(--color-muted)',
                }}
              >
                {idx + 1}
              </div>
              <span
                className="text-[12.5px]"
                style={{
                  fontWeight: active ? 500 : 400,
                  color: active
                    ? 'var(--color-ink)'
                    : done
                      ? 'var(--color-ink-2)'
                      : 'var(--color-muted)',
                }}
              >
                {step.label}
              </span>
            </div>
          </div>
        )
      })}
    </nav>
  )
}

interface OnboardingHeaderProps {
  step: OnboardingStep
}

export function OnboardingHeader({ step }: OnboardingHeaderProps) {
  const showStepper = step !== 'welcome' && step !== 'inbox'

  return (
    <header
      className="flex h-[44px] w-full shrink-0 items-center gap-[12px] px-[20px]"
      style={{ borderBottom: '1px solid var(--color-line-strong)' }}
    >
      {/* Brand */}
      <div className="flex items-center gap-[8px]">
        <Mascot size={24} radius={6} area="brand" tile={false} />
        <span className="text-[13px] font-semibold text-ink">Omilo</span>
      </div>

      {step !== 'inbox' && (
        <span className="text-[12.5px] text-muted">
          Setting up {COMPANY_NAME}
        </span>
      )}

      <div className="flex-1" />

      {showStepper && (
        <StepIndicator steps={STEPS} current={step} />
      )}

      <div className="flex-1" />

      <span className="text-[12.5px] text-muted">Saved as you go</span>

      <button
        type="button"
        className="flex items-center gap-[5px] rounded-btn px-[8px] py-[4px] text-[12.5px] text-muted transition-colors hover:bg-hover"
      >
        <LogOut size={13} aria-hidden />
        Log out
      </button>
    </header>
  )
}
