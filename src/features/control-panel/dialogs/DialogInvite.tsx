import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Armchair, CircleCheck, Send, Shield, UserPlus, X } from 'lucide-react'
import { DialogCard, Field, PenButton, Radio } from '../ControlPanelShared'
import { ChannelPicker } from '../ChannelPicker'
import { useSession } from '../../../app/session'
import { useBuySeats, useChangePlan, useInviteMember, usePlans, useSeats } from '../../../app/queries'
import { notify } from '../../../ui/ds/Toaster'
import type { DialogKind } from '../types'
import type { PendingPayment } from './DialogPayMayar'
import { errorMessage, formatIdrShort, openCheckout } from '../format'

const ROLE_OPTIONS = ['Member', 'Admin', 'Viewer']

function EmailChip({ email, onRemove }: { email: string; onRemove?: () => void }) {
  return (
    <span className="flex items-center gap-[4px] rounded-sm bg-soft py-[4px] pr-[6px] pl-[8px] outline-1 -outline-offset-1 outline-line">
      <span className="text-[12.5px] text-ink-2">{email}</span>
      <button type="button" aria-label={`Remove ${email}`} onClick={onRemove}>
        <X size={12} aria-hidden className="text-muted hover:text-ink" />
      </button>
    </span>
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type FullChoice = 'seats' | 'viewers' | 'upgrade'

function Option({
  on,
  title,
  sub,
  right,
  onClick,
  disabled,
}: {
  on?: boolean
  title: string
  sub: string
  right?: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full gap-[10px] rounded-base bg-surface px-[12px] py-[10px] text-left disabled:opacity-50 ${
        on ? 'outline-[1.5px] -outline-offset-[1.5px] outline-ink' : 'outline-1 -outline-offset-1 outline-line-strong'
      }`}
    >
      <Radio on={on} />
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-[13px] font-medium text-ink">{title}</span>
        <span className="text-[12px] text-muted">{sub}</span>
      </div>
      {right && <span className="font-mono text-[11.5px] text-muted">{right}</span>}
    </button>
  )
}

/** pen aNKDy · Members · Invite — and iKSyB · Seats full (`seatsFull`). */
export function DialogInvite({
  onClose,
  seatsFull: forceFull,
  onDialog,
  onPayment,
}: {
  onClose: () => void
  seatsFull?: boolean
  onDialog?: (d: DialogKind) => void
  onPayment?: (p: PendingPayment) => void
}) {
  const companyName = useSession((s) => s.company?.name) ?? 'your company'
  const [role, setRole] = useState('Member')
  const [channelIds, setChannelIds] = useState<string[]>([])
  const [emails, setEmails] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [choice, setChoice] = useState<FullChoice>('seats')
  const inviteMember = useInviteMember()
  const qc = useQueryClient()
  const buySeats = useBuySeats()
  const changePlan = useChangePlan()
  const { data: seats } = useSeats()
  const { data: plans = [] } = usePlans()

  const selfHosted = seats?.selfHosted ?? false
  const available = seats?.available ?? 0
  const takesSeat = role !== 'Viewer'
  const need = takesSeat ? emails.length : 0
  const short = Math.max(0, need - available)
  const full = !selfHosted && !!seats && (forceFull || short > 0) && takesSeat
  const room = seats?.max == null ? Infinity : Math.max(0, seats.max - (seats.total ?? 0))
  const canAddSeats = !!seats?.canAdd && room >= Math.max(short, 1)
  const business = plans.find((p) => p.tier === 'business')
  const canUpgrade = !!business && seats?.planId !== business.id
  const effectiveChoice: FullChoice =
    choice === 'seats' && !canAddSeats ? (canUpgrade ? 'upgrade' : 'viewers') : choice

  function addEmail() {
    const v = draft.trim().replace(/,$/, '')
    if (!v) return
    if (!EMAIL_RE.test(v)) {
      notify('Enter a valid email address')
      return
    }
    if (!emails.includes(v)) setEmails((prev) => [...prev, v])
    setDraft('')
  }

  async function sendInvites(asRole: string) {
    const results = await Promise.allSettled(
      emails.map((email) =>
        inviteMember.mutateAsync({ email, role: asRole.toLowerCase(), channels: channelIds.length ? channelIds : undefined }),
      ),
    )
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    void qc.invalidateQueries({ queryKey: ['invites'] })
    void qc.invalidateQueries({ queryKey: ['seats'] })
    if (failed.length === 0) {
      notify(emails.length === 1 ? `Invite sent to ${emails[0]}` : `${emails.length} invites sent`)
      onClose()
    } else {
      notify(errorMessage(failed[0].reason, 'Could not send invites'))
    }
  }

  async function handleSend() {
    if (emails.length === 0) {
      notify('Add at least one email')
      return
    }
    setSending(true)
    try {
      if (!full) {
        await sendInvites(role)
        return
      }
      if (effectiveChoice === 'viewers') {
        await sendInvites('Viewer')
        return
      }
      if (effectiveChoice === 'seats') {
        const count = Math.max(short, 1)
        const r = await buySeats.mutateAsync(count)
        if (r.hostedUrl) {
          openCheckout(r.hostedUrl)
          onPayment?.({
            id: r.paymentId,
            hostedUrl: r.hostedUrl,
            lines: [
              { label: `${count} extra seat${count === 1 ? '' : 's'} · ${seats?.planName ?? ''}`, value: `${formatIdrShort(count * (seats?.seatPriceIdr ?? 0))} / mo` },
              { label: 'Due today, prorated', value: formatIdrShort(r.amountIdr) },
            ],
            unlocks: 'Seats are added — then send the invites again',
          })
          return
        }
        await sendInvites(role)
        return
      }
      // Upgrade to Business, then invite.
      if (!business) return
      const result = await changePlan.mutateAsync({ planId: business.id, interval: seats?.billingInterval ?? 'monthly' })
      const hostedUrl = result && typeof result === 'object' && 'hosted_url' in result
        ? (result as { hosted_url?: string | null }).hosted_url
        : null
      if (hostedUrl) {
        openCheckout(hostedUrl)
        onPayment?.({
          id: (result as { payment_id?: string }).payment_id ?? null,
          hostedUrl,
          lines: [{ label: `${business.name} plan`, value: `${formatIdrShort(business.monthlyPriceIdr)} / mo` }],
          unlocks: `${business.name} is activated — then send the invites again`,
        })
        return
      }
      await sendInvites(role)
    } catch (e) {
      notify(errorMessage(e, 'Could not send invites'))
    } finally {
      setSending(false)
    }
  }

  const n = emails.length
  const sendLabel = !full
    ? `Send ${n || ''} invite${n === 1 ? '' : 's'}`.replace('  ', ' ')
    : effectiveChoice === 'seats'
      ? `Add ${Math.max(short, 1)} seat${Math.max(short, 1) === 1 ? '' : 's'} & send`
      : effectiveChoice === 'viewers'
        ? `Invite ${n} as Viewer${n === 1 ? '' : 's'}`
        : 'Upgrade & send'
  const usedLabel = seats && !selfHosted ? `${seats.used + seats.pending} of ${seats.total ?? 0} used` : ''

  return (
    <DialogCard
      width={520}
      icon={UserPlus}
      title={`Invite people to ${companyName}`}
      sub="They get an email and can join with Google or a magic link."
      onClose={onClose}
      footer={
        <>
          <PenButton fs={13} onClick={onClose}>Cancel</PenButton>
          <span className="min-w-0 flex-1 text-center text-[12px] text-muted">
            {full && effectiveChoice !== 'viewers' ? 'Paid through Mayar' : 'Invites expire in 7 days'}
          </span>
          <PenButton variant="primary" fs={13} icon={Send} disabled={sending || n === 0} onClick={() => void handleSend()}>
            {sending ? 'Sending…' : sendLabel}
          </PenButton>
        </>
      }
    >
      <div className="flex w-full flex-col gap-[6px]">
        <span className="text-[13px] font-medium text-ink-2">Emails</span>
        <div className="flex w-full flex-wrap items-center gap-[6px] rounded-base p-[8px] outline-1 -outline-offset-1 outline-faint">
          {emails.map((email) => (
            <EmailChip key={email} email={email} onRemove={() => setEmails((prev) => prev.filter((e) => e !== email))} />
          ))}
          <input
            type="email"
            aria-label="Add email"
            placeholder={emails.length ? 'add more…' : 'name@company.com'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                addEmail()
              }
            }}
            onBlur={addEmail}
            className="min-w-[120px] flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
          />
        </div>
      </div>
      <div className="flex w-full gap-[12px]">
        <Field className="min-w-0 flex-1" width="auto" label="Role" icon={Shield} value={role} onChange={setRole} options={ROLE_OPTIONS} fs={13} select />
        <ChannelPicker value={channelIds} onChange={setChannelIds} />
      </div>

      {full ? (
        <div className="flex w-full flex-col gap-[10px] rounded-md bg-warn-tint p-[14px] outline-1 -outline-offset-1 outline-warn-line">
          <div className="flex w-full items-center gap-[8px]">
            <Armchair size={15} aria-hidden className="text-warn" />
            <span className="text-[13px] font-semibold text-warn">
              No seats left{n > 0 ? ` for ${n === 1 ? 'this invite' : `these ${n} invites`}` : ''}
            </span>
            <div className="h-px flex-1" />
            <span className="font-mono text-[11.5px] text-warn">{usedLabel}</span>
          </div>
          <span className="text-[12.5px] text-ink-2">Members and admins each take a seat. Choose how to make room:</span>
          <div className="flex w-full flex-col gap-[6px]" role="radiogroup" aria-label="Make room">
            <Option
              on={effectiveChoice === 'seats'}
              disabled={!canAddSeats}
              onClick={() => setChoice('seats')}
              title={`Add ${Math.max(short, 1)} seat${Math.max(short, 1) === 1 ? '' : 's'}`}
              sub={
                seats?.canAdd
                  ? `+${formatIdrShort(Math.max(short, 1) * (seats.seatPriceIdr ?? 0))} / month · prorated today`
                  : `${seats?.planName ?? 'This plan'} has no extra seats`
              }
              right={seats?.max != null ? `${(seats.total ?? 0) + Math.max(short, 1)} of ${seats.max}` : undefined}
            />
            <Option
              on={effectiveChoice === 'viewers'}
              onClick={() => setChoice('viewers')}
              title="Invite them as Viewers"
              sub="Free. Read-only — promote them when a seat opens"
            />
            {canUpgrade && business && (
              <Option
                on={effectiveChoice === 'upgrade'}
                onClick={() => setChoice('upgrade')}
                title={`Upgrade to ${business.name}`}
                sub={`${business.seats} seats included · ${formatIdrShort(business.monthlyPriceIdr)} / month`}
              />
            )}
          </div>
          {onDialog && seats?.max != null && !canAddSeats && (
            <button type="button" className="self-start text-[12px] text-link hover:underline" onClick={() => onDialog('plan-max')}>
              Other ways to make room
            </button>
          )}
        </div>
      ) : selfHosted ? (
        <div className="flex w-full items-center gap-[10px] rounded-md bg-ok-tint px-[14px] py-[12px] outline-1 -outline-offset-1 outline-ok-line">
          <CircleCheck size={16} aria-hidden className="text-ok" />
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="text-[13px] font-semibold text-ink">Unlimited seats</span>
            <span className="text-[12px] text-ink-2">Self-hosted — invite as many people as you like.</span>
          </div>
        </div>
      ) : (
        <div className="flex w-full items-center gap-[10px] rounded-md bg-ok-tint px-[14px] py-[12px] outline-1 -outline-offset-1 outline-ok-line">
          <CircleCheck size={16} aria-hidden className="text-ok" />
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="text-[13px] font-semibold text-ink">Seats available</span>
            <span className="text-[12px] text-ink-2">
              {!takesSeat
                ? 'Viewers are free and don’t use a seat.'
                : n === 0
                  ? `${available} free seat${available === 1 ? '' : 's'} left. No extra charge.`
                  : `${n === 1 ? 'This invite uses' : `These ${n} invites use`} ${need} of your ${available} free seat${available === 1 ? '' : 's'}. No extra charge.`}
            </span>
          </div>
          <span className="font-mono text-[11px] font-medium text-ok">{usedLabel}</span>
        </div>
      )}
    </DialogCard>
  )
}
