import { useState } from 'react'
import { useSearch } from '@tanstack/react-router'
import { OnboardingHeader } from './OnboardingHeader'
import type { OnboardingStep } from './OnboardingHeader'
import type { AIMode } from './data'
import { StepWelcome } from './StepWelcome'
import { StepYourAI } from './StepYourAI'
import { StepKnowYou } from './StepKnowYou'
import { StepProfile } from './StepProfile'
import { StepCheck } from './StepCheck'
import { StepTeam } from './StepTeam'
import { StepInbox } from './StepInbox'
import { capture } from '../../telemetry'

const STEPS: OnboardingStep[] = ['welcome', 'your-ai', 'know-you', 'profile', 'check', 'team', 'inbox']

/**
 * Standalone full-screen onboarding wizard at /onboarding (no Shell).
 * Step order: welcome → your-ai → know-you → check → team → inbox.
 * `?step=<id>` opens a step directly; `?mode=cloud` opens Your AI on Cloud.
 * The last step (first Inbox) is the real app layout, so it has no wizard header.
 */
export function OnboardingRoute() {
  const search = useSearch({ strict: false }) as { step?: string; mode?: string }
  const initial = STEPS.includes(search.step as OnboardingStep) ? (search.step as OnboardingStep) : 'welcome'
  const [step, setStep] = useState<OnboardingStep>(initial)
  const initialMode: AIMode = search.mode === 'cloud' ? 'cloud' : 'self-host'

  function goToStep(next: OnboardingStep) {
    capture('onboarding_step', { step: next })
    setStep(next)
  }

  function completeOnboarding() {
    capture('onboarding_completed', {})
    setStep('inbox')
  }

  return (
    <div role="main" aria-label="Onboarding" className="flex h-svh w-full flex-col overflow-hidden bg-app">
      {step === 'inbox' ? (
        <StepInbox />
      ) : (
        <>
          <OnboardingHeader step={step} />
          {step === 'welcome' && <StepWelcome onNext={() => goToStep('your-ai')} />}
          {step === 'your-ai' && (
            <StepYourAI initialMode={initialMode} onBack={() => goToStep('welcome')} onNext={() => goToStep('know-you')} />
          )}
          {step === 'know-you' && <StepKnowYou onNext={() => goToStep('profile')} />}
          {step === 'profile' && <StepProfile onNext={() => goToStep('check')} />}
          {step === 'check' && <StepCheck onBack={() => goToStep('profile')} onNext={() => goToStep('team')} />}
          {step === 'team' && <StepTeam onBack={() => goToStep('check')} onNext={completeOnboarding} />}
        </>
      )}
    </div>
  )
}
