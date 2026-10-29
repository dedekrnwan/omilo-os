import { useState } from 'react'
import { Button } from '../../../ui/ds/Button'
import { Modal } from '../legacyShared'
import { capture } from '../../../telemetry'
import { useChangePlan, usePlans, useSubscription } from '../../../app/queries'
import { notify } from '../../../ui/ds/Toaster'
import type { BillingPlan } from '../../../core/domain/types'
import { errorMessage, formatIdrShort, openCheckout } from '../format'

interface Props {
  onClose: () => void
}

const CLOUD_TIERS = ['starter', 'team', 'business']
const SELF_HOST_GUIDE = 'https://omilo.saga.co.id/docs/self-host'
const ENTERPRISE = 'mailto:hello@saga.co.id?subject=Omilo%20Enterprise'

export function DialogChangePlan({ onClose }: Props) {
  const { data: allPlans = [], isLoading, isError } = usePlans()
  const { data: subscription } = useSubscription()
  const [yearly, setYearly] = useState(subscription?.billingInterval === 'yearly')
  const changePlan = useChangePlan()

  const plans = allPlans
    .filter((p) => CLOUD_TIERS.includes(p.tier))
    .sort((a, b) => a.monthlyPriceIdr - b.monthlyPriceIdr)
  const current = plans.find((p) => p.id === subscription?.planId)
  const trial = !!subscription?.isTrial
  const currentName = subscription?.planName ?? current?.name

  function action(p: BillingPlan): { label: string; primary: boolean; current: boolean } {
    if (current && p.id === current.id && !trial) {
      const sameInterval = (subscription?.billingInterval === 'yearly') === yearly
      return sameInterval
        ? { label: 'Current plan', primary: false, current: true }
        : { label: yearly ? 'Switch to yearly' : 'Switch to monthly', primary: false, current: false }
    }
    if (trial && current && p.id === current.id) return { label: 'Subscribe', primary: true, current: false }
    if (!current || p.monthlyPriceIdr > current.monthlyPriceIdr) return { label: 'Upgrade', primary: true, current: false }
    return { label: 'Downgrade', primary: false, current: false }
  }

  async function handleChange(planId: string) {
    try {
      capture('plan_changed', { plan: planId })
      const result = await changePlan.mutateAsync({ planId, interval: yearly ? 'yearly' : 'monthly' })
      // Doit/PayBridge returns a hosted checkout URL; open it to pay.
      const hostedUrl =
        result && typeof result === 'object' && 'hosted_url' in result
          ? (result as { hosted_url?: string | null }).hosted_url
          : null
      if (hostedUrl) {
        openCheckout(hostedUrl)
        notify('Finish paying in Mayar — the plan switches the moment it’s paid')
        onClose()
        return
      }
      notify('Plan updated')
      onClose()
    } catch (e) {
      notify(errorMessage(e, 'Could not change plan'))
    }
  }

  const subtitle = trial
    ? `You're trying ${currentName ?? 'Omilo'}${subscription?.trialDaysLeft != null ? ` · ${subscription.trialDaysLeft} days left` : ''}. Pick a plan to keep going.`
    : currentName
      ? `You're on ${currentName}. Changes apply now; we prorate the rest of the month.`
      : 'Pick a plan. Changes apply now.'

  return (
    <Modal
      title="Change plan"
      subtitle={subtitle}
      width={580}
      onClose={onClose}
      footer={
        <>
          <span className="text-[12px] text-muted flex items-center gap-[6px]">
            <span>💳</span> Paid through Mayar · QRIS, virtual account, e-wallet or card
          </span>
          <div className="flex-1" />
          <Button variant="secondary" height={30} onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="flex flex-col gap-[16px]">
        {isLoading && <p className="text-[12.5px] text-muted">Loading plans…</p>}
        {isError && <p className="text-[12.5px] text-muted">Could not load plans. Please try again.</p>}
        {/* Plan cards */}
        <div className="grid grid-cols-3 gap-[10px]">
          {plans.map((p) => {
            const a = action(p)
            const price = yearly ? p.yearlyPriceIdr : p.monthlyPriceIdr
            return (
              <div
                key={p.id}
                className={`flex flex-col gap-[10px] rounded-lg border p-[14px] ${
                  a.current ? 'border-ink' : 'border-line-strong bg-soft'
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-[14px] font-semibold text-ink">{p.name}</p>
                  {p.badge && !a.current && <span className="text-[10.5px] text-muted">{p.badge}</span>}
                  {a.current && <span className="rounded-pill bg-info-tint border border-info-line px-[6px] py-[1px] text-[10.5px] text-info">Current</span>}
                </div>
                <div>
                  <span className="text-[20px] font-semibold text-ink">{formatIdrShort(price)}</span>
                  <span className="text-[12px] text-muted">{yearly ? ' / year' : ' / month'}</span>
                </div>
                <ul className="flex flex-col gap-[4px]">
                  {(p.features ?? [`${p.seats} people`, `${p.includedCredits.toLocaleString()} AI credits / month`]).map((f) => (
                    <li key={f} className="flex items-start gap-[4px] text-[12px] text-muted">
                      <span className="mt-[2px] text-ok">✓</span> {f}
                    </li>
                  ))}
                </ul>
                {a.current ? (
                  <button type="button" disabled className="mt-auto h-[30px] w-full rounded-btn border border-line-strong bg-surface text-[12.5px] text-muted">
                    Current plan
                  </button>
                ) : (
                  <Button
                    variant={a.primary ? 'primary' : 'secondary'}
                    height={30}
                    className="mt-auto w-full justify-center"
                    disabled={changePlan.isPending}
                    onClick={() => void handleChange(p.id)}
                  >
                    {a.label}
                  </Button>
                )}
              </div>
            )
          })}
        </div>

        {/* Self-hosted */}
        <div className="flex items-center gap-[10px] rounded-lg border border-line-strong bg-soft px-[14px] py-[10px]">
          <span className="text-[16px]">🖥</span>
          <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
            <p className="text-[13px] font-semibold text-ink">Self-hosted <span className="ml-[4px] rounded-pill border border-ok-line bg-ok-tint px-[6px] py-[1px] text-[10.5px] text-ok">Free forever</span></p>
            <p className="text-[12px] text-muted">Run Omilo on your own server. Unlimited people and helpers, your own AI keys, no payment needed.</p>
          </div>
          <Button variant="secondary" height={28} onClick={() => window.open(SELF_HOST_GUIDE, '_blank', 'noopener')}>Self-host guide</Button>
        </div>

        {/* Pay yearly / Enterprise */}
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-[6px] cursor-pointer">
            <input
              type="checkbox"
              className="sr-only"
              checked={yearly}
              onChange={() => setYearly((v) => !v)}
            />
            <span className={`flex size-[16px] items-center justify-center rounded-full border-2 ${yearly ? 'border-ink bg-ink' : 'border-line-strong bg-surface'}`}>
              {yearly && <span className="size-[6px] rounded-full bg-white" />}
            </span>
            <span className="text-[12.5px] text-muted">Pay yearly · 2 months free</span>
          </label>
          <a href={ENTERPRISE} className="text-[12.5px] text-link hover:underline">Talk to us about Enterprise</a>
        </div>
      </div>
    </Modal>
  )
}
