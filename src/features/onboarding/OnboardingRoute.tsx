import { useState } from 'react'
import type { ReactNode } from 'react'
import { OnboardingHeader } from './OnboardingHeader'
import type { OnboardingStep } from './OnboardingHeader'
import { StepWelcome } from './StepWelcome'
import { StepYourAI } from './StepYourAI'
import { StepKnowYou } from './StepKnowYou'
import { StepCheck } from './StepCheck'
import { StepTeam } from './StepTeam'
import { StepInbox } from './StepInbox'

/**
 * Standalone full-screen onboarding wizard.
 * Mount at /onboarding — no Shell, no Rail, no sidebars.
 *
 * Step order:
 *   welcome → your-ai → know-you → check → team → inbox
 *
 * The header shows a 4-step breadcrumb (Your AI → Get to know you → Check → Your team)
 * for all steps except welcome and inbox.
 */
export function OnboardingRoute() {
  const [step, setStep] = useState<OnboardingStep>('welcome')

  function advance(to: OnboardingStep) {
    setStep(to)
  }

  return (
    <div
      role="main"
      aria-label="Onboarding"
      className="flex h-svh w-full flex-col overflow-hidden bg-app"
    >
      {/* Top bar */}
      <OnboardingHeader step={step} />

      {/* Card wrapper — welcome & inbox bleed further; other steps share a centred card */}
      {step === 'welcome' || step === 'inbox' ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {step === 'welcome' && (
            <WizardCard wide>
              <StepWelcome onNext={() => advance('your-ai')} />
            </WizardCard>
          )}
          {step === 'inbox' && (
            /* Inbox step fills the full remaining area — it simulates the real app */
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <StepInbox onApproveAll={() => { /* terminal step — in a real app, navigate to /office/inbox */ }} />
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-start justify-center overflow-hidden px-[24px] py-[20px]">
          <WizardCard>
            {step === 'your-ai' && (
              <StepYourAI
                onBack={() => advance('welcome')}
                onNext={() => advance('know-you')}
              />
            )}
            {step === 'know-you' && (
              <StepKnowYou onNext={() => advance('check')} />
            )}
            {step === 'check' && (
              <StepCheck
                onBack={() => advance('know-you')}
                onNext={() => advance('team')}
              />
            )}
            {step === 'team' && (
              <StepTeam
                onBack={() => advance('check')}
                onNext={() => advance('inbox')}
              />
            )}
          </WizardCard>
        </div>
      )}
    </div>
  )
}

/** White rounded card that hosts wizard steps. `wide` fills the screen width. */
function WizardCard({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  if (wide) {
    return (
      <div
        className="mx-auto my-[20px] flex min-h-0 w-full max-w-[860px] flex-1 flex-col overflow-hidden rounded-[20px] bg-surface"
        style={{ boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 0 0 1px var(--color-line-strong)' }}
      >
        {children}
      </div>
    )
  }

  return (
    <div
      className="flex min-h-0 w-full max-w-[900px] flex-1 flex-col overflow-hidden rounded-[20px] bg-surface"
      style={{ boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 0 0 1px var(--color-line-strong)' }}
    >
      {children}
    </div>
  )
}
