import { useEffect, useState } from 'react'
import { useSearch, useNavigate } from '@tanstack/react-router'
import { OnboardingHeader } from './OnboardingHeader'
import type { OnboardingStep } from './OnboardingHeader'
import type { AIMode } from './data'
import { StepWelcome } from './StepWelcome'
import { StepYourAI } from './StepYourAI'
import { StepKnowYou } from './StepKnowYou'
import { StepProfile } from './StepProfile'
import type { ProfileData } from './StepProfile'
import { StepCheck } from './StepCheck'
import { StepTeam } from './StepTeam'
import { StepInbox } from './StepInbox'
import { capture } from '../../telemetry'
import { isMockMode } from '../../app/useAuth'
import { createCommands } from '../../adapters/http/commands'
import { platform } from '../../platform'
import { useUIStore, MODE_HOME } from '../../app/store'

/**
 * localStorage key for the client-side "onboarded" flag.
 *
 * NOTE (design choice): there is no backend-side "onboarded" field in the
 * current API. We persist this flag in localStorage so returning users are
 * not forced back through the wizard on every reload. This is intentionally a
 * client-side flag — if the user clears localStorage or logs in on a different
 * browser they will see the wizard again. A future backend change can promote
 * this to a proper server field; until then localStorage is the source of truth.
 */
export const ONBOARDED_KEY = 'omilo_onboarded'

const STEPS: OnboardingStep[] = ['welcome', 'your-ai', 'know-you', 'profile', 'check', 'team', 'inbox']

const BASE_URL = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ?? 'http://localhost:8000'
function getToken(): string | null {
  return platform.tokenStorage.getToken()
}

/**
 * Standalone full-screen onboarding wizard at /onboarding (no Shell).
 * Step order: welcome → your-ai → know-you → profile → check → team → inbox.
 * `?step=<id>` opens a step directly; `?mode=cloud` opens Your AI on Cloud.
 * The last step (first Inbox) is the real app layout, so it has no wizard header.
 *
 * On mount: if localStorage has `omilo_onboarded=1`, redirect straight to the
 * app home so returning users are never trapped in the wizard.
 *
 * On finish: call updateCompanyProfile with collected profile fields (skipped in
 * mock mode), set the onboarded flag in localStorage, then navigate to the app.
 */
export function OnboardingRoute() {
  const search = useSearch({ strict: false }) as { step?: string; mode?: string }
  const navigate = useNavigate()
  const initial = STEPS.includes(search.step as OnboardingStep) ? (search.step as OnboardingStep) : 'welcome'
  const [step, setStep] = useState<OnboardingStep>(initial)
  const initialMode: AIMode = search.mode === 'cloud' ? 'cloud' : 'self-host'
  const [profileData, setProfileData] = useState<ProfileData | null>(null)

  // Redirect already-onboarded users immediately (before rendering the wizard).
  useEffect(() => {
    if (localStorage.getItem(ONBOARDED_KEY) === '1') {
      const home = MODE_HOME[useUIStore.getState().mode]
      void navigate({ to: home })
    }
  }, [navigate])

  function goToStep(next: OnboardingStep) {
    capture('onboarding_step', { step: next })
    setStep(next)
  }

  async function completeOnboarding() {
    capture('onboarding_completed', {})

    // Persist profile to backend (skipped in mock mode — no real server).
    if (!isMockMode() && profileData) {
      try {
        const commands = createCommands(BASE_URL, getToken)
        await commands.updateCompanyProfile({
          industry: profileData.industry,
          teamSize: profileData.teamSize,
          region: profileData.region,
          currency: profileData.currency,
          picRole: profileData.picRole,
        })
      } catch {
        // Non-fatal: profile can be updated later in settings.
      }
    }

    // Mark the user as onboarded so they won't see the wizard again.
    localStorage.setItem(ONBOARDED_KEY, '1')

    // Navigate into the app.
    void navigate({ to: MODE_HOME[useUIStore.getState().mode] })
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
          {step === 'profile' && (
            <StepProfile
              onNext={() => goToStep('check')}
              onProfileChange={(data) => setProfileData(data)}
            />
          )}
          {step === 'check' && <StepCheck onBack={() => goToStep('profile')} onNext={() => goToStep('team')} />}
          {step === 'team' && <StepTeam onBack={() => goToStep('check')} onNext={() => void completeOnboarding()} />}
        </>
      )}
    </div>
  )
}
