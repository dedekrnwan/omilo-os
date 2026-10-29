/**
 * Your AI → Cloud: settle how the team is paid for, without leaving the wizard.
 *
 *  - Free trial      reading the subscription starts it (backend start_trial:
 *                    Team plan, its included credits, no card)
 *  - Credit pack     POST /v1/billing/topup → hosted checkout in a new tab, polled
 *  - Monthly plan    POST /v1/billing/change-plan → same
 *  - See pricing     the real plans, inline (it used to jump to /auth/onboarding/plan
 *                    and skip the interview)
 *
 * The interview comes next only once Omilo Cloud's AI is ready
 * (GET /v1/onboarding/ai-status).
 */
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Gift, Loader, Package, Repeat } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useRepos } from '../../app/ReposProvider'
import { useChangePlan, useCreditPacks, usePayment, usePlans, useTopup } from '../../app/queries'
import { ChipNeutral, IconTile, Pill, Radio } from './parts'
import { getAiStatus } from './interviewApi'
import type { BillingPlan } from '../../core/domain/types'

export type CloudPick = 'trial' | 'pack' | 'monthly'

const idr = (n: number) => `Rp ${n.toLocaleString('id-ID')}`
const short = (n: number) => (n >= 1_000_000 ? `Rp ${(n / 1_000_000).toLocaleString('id-ID')} jt` : `Rp ${Math.round(n / 1000)} rb`)

function paymentOf(res: unknown): { id: string | null; url: string | null } {
  const r = (res ?? {}) as Record<string, unknown>
  return {
    id: (r.payment_id ?? r.paymentId ?? null) as string | null,
    url: (r.hosted_url ?? r.hostedUrl ?? null) as string | null,
  }
}

export function useCloudSetup(onReady: () => void) {
  const repos = useRepos()
  const qc = useQueryClient()
  const { data: plans = [] } = usePlans()
  const { data: packs = [] } = useCreditPacks()
  const topup = useTopup()
  const changePlan = useChangePlan()
  const cloudPlans = plans.filter((p) => p.id !== 'plan_self_hosted')
  // The backend trial runs on Team (billing.catalog.TRIAL_PLAN_ID) with its included credits.
  const trialPlan = cloudPlans.find((p) => p.id === 'plan_team') ?? cloudPlans.find((p) => p.trialDays > 0)

  const [pick, setPick] = useState<CloudPick>('trial')
  const [packId, setPackId] = useState<string | null>(null)
  const [planId, setPlanId] = useState<string | null>(null)
  const [showPricing, setShowPricing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paymentId, setPaymentId] = useState<string | null>(null)
  const { data: payment } = usePayment(paymentId)

  const pack = packs.find((p) => p.id === packId) ?? packs[0]
  const plan = cloudPlans.find((p) => p.id === planId) ?? trialPlan ?? cloudPlans[0]

  /** Proceed only when Omilo Cloud's AI really answers for this company. */
  async function proceedIfReady() {
    const st = await getAiStatus()
    if (st.ready) onReady()
    else setError(st.reason ?? 'Omilo Cloud isn’t ready yet.')
  }

  // A hosted checkout in another tab: continue as soon as it's paid.
  useEffect(() => {
    if (!payment) return
    if (payment.status === 'paid') {
      setPaymentId(null)
      void qc.invalidateQueries({ queryKey: ['usage'] })
      void qc.invalidateQueries({ queryKey: ['billingSubscription'] })
      void proceedIfReady()
    } else if (payment.status !== 'pending') {
      setPaymentId(null)
      setBusy(false)
      setError(`The payment ${payment.status}. Try again or pick another option.`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment?.status])

  async function start() {
    if (busy && !paymentId) return
    setBusy(true)
    setError(null)
    try {
      if (pick === 'trial') {
        // Reading the subscription starts the trial (idempotent) and grants its credits.
        await qc.fetchQuery({ queryKey: ['billingSubscription'], queryFn: () => repos.billingSubscription.get() })
        void qc.invalidateQueries({ queryKey: ['usage'] })
        await proceedIfReady()
        return
      }
      const res = pick === 'pack'
        ? await topup.mutateAsync(pack?.id ?? '2000')
        : await changePlan.mutateAsync({ planId: plan?.id ?? 'plan_team', interval: 'monthly' })
      const pay = paymentOf(res)
      if (pay.url && pay.id) {
        window.open(pay.url, '_blank', 'noopener')
        setPaymentId(pay.id) // poll; busy stays on until it settles
        return
      }
      await proceedIfReady() // paid at once (offline / manual provider)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work. Try again.')
    } finally {
      if (!paymentId) setBusy(false)
    }
  }

  const cta =
    paymentId ? 'Waiting for payment…'
    : busy ? 'Setting up…'
    : pick === 'trial' ? 'Start free and continue'
    : pick === 'pack' ? `Buy ${pack ? pack.label : 'credits'} and continue`
    : `Subscribe to ${plan ? plan.name : 'a plan'} and continue`

  return {
    pick, setPick, pack, packs, setPackId, plan, cloudPlans, setPlanId, trialPlan,
    showPricing, setShowPricing, busy: busy || !!paymentId, waitingPayment: !!paymentId, error, start, cta,
  }
}

export type CloudSetupState = ReturnType<typeof useCloudSetup>

function OptionCard({ icon, title, desc, selected, onSelect, recommended, children }: {
  icon: LucideIcon
  title: string
  desc: string
  selected: boolean
  onSelect: () => void
  recommended?: boolean
  children?: React.ReactNode
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
      className={`flex w-full cursor-pointer flex-col gap-[10px] rounded-md p-[16px] ${selected ? 'bg-surface' : ''}`}
      style={{ boxShadow: selected ? 'inset 0 0 0 2px var(--color-ink)' : 'inset 0 0 0 1px var(--color-line-strong)' }}
    >
      <div className="flex w-full items-center gap-[12px]">
        <Radio on={selected} />
        <IconTile icon={icon} />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[15px] font-semibold text-ink">{title}</span>
          <span className="w-full text-[13px] text-muted">{desc}</span>
        </div>
        {selected && recommended && <ChipNeutral>Recommended</ChipNeutral>}
      </div>
      {children && <div className="flex flex-wrap gap-[6px] pl-[76px]">{children}</div>}
    </div>
  )
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`flex items-center gap-[6px] rounded-pill px-[10px] py-[6px] text-[12px] outline-1 -outline-offset-1 ${
        on ? 'bg-ink text-surface outline-ink' : 'bg-surface text-ink-2 outline-line-strong hover:bg-soft'
      }`}
    >
      {on && <Check size={12} aria-hidden />}
      {children}
    </button>
  )
}

