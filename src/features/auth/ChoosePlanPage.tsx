/** Choose plan — /auth/onboarding/plan (pen eWPwo). */
import { useState } from 'react'
import { Check, Server, Sparkles } from 'lucide-react'
import { OnboardingLayout } from './AuthLayout'
import { AuthButton } from './AuthPrimitives'

interface Plan {
  name: string
  price: string
  per: string
  desc: string
  cta: string
  features: string[]
  recommended?: boolean
}

const PLANS: Plan[] = [
  {
    name: 'Starter',
    price: 'Free',
    per: 'forever',
    desc: 'For trying Omilo with one area.',
    cta: 'Start free',
    features: ['1 seat', 'Chief + 1 agent', '100 runs a month', 'Docs & chat'],
  },
  {
    name: 'Team',
    price: '$39',
    per: 'per month, billed yearly',
    desc: 'For small teams running real work.',
    cta: 'Start 14-day trial',
    features: ['5 seats', 'All agents & flows', 'Knowledge (pgvector)', '$20 AI credit every month', 'Email support'],
    recommended: true,
  },
  {
    name: 'Business',
    price: '$159',
    per: 'per month, billed yearly',
    desc: 'For companies with many areas.',
    cta: 'Start 14-day trial',
    features: ['25 seats', 'Everything in Team', 'Google domain sign-in', '1-year activity log', 'Priority support'],
  },
]

function PlanCard({ plan }: { plan: Plan }) {
  const rec = !!plan.recommended
  return (
    <section
      aria-label={plan.name}
      className="flex min-w-0 flex-1 flex-col gap-[16px] self-start rounded-[16px] bg-surface p-[24px]"
      style={{
        boxShadow: rec
          ? 'inset 0 0 0 2px #171717, 0 12px 32px #0C0A0914'
          : 'inset 0 0 0 1px var(--color-line-strong)',
      }}
    >
      <div className="flex w-full items-center">
        <h2 className="flex-1 text-[15px] font-semibold text-ink">{plan.name}</h2>
        {rec && (
          <span className="rounded-pill bg-primary px-[9px] py-[3px] text-[11px] font-semibold text-white">Recommended</span>
        )}
      </div>
      <div className="flex flex-col gap-[2px]">
        <span className="font-display text-[34px] font-semibold tracking-[-0.8px] text-ink">{plan.price}</span>
        <span className="text-[12.5px] text-muted">{plan.per}</span>
      </div>
      <p className="w-full text-[13px] text-ink-2">{plan.desc}</p>
      <AuthButton
        variant={rec ? 'primary' : 'secondary'}
        height={40}
        to="/auth/onboarding/payment"
      >
        {plan.cta}
      </AuthButton>
      <span className="h-px w-full bg-line" />
      <ul className="flex w-full flex-col gap-[9px]">
        {plan.features.map((f) => (
          <li key={f} className="flex items-center gap-[8px]">
            <Check size={14} aria-hidden className={rec ? 'text-ink' : 'text-muted'} />
            <span className="text-[13px] text-ink-2">{f}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ChoosePlanPage() {
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('yearly')
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
  return (
    <OnboardingLayout step={3}>
      <div className="flex w-[1080px] flex-col items-center gap-[22px]">
        <div className="flex w-full flex-col items-center gap-[6px]">
          <h1 className="font-display text-[30px] font-semibold tracking-[-0.6px] text-ink">
            Choose a plan for Sahabat Warga
          </h1>
          <p className="text-center text-[14px] text-muted">14-day free trial on paid plans. Change or cancel any time.</p>
        </div>
        <div role="radiogroup" aria-label="Billing" className="flex gap-[2px] rounded-base bg-[#E7E5E4] p-[2px]">
          {seg('monthly', 'Monthly')}
          {seg('yearly', 'Yearly · save 20%')}
        </div>
        <div className="flex w-full gap-[16px]">
          {PLANS.map((p) => (
            <PlanCard key={p.name} plan={p} />
          ))}
        </div>
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
