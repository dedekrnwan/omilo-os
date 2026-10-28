/** Payment — /auth/onboarding/payment (pen rK2oH). */
import { useState } from 'react'
import { CreditCard, Globe, Lock, ShieldCheck } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { OnboardingLayout } from './AuthLayout'
import { AuthButton, AuthField, AuthSelect } from './AuthPrimitives'

const COUNTRIES = ['Indonesia', 'Singapore', 'Malaysia', 'Philippines', 'Thailand', 'Vietnam', 'United States']

const LINES: { k: string; v: string; tone?: 'ok'; strong?: boolean; rule?: boolean }[] = [
  { k: 'Team plan, 12 × $49', v: '$588' },
  { k: 'Yearly discount (20%)', v: '−$118', tone: 'ok' },
  { k: 'AI credit', v: '$20 / month included', rule: true },
  { k: 'Due today', v: '$0', strong: true },
  { k: 'From Nov 7, 2026', v: '$470 / year' },
]

export function PaymentPage() {
  const [country, setCountry] = useState('Indonesia')
  return (
    <OnboardingLayout step={4}>
      <div className="flex w-[920px] gap-[24px]">
        <div className="flex min-w-0 flex-1 flex-col gap-[16px]">
          <div className="flex flex-col gap-[6px]">
            <h1 className="font-display text-[28px] font-semibold tracking-[-0.6px] text-ink">Start your free trial</h1>
            <p className="text-[14px] text-muted">
              You won’t be charged until Nov 7. Cancel before then and you pay nothing.
            </p>
          </div>
          <div className="flex w-full flex-col gap-[14px] rounded-[16px] bg-surface p-[24px] outline-1 -outline-offset-1 outline-line-strong">
            <AuthField id="card" label="Card number" icon={CreditCard} defaultValue="4242 4242 4242 4242" inputMode="numeric" />
            <div className="flex w-full gap-[12px]">
              <AuthField id="expiry" label="Expiry" defaultValue="08 / 28" />
              <AuthField id="cvc" label="CVC" icon={Lock} defaultValue="•••" />
            </div>
            <AuthField id="name-on-card" label="Name on card" defaultValue="Dede Kurniawan" />
            <div className="flex w-full gap-[12px]">
              <AuthSelect id="country" label="Country" icon={Globe} options={COUNTRIES} value={country} onChange={setCountry} />
              <AuthField id="tax-id" label="Tax ID (optional)" defaultValue="NPWP" />
            </div>
            <p className="flex items-center gap-[6px] text-[12px] text-muted">
              <ShieldCheck size={13} aria-hidden />
              Payments by Stripe. We never see your full card number.
            </p>
          </div>
        </div>
        <aside className="flex w-[340px] shrink-0 flex-col gap-[14px] self-start rounded-[16px] bg-surface p-[24px] outline-1 -outline-offset-1 outline-line-strong">
          <div className="flex w-full items-center">
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-[15px] font-semibold text-ink">Team · yearly</span>
              <span className="text-[12.5px] text-muted">5 seats · all agents</span>
            </div>
            <Link to="/auth/onboarding/plan" className="text-[12.5px] font-medium text-link hover:underline">
              Change
            </Link>
          </div>
          <span className="h-px w-full bg-line" />
          {LINES.map((l) => (
            <div key={l.k} className="contents">
              <div className={`flex w-full items-center text-[13px] ${l.strong ? 'font-semibold' : ''}`}>
                <span className={`flex-1 ${l.strong ? 'text-ink' : 'text-ink-2'}`}>{l.k}</span>
                <span className={l.tone === 'ok' ? 'text-ok' : 'text-ink'}>{l.v}</span>
              </div>
              {l.rule && <span className="h-px w-full bg-line" />}
            </div>
          ))}
          <AuthButton to="/auth/onboarding/all-set">Start 14-day trial</AuthButton>
          <p className="w-full text-center text-[11.5px] text-faint">We’ll remind you 3 days before the trial ends.</p>
        </aside>
      </div>
    </OnboardingLayout>
  )
}
