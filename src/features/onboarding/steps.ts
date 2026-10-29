/**
 * Single source of truth for the onboarding wizard's steps.
 *
 * `welcome` and `inbox` are pre/post screens with no number; the five
 * NUMBERED_STEPS are what the header stepper and every per-step counter derive
 * from — so "Step N of M" is computed once and can never drift (e.g. the old
 * hardcoded "Step 1 of 4" against a 5-step header).
 */
export type OnboardingStep =
  | 'welcome'
  | 'your-ai'
  | 'know-you'
  | 'profile'
  | 'check'
  | 'team'
  | 'inbox'

export const NUMBERED_STEPS: { id: OnboardingStep; label: string }[] = [
  { id: 'your-ai', label: 'Your AI' },
  { id: 'know-you', label: 'Get to know you' },
  { id: 'profile', label: 'Your company' },
  { id: 'check', label: 'Check' },
  { id: 'team', label: 'Your team' },
]

/** Position of a step in the numbered wizard, or null for welcome/inbox. */
export function stepPosition(step: OnboardingStep): { n: number; total: number } | null {
  const i = NUMBERED_STEPS.findIndex((s) => s.id === step)
  return i < 0 ? null : { n: i + 1, total: NUMBERED_STEPS.length }
}
