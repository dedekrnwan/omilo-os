import { useEffect, useState } from 'react'
import { useSearch, useNavigate } from '@tanstack/react-router'
import { OnboardingHeader } from './OnboardingHeader'
import type { OnboardingStep } from './OnboardingHeader'
import type { AIMode } from './data'
import { StepWelcome } from './StepWelcome'
import { StepYourAI } from './StepYourAI'
import { StepKnowYou } from './StepKnowYou'
import { getProfileSuggestion } from './interviewApi'
import { StepCheck } from './StepCheck'
import { StepTeam } from './StepTeam'
import type { AiSelection } from './StepYourAI'
import { StepInbox } from './StepInbox'
import type { TeamHelper } from './data'
import { capture } from '../../telemetry'
import { isMockMode } from '../../app/useAuth'
import { createCommands } from '../../adapters/http/commands'
import { platform } from '../../platform'
import { useUIStore, MODE_HOME } from '../../app/store'
import { useSession } from '../../app/session'

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

const STEPS: OnboardingStep[] = ['welcome', 'your-ai', 'know-you', 'check', 'team', 'inbox']

const BASE_URL = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ?? 'http://localhost:8000'
function getToken(): string | null {
  return platform.tokenStorage.getToken()
}

/**
 * Standalone full-screen onboarding wizard at /onboarding (no Shell).
 * Step order: welcome → your-ai → know-you → check → team → inbox.
 * `?step=<id>` opens a step directly; `?mode=cloud` opens Your AI on Cloud.
 * The last step (first Inbox) is the real app layout, so it has no wizard header.
 *
 * On mount: if localStorage has `omilo_onboarded=1`, redirect straight to the
 * app home so returning users are never trapped in the wizard.
 *
 * On finish: write the company profile Chief inferred from the interview (skipped in
 * mock mode), set the onboarded flag in localStorage, then navigate to the app.
 */
export function OnboardingRoute() {
  const search = useSearch({ strict: false }) as { step?: string; mode?: string }
  const navigate = useNavigate()
  const initial = STEPS.includes(search.step as OnboardingStep) ? (search.step as OnboardingStep) : 'welcome'
  const [step, setStep] = useState<OnboardingStep>(initial)
  const initialMode: AIMode = search.mode === 'cloud' ? 'cloud' : 'self-host'
  const [aiSelection, setAiSelection] = useState<AiSelection | null>(null)

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

  async function completeOnboarding(selectedHelpers?: TeamHelper[]) {
    capture('onboarding_completed', { aiMode: aiSelection?.mode })

    if (!isMockMode()) {
      const commands = createCommands(BASE_URL, getToken)

      // Create the helpers the owner picked on StepTeam. The Chief already exists
      // (created with the company), so it is never created twice. Non-fatal per
      // helper so one failure doesn't block finishing onboarding.
      const picked = (selectedHelpers ?? []).filter((h) => h.id !== 'chief')
      if (typeof commands.createHelper === 'function') {
        for (const h of picked) {
          try {
            await commands.createHelper({
              name: h.name,
              area: h.area,
              role: h.role,
              jobDescription: h.reason ? `${h.description}\n\nWhy: ${h.reason}` : h.description,
              isChief: false,
            })
          } catch {
            // Non-fatal: a helper can be hired later from the Team screen.
          }
        }
      }

      // Company profile (industry, team size, region, currency, role) comes from
      // the interview: Chief infers it from the notes the owner just checked.
      // Only grounded fields are written; non-fatal — editable later in Company settings.
      try {
        const guess = await getProfileSuggestion()
        const profile = Object.fromEntries(Object.entries(guess).filter(([, v]) => Boolean(v)))
        if (Object.keys(profile).length > 0) await commands.updateCompanyProfile(profile)
      } catch {
        // Non-fatal: profile can be updated later in settings.
      }

      // Set the backend onboarded flag (idempotent) and update the session so
      // AuthGate won't redirect back to /onboarding after navigation.
      try {
        await commands.onboardCompany()
        // Patch the session store so the gate sees onboarded=true immediately.
        const currentCompany = useSession.getState().company
        if (currentCompany) {
          useSession.setState({ company: { ...currentCompany, onboarded: true } })
        }
      } catch {
        // Non-fatal: gate will not bounce if localStorage flag is also set.
      }
    }

    // Mark the user as onboarded (secondary localStorage signal — fast and offline-safe).
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
            <StepYourAI
              initialMode={initialMode}
              onBack={() => goToStep('welcome')}
              onNext={(selection) => {
                if (selection) setAiSelection(selection)
                goToStep('know-you')
              }}
            />
          )}
          {step === 'know-you' && <StepKnowYou onNext={() => goToStep('check')} onBack={() => goToStep('your-ai')} />}
          {step === 'check' && <StepCheck onBack={() => goToStep('know-you')} onNext={() => goToStep('team')} />}
          {step === 'team' && (
            <StepTeam
              onBack={() => goToStep('check')}
              onNext={(selectedHelperIds) => void completeOnboarding(selectedHelperIds)}
            />
          )}
        </>
      )}
    </div>
  )
}
