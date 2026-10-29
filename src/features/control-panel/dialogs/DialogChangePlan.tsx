import { useState } from 'react'
import { Button } from '../../../ui/ds/Button'
import { Modal } from '../legacyShared'
import { capture } from '../../../telemetry'
import { useChangePlan } from '../../../app/queries'
import { notify } from '../../../ui/ds/Toaster'

interface Props {
  onClose: () => void
}

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: 'Rp 500 rb',
    period: '/ month',
    features: ['2 people · no extra seats', '2 helpers', '1 channel per helper', 'Rp 300 rb AI spend included', 'Community support'],
    action: 'Downgrade',
    current: false,
  },
  {
    id: 'team',
    name: 'Team',
    price: 'Rp 2 jt',
    period: '/ month',
    features: ['5 people · add seats up to 15', '6 helpers', 'All channels', 'Rp 2 jt AI spend included', 'Bring your own AI key', 'Email support'],
    action: 'Current plan',
    current: true,
  },
  {
    id: 'business',
    name: 'Business',
    badge: 'For growing estates',
    price: 'Rp 6 jt',
    period: '/ month',
    features: ['20 people · add more any time', 'Unlimited helpers', 'MCP servers & custom skills', 'Rp 6 jt AI spend included', 'SSO and audit log', 'Priority WhatsApp support'],
    action: 'Upgrade',
    current: false,
  },
]

export function DialogChangePlan({ onClose }: Props) {
  const [yearly, setYearly] = useState(false)
  const changePlan = useChangePlan()

  async function handleChange(planId: string) {
    try {
      capture('plan_changed', { plan: planId })
      const result = await changePlan.mutateAsync({ planId, interval: yearly ? 'yearly' : 'monthly' })
      // Doit/PayBridge returns a hosted checkout URL; redirect there to pay.
      const hostedUrl =
        result && typeof result === 'object' && 'hosted_url' in result
          ? (result as { hosted_url?: string | null }).hosted_url
          : null
      if (hostedUrl) {
        window.location.assign(hostedUrl)
        return
      }
      notify('Plan updated')
      onClose()
    } catch (e) {
      notify(e instanceof Error && e.message ? e.message : 'Could not change plan')
    }
  }

  return (
    <Modal
      title="Change plan"
      subtitle="You're on Team. Changes apply now; we prorate the rest of the month."
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
        {/* Plan cards */}
        <div className="grid grid-cols-3 gap-[10px]">
          {PLANS.map((p) => (
            <div
              key={p.id}
              className={`flex flex-col gap-[10px] rounded-lg border p-[14px] ${
                p.current ? 'border-ink' : 'border-line-strong bg-soft'
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-[14px] font-semibold text-ink">{p.name}</p>
                {p.badge && <span className="text-[10.5px] text-muted">{p.badge}</span>}
                {p.current && <span className="rounded-pill bg-info-tint border border-info-line px-[6px] py-[1px] text-[10.5px] text-info">Current</span>}
              </div>
              <div>
                <span className="text-[20px] font-semibold text-ink">{p.price}</span>
                <span className="text-[12px] text-muted">{p.period}</span>
              </div>
              <ul className="flex flex-col gap-[4px]">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-[4px] text-[12px] text-muted">
                    <span className="mt-[2px] text-ok">✓</span> {f}
                  </li>
                ))}
              </ul>
              {p.current ? (
                <button type="button" disabled className="mt-auto h-[30px] w-full rounded-btn border border-line-strong bg-surface text-[12.5px] text-muted">
                  Current plan
                </button>
              ) : p.action === 'Upgrade' ? (
                <Button variant="primary" height={30} className="mt-auto w-full justify-center" disabled={changePlan.isPending} onClick={() => void handleChange(p.id)}>{p.action}</Button>
              ) : (
                <Button variant="secondary" height={30} className="mt-auto w-full justify-center" disabled={changePlan.isPending} onClick={() => void handleChange(p.id)}>{p.action}</Button>
              )}
            </div>
          ))}
        </div>

        {/* Self-hosted */}
        <div className="flex items-center gap-[10px] rounded-lg border border-line-strong bg-soft px-[14px] py-[10px]">
          <span className="text-[16px]">🖥</span>
          <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
            <p className="text-[13px] font-semibold text-ink">Self-hosted <span className="ml-[4px] rounded-pill border border-ok-line bg-ok-tint px-[6px] py-[1px] text-[10.5px] text-ok">Free forever</span></p>
            <p className="text-[12px] text-muted">Run Omilo on your own server. Unlimited people and helpers, your own AI keys, no payment needed.</p>
          </div>
          <Button variant="secondary" height={28}>Self-host guide</Button>
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
          <button type="button" className="text-[12.5px] text-link hover:underline">Talk to us about Enterprise</button>
        </div>
      </div>
    </Modal>
  )
}
