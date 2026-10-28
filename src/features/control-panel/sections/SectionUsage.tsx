/**
 * SectionUsage — Usage & billing rewired to live useUsage() + useSubscription() data.
 * Shows trial countdown (is_trial), plan + interval, balance, usedThisPeriod,
 * byHelper breakdown, byDay bars.
 * Empty state when usedThisPeriod === 0 and byHelper is empty.
 * Error state when the query rejects.
 */
import { Breadcrumb, SectionPane } from '../legacyShared'
import type { DialogKind } from '../legacyTypes'
import { Button } from '../../../ui/ds/Button'
import { useUsage, useSubscription } from '../../../app/queries'

interface Props {
  onDialog: (d: DialogKind) => void
}

export function SectionUsage({ onDialog }: Props) {
  const { data: usage, isError, isLoading } = useUsage()
  const { data: subscription } = useSubscription()

  const isEmpty = !isLoading && !isError && usage &&
    usage.usedThisPeriod === 0 && usage.byHelper.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Usage & billing" />
        <div className="ml-auto">
          <Button variant="secondary" height={28} onClick={() => onDialog('change-plan')}>
            Change plan
          </Button>
        </div>
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">Usage & billing</h1>
        <p className="mb-[24px] text-[13px] text-muted">Your credit balance and what AI cost this period.</p>

        {/* Subscription / trial banner */}
        {subscription && (
          <div className="mb-[20px] rounded-lg border border-line-strong bg-surface p-[14px]">
            <div className="flex items-center justify-between gap-[12px]">
              <div className="flex flex-col gap-[2px]">
                <p className="text-[13px] font-medium text-ink">
                  {subscription.planId} · {subscription.billingInterval}
                </p>
                {subscription.isTrial ? (
                  <p className="text-[12px] text-warn">
                    {subscription.trialDaysLeft} day{subscription.trialDaysLeft !== 1 ? 's' : ''} left in trial
                  </p>
                ) : (
                  <p className="text-[12px] text-muted">
                    {subscription.status}
                    {subscription.currentPeriodEnd
                      ? ` · renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
                      : ''}
                  </p>
                )}
              </div>
              {subscription.isTrial && (
                <Button variant="secondary" height={28} onClick={() => onDialog('change-plan')}>
                  Subscribe
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Error state */}
        {isError && (
          <div className="rounded-lg border border-line-strong bg-surface px-[16px] py-[12px]">
            <p className="text-[13px] text-muted">Could not load usage data. Please try again.</p>
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="animate-pulse space-y-[12px]">
            <div className="h-[80px] rounded-lg bg-soft" />
            <div className="h-[120px] rounded-lg bg-soft" />
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="rounded-lg border border-line-strong bg-surface px-[16px] py-[20px] text-center">
            <p className="text-[13px] text-muted">No usage this period yet.</p>
          </div>
        )}

        {/* Live data */}
        {usage && !isEmpty && !isError && (
          <>
            {/* Balance + used */}
            <div className="mb-[24px] grid grid-cols-2 gap-[12px]">
              <div className="rounded-lg border border-line-strong bg-surface p-[16px]">
                <p className="mb-[6px] text-[11px] font-medium uppercase tracking-[0.8px] text-faint">Balance</p>
                <p className="text-[24px] font-semibold text-ink">{usage.balance.toLocaleString()}</p>
                <p className="mt-[4px] text-[12px] text-muted">
                  credits · {usage.included.toLocaleString()} included in plan
                </p>
              </div>
              <div className="rounded-lg border border-line-strong bg-surface p-[16px]">
                <p className="mb-[6px] text-[11px] font-medium uppercase tracking-[0.8px] text-faint">Used this period</p>
                <p className="text-[24px] font-semibold text-ink">{usage.usedThisPeriod.toLocaleString()}</p>
                <p className="mt-[4px] text-[12px] text-muted">credits consumed</p>
              </div>
            </div>

            {/* By-helper breakdown */}
            {usage.byHelper.length > 0 && (
              <>
                <p className="mb-[10px] text-[13px] font-medium text-ink">By helper</p>
                <div className="mb-[24px] overflow-hidden rounded-lg border border-line-strong bg-surface">
                  {usage.byHelper.map((row, i) => {
                    const total = usage.byHelper.reduce((sum, r) => sum + r.credits, 0)
                    const pct = total > 0 ? Math.round((row.credits / total) * 100) : 0
                    return (
                      <div
                        key={row.helperId}
                        className={`flex items-center gap-[12px] px-[16px] py-[10px] ${i < usage.byHelper.length - 1 ? 'border-b border-line' : ''}`}
                      >
                        <span className="min-w-[120px] text-[13px] font-medium text-ink">{row.helperId}</span>
                        <div className="flex flex-1 items-center gap-[8px]">
                          <div className="h-[4px] flex-1 overflow-hidden rounded-full bg-line-strong">
                            <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="shrink-0 text-[12px] text-muted">{row.credits.toLocaleString()} cr</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {/* By-day chart (simple bar visualization) */}
            {usage.byDay.length > 0 && (
              <>
                <p className="mb-[10px] text-[13px] font-medium text-ink">Daily usage</p>
                <div className="mb-[24px] flex items-end gap-[4px]" style={{ height: 60 }}>
                  {usage.byDay.map((row) => {
                    const max = Math.max(...usage.byDay.map((r) => r.credits), 1)
                    const pct = Math.round((row.credits / max) * 100)
                    return (
                      <div key={row.day} className="flex flex-1 flex-col items-center gap-[2px]">
                        <div className="w-full rounded-sm bg-ink" style={{ height: `${pct}%`, minHeight: 2 }} />
                        <span className="text-[9px] text-faint">{row.day.slice(5)}</span>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {/* Pending topups */}
            {usage.pendingTopups && usage.pendingTopups.count > 0 && (
              <div className="mb-[16px] rounded-lg border border-warn-line bg-warn-tint px-[14px] py-[10px]">
                <p className="text-[12.5px] text-warn">
                  {usage.pendingTopups.count} pending top-up{usage.pendingTopups.count > 1 ? 's' : ''} · {usage.pendingTopups.totalCredits.toLocaleString()} credits
                </p>
              </div>
            )}

            {/* Last payment */}
            {usage.lastPayment && (
              <div className="rounded-lg border border-line-strong bg-surface px-[16px] py-[10px]">
                <p className="text-[12px] font-medium text-ink">Last payment</p>
                <p className="text-[12px] text-muted">
                  {usage.lastPayment.kind} · {usage.lastPayment.status} ·{' '}
                  {usage.lastPayment.amountIdr.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' })}
                </p>
              </div>
            )}
          </>
        )}
      </SectionPane>
    </div>
  )
}
