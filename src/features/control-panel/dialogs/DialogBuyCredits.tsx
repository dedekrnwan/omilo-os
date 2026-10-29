import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Toggle, Modal } from '../legacyShared'
import { Button } from '../../../ui/ds/Button'
import {
  useCompanySettings,
  useCreditPacks,
  useTopup,
  useUpdateCompanySettings,
  useUpdateWallet,
  useWallet,
} from '../../../app/queries'
import { notify } from '../../../ui/ds/Toaster'
import { errorMessage, formatIdr, formatIdrShort, openCheckout, parseIdr } from '../format'

interface Props {
  onClose: () => void
}

/** Rupiah per credit (2,000 credits = Rp 100 rb) — converts the Rp cap to credits. */
const IDR_PER_CREDIT = 50
const AUTO_THRESHOLD = 500

export function DialogBuyCredits({ onClose }: Props) {
  const qc = useQueryClient()
  const { data: packs = [], isLoading, isError } = useCreditPacks()
  const { data: wallet } = useWallet()
  const { data: settings } = useCompanySettings()
  const topup = useTopup()
  const updateWallet = useUpdateWallet()
  const updateSettings = useUpdateCompanySettings()
  const [selected, setSelected] = useState('5000')
  const selectedPack = packs.find((p) => p.id === selected) ?? packs[1] ?? packs[0]

  const savedCapCredits = (settings?.aiEngine as { monthlyBudgetCredits?: unknown } | undefined)?.monthlyBudgetCredits
  const [cap, setCap] = useState('')
  useEffect(() => {
    setCap(typeof savedCapCredits === 'number' ? formatIdr(savedCapCredits * IDR_PER_CREDIT) : '')
  }, [savedCapCredits])

  const autoOn = wallet?.autoTopupEnabled ?? false
  const autoPack = packs.find((p) => p.id === (wallet?.autoTopupPack ?? '')) ?? selectedPack
  const threshold = wallet?.autoTopupThresholdCredits || AUTO_THRESHOLD

  async function toggleAuto() {
    try {
      await updateWallet.mutateAsync({
        autoTopupEnabled: !autoOn,
        autoTopupThresholdCredits: threshold,
        autoTopupPack: autoPack?.id ?? selected,
      })
      void qc.invalidateQueries({ queryKey: ['wallet'] })
      notify(autoOn ? 'Auto top-up off' : 'Auto top-up on')
    } catch (e) {
      notify(errorMessage(e, 'Could not update auto top-up'))
    }
  }

  async function saveCap() {
    const idr = parseIdr(cap)
    const credits = idr == null ? null : Math.round(idr / IDR_PER_CREDIT)
    if (credits === (typeof savedCapCredits === 'number' ? savedCapCredits : null)) return
    try {
      await updateSettings.mutateAsync({ aiEngine: { monthlyBudgetCredits: credits } })
      notify(credits ? `Monthly cap set to ${formatIdrShort(idr)}` : 'Monthly cap removed')
    } catch (e) {
      notify(errorMessage(e, 'Could not save the cap'))
    }
  }

  async function handlePay() {
    if (!selectedPack) return
    try {
      const result = await topup.mutateAsync(selectedPack.id)
      // Doit/PayBridge returns a hosted checkout URL; open it to pay.
      const hostedUrl =
        result && typeof result === 'object' && 'hosted_url' in result
          ? (result as { hosted_url?: string | null }).hosted_url
          : null
      for (const k of [['ledger'], ['invoices']]) void qc.invalidateQueries({ queryKey: k })
      if (hostedUrl) {
        openCheckout(hostedUrl)
        notify('Finish paying in Mayar — credits land the moment it’s paid')
        onClose()
        return
      }
      notify(`${selectedPack.credits.toLocaleString()} credits added`)
      onClose()
    } catch (e) {
      notify(errorMessage(e, 'Could not start top-up'))
    }
  }

  return (
    <Modal
      title="Buy credits"
      subtitle="Top-up credits never expire and are used after your monthly plan credits."
      width={440}
      onClose={onClose}
      footer={
        <>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[14px] font-semibold text-ink">{selectedPack ? formatIdrShort(selectedPack.amountIdr) : '—'}</span>
            <span className="text-[11.5px] text-muted">Paid through Mayar · QRIS, vA, card</span>
          </div>
          <Button variant="secondary" height={30} onClick={onClose}>Cancel</Button>
          <Button variant="primary" height={30} disabled={!selectedPack || topup.isPending} onClick={() => void handlePay()}>
            {topup.isPending ? 'Starting…' : 'Pay with Mayar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[16px]">
        <div>
          <p className="mb-[8px] text-[12px] font-medium text-muted">Pick a pack</p>
          {isLoading && <p className="text-[12.5px] text-muted">Loading packs…</p>}
          {isError && <p className="text-[12.5px] text-muted">Could not load credit packs.</p>}
          <div className="flex flex-col gap-[6px]">
            {packs.map((p) => {
              const isSelected = p.id === selectedPack?.id
              return (
                <label
                  key={p.id}
                  className={`flex cursor-pointer items-center gap-[10px] rounded-base border p-[12px] ${
                    isSelected ? 'border-ink bg-surface' : 'border-line-strong bg-soft'
                  }`}
                >
                  <input
                    type="radio"
                    name="credit-pack"
                    className="sr-only"
                    checked={isSelected}
                    onChange={() => setSelected(p.id)}
                  />
                  <span className={`flex size-[16px] shrink-0 items-center justify-center rounded-full border-2 ${isSelected ? 'border-ink bg-ink' : 'border-line-strong bg-surface'}`}>
                    {isSelected && <span className="size-[6px] rounded-full bg-white" />}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                    <span className="text-[13px] font-semibold text-ink">{p.label}</span>
                    <span className="text-[12px] text-muted">{p.sub}</span>
                  </div>
                  {p.badge && (
                    <span className="rounded-pill bg-ok-tint border border-ok-line px-[6px] py-[1px] text-[10.5px] text-ok">{p.badge}</span>
                  )}
                  <span className="text-[13px] font-semibold text-ink">{formatIdrShort(p.amountIdr)}</span>
                </label>
              )
            })}
          </div>
        </div>

        {/* Auto top-up */}
        <div className="flex items-center gap-[10px] rounded-lg border border-line-strong bg-soft px-[14px] py-[10px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
            <p className="text-[13px] font-semibold text-ink">Auto top-up</p>
            <p className="text-[12px] text-muted">
              When credits drop below {threshold.toLocaleString()}, buy {(autoPack?.credits ?? 5000).toLocaleString()} more automatically.
            </p>
          </div>
          <Toggle on={autoOn} label="Auto top-up" onClick={() => void toggleAuto()} />
        </div>

        {/* Monthly cap */}
        <div>
          <p className="mb-[6px] text-[12px] font-medium text-muted">Monthly spending cap</p>
          <input
            aria-label="Monthly spending cap"
            value={cap}
            placeholder="No cap"
            onChange={(e) => setCap(e.target.value)}
            onBlur={() => void saveCap()}
            onKeyDown={(e) => { if (e.key === 'Enter') void saveCap() }}
            className="flex h-[34px] w-full items-center rounded-base border border-line-strong bg-soft px-[12px] text-[13px] text-ink outline-none focus:border-ink"
          />
          <p className="mt-[4px] text-[11.5px] text-muted">Helpers pause before going over this.</p>
        </div>
      </div>
    </Modal>
  )
}