function PricingPanel({ plans }: { plans: BillingPlan[] }) {
  return (
    <div className="grid w-full grid-cols-1 gap-[8px] rounded-md bg-soft p-[12px] sm:grid-cols-3" aria-label="Pricing">
      {plans.map((p) => (
        <div key={p.id} className="flex flex-col gap-[4px] rounded-md bg-surface p-[12px] outline-1 -outline-offset-1 outline-line">
          <span className="text-[13px] font-semibold text-ink">{p.name}</span>
          <span className="font-mono text-[12px] text-ink-2">{idr(p.monthlyPriceIdr)} / mo</span>
          <span className="text-[12px] text-muted">
            {p.includedCredits.toLocaleString('id-ID')} credits · {p.seats} seat{p.seats === 1 ? '' : 's'}
          </span>
          {(p.features ?? []).slice(0, 3).map((f) => (
            <span key={f} className="text-[11.5px] text-muted">• {f}</span>
          ))}
        </div>
      ))}
    </div>
  )
}

export function CloudSetup({ s }: { s: CloudSetupState }) {
  const trial = s.trialPlan
  return (
    <div role="radiogroup" aria-label="How to pay for Cloud" className="contents">
      <OptionCard
        icon={Gift}
        title={trial ? `Start a ${trial.trialDays || 14}-day free trial` : 'Start a free trial'}
        desc={`${trial ? `${trial.includedCredits.toLocaleString('id-ID')} credits on the ${trial.name} plan` : 'Free credits'} · no card needed.`}
        selected={s.pick === 'trial'}
        onSelect={() => s.setPick('trial')}
        recommended
      >
        <span className="text-[12px] text-muted">1 credit ≈ 1 helper step · usage shown live in Billing ·</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            s.setShowPricing(!s.showPricing)
          }}
          className="text-[12px] font-medium text-link hover:underline"
        >
          {s.showPricing ? 'Hide pricing' : 'See pricing'}
        </button>
      </OptionCard>
      {s.showPricing && <PricingPanel plans={s.cloudPlans} />}
      <OptionCard
        icon={Package}
        title="Buy a credit pack"
        desc="Top up anytime. Credits never expire."
        selected={s.pick === 'pack'}
        onSelect={() => s.setPick('pack')}
      >
        {s.pick === 'pack'
          ? s.packs.map((p) => (
              <Choice key={p.id} on={s.pack?.id === p.id} onClick={() => s.setPackId(p.id)}>
                {p.label} · {short(p.amountIdr)}
              </Choice>
            ))
          : null}
      </OptionCard>
      <OptionCard
        icon={Repeat}
        title="Monthly plan"
        desc="Credits refill every month. Cancel anytime."
        selected={s.pick === 'monthly'}
        onSelect={() => s.setPick('monthly')}
      >
        {s.cloudPlans.map((p) =>
          s.pick === 'monthly' ? (
            <Choice key={p.id} on={s.plan?.id === p.id} onClick={() => s.setPlanId(p.id)}>
              {p.name} · {short(p.monthlyPriceIdr)}/mo
            </Choice>
          ) : (
            <Pill key={p.id}>{p.name} · {p.includedCredits.toLocaleString('id-ID')} credits</Pill>
          ),
        )}
      </OptionCard>
      {s.waitingPayment && (
        <p role="status" className="flex items-center gap-[6px] text-[13px] text-muted">
          <Loader size={13} aria-hidden className="animate-spin" />
          Finish the payment in the tab we opened — this continues by itself once it's paid.
        </p>
      )}
      {s.error && (
        <p role="alert" className="w-full text-[13px] text-bad">{s.error}</p>
      )}
    </div>
  )
}
