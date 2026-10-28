/** Choose plan — /auth/onboarding/plan (pen eWPwo). */
import { useState } from 'react'
import { Check, Server, Sparkles } from 'lucide-react'
import { OnboardingLayout } from './AuthLayout'
import { AuthButton } from './AuthPrimitives'
import { usePlans } from '../../app/queries'
import { isMockMode } from '../../app/useAuth'
import { getCommands } from '../control-panel/sections/getCommands'
import type { BillingPlan } from '../../core/domain/types'

function formatIdr(amount: number): string {
  return `Rp ${amount.toLocaleString('id-ID')}`
}

interface PlanCardProps {
  plan: BillingPlan
  billing: 'monthly' | 'yearly'
  onSubscribe: () => void
  loading: boolean
}

function PlanCard({ plan, billing, onSubscribe, loading }: PlanCardProps) {
  const price = billing === 'yearly' ? plan.yearlyPriceIdr : plan.monthlyPriceIdr
  const perLabel =
    billing === 'yearly'
      ? 'per month, billed yearly · ≈ 2 months free'
      : 'per month'
  const trialLabel =
    plan.trialDays > 0 ? `Start ${plan.trialDays}-day trial` : 'Subscribe'

  return (
    <section
      aria-label={plan.name}
      className="flex min-w-0 flex-1 flex-col gap-[16px] self-start rounded-[16px] bg-surface p-[24px]"
      style={{
        boxShadow: 'inset 0 0 0 2px #171717, 0 12px 32px #0C0A0914',
      }}
    >
      <div className="flex w-full items-center">
        <h2 className="flex-1 text-[15px] font-semibold text-ink">{plan.name}</h2>
        <span className="rounded-pill bg-primary px-[9px] py-[3px] text-[11px] font-semibold text-white">
          Recommended
        </span>
      </div>
      <div className="flex flex-col gap-[2px]">
        <span className="font-display text-[34px] font-semibold tracking-[-0.8px] text-ink">
          {formatIdr(price)}
        </span>
        <span className="text-[12.5px] text-muted">{perLabel}</span>
      </div>
      <p className="w-full text-[13px] text-ink-2">
        For teams running real work with AI agents.
      </p>
      <AuthButton
        variant="primary"
        height={40}
        onClick={onSubscribe}
        disabled={loading}
      >
        {loading ? 'Redirecting…' : trialLabel}
      </AuthButton>
      <span className="h-px w-full bg-line" />
      <ul className="flex w-full flex-col gap-[9px]">
        {[
          `${plan.seats} seats`,
          'All agents & flows',
          'Knowledge (pgvector)',
          `${plan.includedCredits.toLocaleString()} AI credits / month`,
          'Email support',
        ].map((f) => (
          <li key={f} className="flex items-center gap-[8px]">
            <Check size={14} aria-hidden className="text-ink" />
            <span className="text-[13px] text-ink-2">{f}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ChoosePlanPage() {
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('yearly')
  const [loading, setLoading] = useState(false)

  const { data: plans = [], isLoading: plansLoading } = usePlans()
  const cloudPlan = plans.find((p) => p.tier === 'cloud') ?? plans[0]

  const mock = isMockMode()

  const seg = (id: 'monthly' | 'yearly', label: string) => {
    const on = billing === id
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => setBilling(id)}
        className={`flex h-[28px] items-center rounded-sm px-[10px] text-[12px] font-medium ${
          on ? 'bg-surface text-ink' : 'text-muted'
        }`}
        style={on ? { boxShadow: '0 1px 2px #00000014' } : undefined}
      >
        {label}
      </button>
    )
  }

  async function handleSubscribe() {
    if (!cloudPlan) return
    if (mock) {
      // In mock mode, navigate into the app without a real network call.
      window.location.assign('/')
      return
    }
    setLoading(true)
    try {
      const result = await getCommands().changePlan(cloudPlan.id, billing)
      const res = result as Record<string, unknown>
      if (typeof res.hosted_url === 'string' && res.hosted_url) {
        window.location.assign(res.hosted_url)
      } else {
        window.location.assign('/')
      }
    } catch {
      setLoading(false)
    }
  }

  return (
    <OnboardingLayout step={3}>
      <div className="flex w-[720px] flex-col items-center gap-[22px]">
        <div className="flex w-full flex-col items-center gap-[6px]">
          <h1 className="font-display text-[30px] font-semibold tracking-[-0.6px] text-ink">
            Choose a plan
          </h1>
          <p className="text-center text-[14px] text-muted">
            14-day free trial. Change or cancel any time.
          </p>
        </div>
        <div role="radiogroup" aria-label="Billing" className="flex gap-[2px] rounded-base bg-[#E7E5E4] p-[2px]">
          {seg('monthly', 'Monthly')}
          {seg('yearly', 'Yearly · save 20%')}
        </div>

        {plansLoading && (
          <div className="animate-pulse h-[320px] w-full max-w-[360px] rounded-[16px] bg-soft" />
        )}

        {!plansLoading && cloudPlan && (
          <div className="flex w-full max-w-[360px]">
            <PlanCard
              plan={cloudPlan}
              billing={billing}
              onSubscribe={handleSubscribe}
              loading={loading}
            />
          </div>
        )}

        <div className="flex items-center gap-[18px]">
          <span className="flex items-center gap-[6px] text-[12.5px] text-muted">
            <Sparkles size={13} aria-hidden />
            AI usage billed at cost — or bring your own Anthropic key
          </span>
          <span className="flex items-center gap-[6px] text-[12.5px] text-muted">
            <Server size={13} aria-hidden />
            Self-hosting? The open-source version needs no plan
          </span>
        </div>
      </div>
    </OnboardingLayout>
  )
}
