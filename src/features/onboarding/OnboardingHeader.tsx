import { Check, LogOut } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Mascot } from '../../ui/ds/Mascot'
import { QuietButton } from './parts'
import { useSession } from '../../app/session'

export type OnboardingStep = 'welcome' | 'your-ai' | 'know-you' | 'profile' | 'check' | 'team' | 'inbox'

const STEPS: { id: OnboardingStep; label: string }[] = [
  { id: 'your-ai', label: 'Your AI' },
  { id: 'know-you', label: 'Get to know you' },
  { id: 'profile', label: 'Your company' },
  { id: 'check', label: 'Check' },
  { id: 'team', label: 'Your team' },
]

/** pen onboarding Stepper: done = brand dot + check, active = primary dot, todo = outlined. */
function StepIndicator({ current }: { current: OnboardingStep }) {
  const currentIdx = STEPS.findIndex((s) => s.id === current)
  return (
    <nav aria-label="Onboarding steps" className="flex items-center gap-[8px]">
      {STEPS.map((step, idx) => {
        const done = idx < currentIdx
        const active = idx === currentIdx
        return (
          <div key={step.id} className="flex items-center gap-[8px]">
            {idx > 0 && (
              <span
                aria-hidden
                className="h-[2px] w-[28px] rounded-[1px]"
                style={{ background: idx <= currentIdx ? 'var(--color-helper-brand)' : 'var(--color-line-strong)' }}
              />
            )}
            <div className="flex items-center gap-[6px]" aria-current={active ? 'step' : undefined}>
              <span
                aria-hidden
                className={`flex size-[22px] shrink-0 items-center justify-center rounded-full ${
                  done ? 'bg-helper-brand' : active ? 'bg-primary' : ''
                }`}
                style={done || active ? undefined : { boxShadow: 'inset 0 0 0 1.5px var(--color-line-strong)' }}
              >
                {done ? (
                  <Check size={11} className="text-primary-ink" />
                ) : (
                  <span className={`text-[11px] font-semibold ${active ? 'text-primary-ink' : 'text-muted'}`}>
                    {idx + 1}
                  </span>
                )}
              </span>
              <span
                className={`text-[13px] ${active ? 'font-semibold text-ink' : done ? 'font-medium text-ink' : 'font-medium text-muted'}`}
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

/** pen onboarding `Top`: h-60 · px 24 · gap 10 — spark mark, company, stepper, saved + log out. */
export function OnboardingHeader({ step }: { step: OnboardingStep }) {
  const showSteps = step !== 'welcome' && step !== 'inbox'
  const navigate = useNavigate()
  const companyName = useSession((s) => s.company?.name ?? 'your workspace')
  const stepIdx = STEPS.findIndex((s) => s.id === step)
  return (
    <header className="flex h-[60px] w-full shrink-0 items-center gap-[10px] px-[16px] sm:px-[24px]">
      <Mascot size={26} radius={7} prop="spark" title="Omilo" />
      <span className="font-display text-[15px] font-semibold text-ink">Omilo</span>
      <span className="hidden min-w-0 truncate text-[13px] text-muted sm:inline">· Setting up {companyName}</span>
      <div className="flex min-w-0 flex-1 justify-center">
        {showSteps && (
          <>
            {/* Full stepper on wide screens; a compact counter on narrow ones. */}
            <div className="hidden lg:block">
              <StepIndicator current={step} />
            </div>
            {stepIdx >= 0 && (
              <span className="text-[12px] font-medium text-muted lg:hidden">
                Step {stepIdx + 1} of {STEPS.length}
              </span>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-[8px] sm:gap-[12px]">
        <span className="hidden text-[12px] text-muted sm:inline">Saved as you go</span>
        <QuietButton icon={LogOut} onClick={() => navigate({ to: '/auth/sign-in' })}>
          Log out
        </QuietButton>
      </div>
    </header>
  )
}
