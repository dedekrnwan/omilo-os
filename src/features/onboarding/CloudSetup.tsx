/**
 * Your AI → Cloud: pick the company's Cloud plan without leaving the wizard.
 *
 * Cloud plans are per company and sized by storage (docs, files & artifacts,
 * knowledge). People and helpers are unlimited. The AI is the company's own
 * key (connected just below, in StepYourAI) — the plan doesn't include AI.
 *
 *  - Free trial      reading the subscription starts it (backend start_trial:
 *                    Team plan, 14 days, no card)
 *  - Paid plan       POST /v1/billing/change-plan → hosted checkout in a new tab, polled
 *
 * The interview comes next once the AI key answers (GET /v1/onboarding/ai-status).
 */
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Gift, HardDrive, Loader } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useRepos } from '../../app/ReposProvider'
import { useChangePlan, usePayment, usePlans } from '../../app/queries'
import { ChipNeutral, IconTile, Radio } from './parts'
import type { BillingPlan } from '../../core/domain/types'

/** 'trial' or a plan id. */
export type CloudPick = string

const short = (n: number) => (n >= 1_000_000 ? `Rp ${(n / 1_000_000).toLocaleString('id-ID')} jt` : `Rp ${Math.round(n / 1000)} rb`)
export const storageLabel = (gb: number | null | undefined) => (gb == null ? 'Unlimited storage' : `${gb} GB storage`)

function paymentOf(res: unknown): { id: string | null; url: string | null } {
  const r = (res ?? {}) as Record<string, unknown>
  return {
    id: (r.payment_id ?? r.paymentId ?? null) as string | null,
    url: (r.hosted_url ?? r.hostedUrl ?? null) as string | null,
  }
}

export function useCloudSetup(onReady: (pick: CloudPick) => void) {
  const repos = useRepos()
  const qc = useQueryClient()
  const { data: plans = [] } = usePlans()
  const changePlan = useChangePlan()
  const cloudPlans = plans.filter((p) => p.id !== 'plan_self_hosted')
  // The backend trial runs on Team (billing.catalog.TRIAL_PLAN_ID).
  const trialPlan = cloudPlans.find((p) => p.id === 'plan_team') ?? cloudPlans.find((p) => p.trialDays > 0)

  const [pick, setPick] = useState<CloudPick>('trial')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paymentId, setPaymentId] = useState<string | null>(null)
  const { data: payment } = usePayment(paymentId)

  const plan = pick === 'trial' ? trialPlan : cloudPlans.find((p) => p.id === pick)

  // A hosted checkout in another tab: continue as soon as it's paid.
  useEffect(() => {
    if (!payment) return
    if (payment.status === 'paid') {
      setPaymentId(null)
      setBusy(false)
      void qc.invalidateQueries({ queryKey: ['billingSubscription'] })
      onReady(pick)
    } else if (payment.status !== 'pending') {
      setPaymentId(null)
      setBusy(false)
      setError(`The payment ${payment.status}. Try again or start the free trial.`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment?.status])

  /**
   * Settle the plan, then continue. `before` runs first (the AI key check) and
   * stops here when it returns false, so nobody pays before their AI works.
   */
  async function start(before?: () => Promise<boolean>) {
    if (busy) return
    setBusy(true)
    setError(null)
    let waiting = false
    try {
      if (before && !(await before())) return
      if (pick === 'trial') {
        // Reading the subscription starts the trial (idempotent).
        await qc.fetchQuery({ queryKey: ['billingSubscription'], queryFn: () => repos.billingSubscription.get() })
        onReady(pick)
        return
      }
      const res = await changePlan.mutateAsync({ planId: pick, interval: 'monthly' })
      const pay = paymentOf(res)
      if (pay.url && pay.id) {
        window.open(pay.url, '_blank', 'noopener')
        setPaymentId(pay.id) // poll; busy stays on until it settles
        waiting = true
        return
      }
      onReady(pick) // paid at once (offline / manual provider)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work. Try again.')
    } finally {
      if (!waiting) setBusy(false)
    }
  }

  const cta =
    paymentId ? 'Waiting for payment…'
    : busy ? 'Setting up…'
    : pick === 'trial' ? 'Start free and continue'
    : `Subscribe to ${plan ? plan.name : 'a plan'} and continue`

  return { pick, setPick, plan, cloudPlans, trialPlan, busy: busy || !!paymentId, waitingPayment: !!paymentId, error, start, cta }
}

export type CloudSetupState = ReturnType<typeof useCloudSetup>

function OptionCard({ icon, title, desc, aside, selected, onSelect, badge }: {
  icon: LucideIcon
  title: string
  desc: string
  aside?: string
  selected: boolean
  onSelect: () => void
  badge?: string | null
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
      className={`flex w-full cursor-pointer items-center gap-[12px] rounded-md p-[14px] ${selected ? 'bg-surface' : ''}`}
      style={{ boxShadow: selected ? 'inset 0 0 0 2px var(--color-ink)' : 'inset 0 0 0 1px var(--color-line-strong)' }}
    >
      <Radio on={selected} />
      <IconTile icon={icon} />
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="flex items-center gap-[8px] text-[15px] font-semibold text-ink">
          {title}
          {badge && <ChipNeutral>{badge}</ChipNeutral>}
        </span>
        <span className="w-full text-[13px] text-muted">{desc}</span>
      </div>
      {aside && <span className="shrink-0 font-mono text-[13px] text-ink-2">{aside}</span>}
    </div>
  )
}

function planDesc(p: BillingPlan): string {
  return `${storageLabel(p.storageGb)} · unlimited people and helpers`
}

export function CloudSetup({ s }: { s: CloudSetupState }) {
  const trial = s.trialPlan
  return (
    <div className="flex flex-col gap-[8px]">
      <span className="text-[11px] font-semibold tracking-[0.8px] text-muted">1 · YOUR PLAN</span>
      <div role="radiogroup" aria-label="Cloud plan" className="flex flex-col gap-[8px]">
        <OptionCard
          icon={Gift}
          title={`Start a ${trial?.trialDays || 14}-day free trial`}
          desc={`${trial ? `${trial.name} plan · ${storageLabel(trial.storageGb)}` : 'Full Cloud'} · no card needed`}
          aside="Rp 0"
          selected={s.pick === 'trial'}
          onSelect={() => s.setPick('trial')}
          badge="Recommended"
        />
        {s.cloudPlans.map((p) => (
          <OptionCard
            key={p.id}
            icon={HardDrive}
            title={p.name}
            desc={planDesc(p)}
            aside={`${short(p.monthlyPriceIdr)}/mo`}
            selected={s.pick === p.id}
            onSelect={() => s.setPick(p.id)}
            badge={p.badge}
          />
        ))}
      </div>
      <p className="flex items-center gap-[6px] text-[12px] text-muted">
        <Check size={12} aria-hidden />
        One fixed price per company. Storage counts docs, files and knowledge — chats are free.
      </p>
      {s.waitingPayment && (
        <p role="status" className="flex items-center gap-[6px] text-[13px] text-muted">
          <Loader size={13} aria-hidden className="animate-spin" />
          Finish the payment in the tab we opened — this continues by itself once it's paid.
        </p>
      )}
      {s.error && <p role="alert" className="w-full text-[13px] text-bad">{s.error}</p>}
    </div>
  )
}
