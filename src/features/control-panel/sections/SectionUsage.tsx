/**
 * SectionUsage — Usage & billing for Cloud plans priced per company by storage.
 *
 *  - Plan card       name, fixed monthly price, trial countdown / renewal
 *  - Storage meter   docs, files & artifacts and knowledge count toward the plan;
 *                    chats and run logs are free (GET /v1/data/storage)
 *  - Invoices
 *
 * AI isn't billed here: the company's own key is billed by its AI provider.
 * At the limit new uploads pause until the company upgrades (HTTP 413).
 */
import { Breadcrumb, SectionPane } from '../legacyShared'
import type { DialogKind } from '../legacyTypes'
import { Button } from '../../../ui/ds/Button'
import { useInvoices, usePlans, useStorage, useSubscription } from '../../../app/queries'
import { formatBytes, formatIdr, formatIdrShort } from '../format'

const money = (amount: number, currency: string) =>
  currency === 'IDR' ? formatIdr(amount) : `${currency} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`

const SEGMENT_COLORS: Record<string, string> = {
  docs: '#2563EB',
  files: '#7C3AED',
  knowledge: '#0F766E',
}

interface Props {
  onDialog: (d: DialogKind) => void
}

export function SectionUsage({ onDialog }: Props) {
  const { data: subscription } = useSubscription()
  const { data: plans = [] } = usePlans()
  const { data: storage, isLoading: storageLoading, isError } = useStorage()
  const { data: invoices = [] } = useInvoices()

  const plan = plans.find((p) => p.id === subscription?.planId)
  const planName = subscription?.planName ?? plan?.name ?? subscription?.planId
  const used = storage?.usedBytes ?? 0
  const quota = storage?.quotaBytes ?? null
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0
  const counted = (storage?.segments ?? []).filter((s) => s.counted !== false)
  const free = (storage?.segments ?? []).filter((s) => s.counted === false)
  const full = quota != null && used >= quota
  const near = quota != null && !full && pct >= 80
  const price = plan ? (subscription?.billingInterval === 'yearly' ? plan.yearlyPriceIdr : plan.monthlyPriceIdr) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Usage & billing" />
        <div className="ml-auto flex items-center gap-[8px]">
          <Button variant="primary" height={28} onClick={() => onDialog('change-plan')}>
            Change plan
          </Button>
        </div>
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">Usage & billing</h1>
        <p className="mb-[24px] text-[13px] text-muted">
          One fixed price for your company, sized by storage. AI runs on your own key and is billed by your AI provider.
        </p>

        {/* Plan */}
        {subscription && (
          <div className="mb-[20px] rounded-lg border border-line-strong bg-surface p-[16px]">
            <div className="flex items-center justify-between gap-[12px]">
              <div className="flex flex-col gap-[2px]">
                <p className="text-[15px] font-semibold text-ink">
                  {planName ?? 'No plan'}
                  {price != null && (
                    <span className="ml-[8px] font-mono text-[13px] font-normal text-ink-2">
                      {formatIdrShort(price)} / {subscription.billingInterval === 'yearly' ? 'year' : 'month'}
                    </span>
                  )}
                </p>
                {subscription.isTrial ? (
                  <p className="text-[12px] text-warn">
                    Free trial · {subscription.trialDaysLeft} day{subscription.trialDaysLeft !== 1 ? 's' : ''} left
                  </p>
                ) : (
                  <p className="text-[12px] text-muted">
                    {subscription.status}
                    {subscription.currentPeriodEnd
                      ? ` · renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
                      : ''}
                  </p>
                )}
                <p className="text-[12px] text-muted">Unlimited people and helpers.</p>
              </div>
              {subscription.isTrial && (
                <Button variant="secondary" height={28} onClick={() => onDialog('change-plan')}>
                  Subscribe
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Storage */}
        <p className="mb-[10px] text-[13px] font-medium text-ink">Storage</p>
        <div className="mb-[24px] rounded-lg border border-line-strong bg-surface p-[16px]">
          {isError ? (
            <p className="text-[13px] text-muted">Could not measure storage. Please try again.</p>
          ) : storageLoading ? (
            <p className="text-[13px] text-muted">Measuring storage…</p>
          ) : (
            <>
              <p className="mb-[8px] text-[24px] font-semibold text-ink">
                {formatBytes(used)}{' '}
                <span className="text-[15px] font-normal text-muted">
                  {quota != null ? `of ${formatBytes(quota)}` : 'used · no limit'}
                </span>
              </p>
              {quota != null && (
                <div
                  className="mb-[10px] h-[8px] overflow-hidden rounded-full bg-line-strong"
                  role="meter"
                  aria-label="Storage used"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(pct)}
                >
                  <div className="flex h-full">
                    {counted.filter((s) => s.bytes > 0).map((s) => (
                      <div
                        key={s.key}
                        className="h-full"
                        style={{ width: `${Math.max(0.5, (s.bytes / quota) * 100)}%`, background: SEGMENT_COLORS[s.key] ?? '#A8A29E' }}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-[12px]">
                {counted.map((s) => (
                  <span key={s.key} className="flex items-center gap-[4px] text-[11.5px] text-muted">
                    <span className="size-[8px] rounded-full" style={{ background: SEGMENT_COLORS[s.key] ?? '#A8A29E' }} />
                    {s.label} {formatBytes(s.bytes)}
                  </span>
                ))}
              </div>
              {free.length > 0 && (
                <p className="mt-[8px] text-[11.5px] text-faint">
                  Not counted: {free.map((s) => `${s.label.replace(' (free)', '')} ${formatBytes(s.bytes)}`).join(' · ')}
                </p>
              )}
              {(full || near) && (
                <div className={`mt-[12px] flex items-center gap-[10px] rounded-md px-[12px] py-[8px] ${full ? 'bg-bad-tint' : 'bg-warn-tint'}`}>
                  <p className={`min-w-0 flex-1 text-[12.5px] ${full ? 'text-bad' : 'text-warn'}`}>
                    {full
                      ? 'Storage is full — new uploads are paused. Upgrade or delete files you no longer need.'
                      : 'Storage is almost full. New uploads pause at the limit.'}
                  </p>
                  <Button variant="secondary" height={28} onClick={() => onDialog('change-plan')}>
                    Upgrade
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Invoices */}
        {invoices.length > 0 && (
          <>
            <p className="mb-[10px] text-[13px] font-medium text-ink">Invoices</p>
            <div className="overflow-hidden rounded-lg border border-line-strong bg-surface">
              {invoices.map((inv, i) => (
                <div key={inv.id} className={`flex items-center gap-[12px] px-[16px] py-[8px] ${i < invoices.length - 1 ? 'border-b border-line' : ''}`}>
                  <span className="w-[72px] text-[12px] text-muted">{inv.period}</span>
                  <span className="min-w-0 flex-1 text-[12.5px] capitalize text-ink">{inv.status}</span>
                  <span className="font-mono text-[12px] text-ink">{money(inv.amount, inv.currency)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </SectionPane>
    </div>
  )
}
