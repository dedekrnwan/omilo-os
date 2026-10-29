import { Eye, Mail, Moon, Rocket, UserPlus } from 'lucide-react'
import { Chip, DialogCard, PenButton } from '../ControlPanelShared'
import { useChangePlan, useInvites, useMembers, usePlans, useRevokeInvite, useSeats } from '../../../app/queries'
import { notify } from '../../../ui/ds/Toaster'
import type { DialogKind } from '../types'
import { errorMessage, formatIdrShort, openCheckout } from '../format'

function Lines({ lines }: { lines: string[] }) {
  return (
    <div className="flex w-full flex-1 flex-col gap-[5px]">
      {lines.map((l) => (
        <span key={l} className="text-[12.5px] text-ink-2">{l}</span>
      ))}
    </div>
  )
}

const INACTIVE_DAYS = 30

/** pen Wy7PQ · Members · Plan maximum reached */
export function DialogPlanMax({ onClose, onDialog }: { onClose: () => void; onDialog?: (d: DialogKind) => void }) {
  const { data: seats } = useSeats()
  const { data: plans = [] } = usePlans()
  const { data: invites = [] } = useInvites()
  const { data: members = [] } = useMembers()
  const changePlan = useChangePlan()
  const revoke = useRevokeInvite()

  const business = plans.find((p) => p.tier === 'business')
  const oldestInvite = [...invites]
    .filter((i) => i.role !== 'viewer')
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))[0]
  const cutoff = Date.now() - INACTIVE_DAYS * 86_400_000
  const inactive = members.filter(
    (m) => m.role !== 'owner' && m.role !== 'viewer' && (!m.lastSeenAt || new Date(m.lastSeenAt).getTime() < cutoff),
  )
  const inviteAge = oldestInvite?.createdAt
    ? Math.max(0, Math.round((Date.now() - new Date(oldestInvite.createdAt).getTime()) / 86_400_000))
    : null

  async function upgrade() {
    if (!business) return
    try {
      const result = await changePlan.mutateAsync({ planId: business.id, interval: seats?.billingInterval ?? 'monthly' })
      const hostedUrl = result && typeof result === 'object' && 'hosted_url' in result
        ? (result as { hosted_url?: string | null }).hosted_url
        : null
      if (hostedUrl) {
        openCheckout(hostedUrl)
        onClose()
        return
      }
      notify(`You're on ${business.name} — invite away`)
      if (onDialog) onDialog('invite')
      else onClose()
    } catch (e) {
      notify(errorMessage(e, 'Could not change plan'))
    }
  }

  async function revokeOldest() {
    if (!oldestInvite) return
    try {
      await revoke.mutateAsync(oldestInvite.id)
      notify(`Invite for ${oldestInvite.email} revoked`)
    } catch (e) {
      notify(errorMessage(e, 'Could not revoke invite'))
    }
  }

  return (
    <DialogCard
      width={560}
      icon={UserPlus}
      title={`${seats?.planName ?? 'Your plan'} tops out at ${seats?.max ?? seats?.total ?? 0} seats`}
      sub="To invite more people as members, pick one:"
      onClose={onClose}
      bodyGap={12}
      footer={
        <>
          <PenButton fs={13} onClick={onClose}>Cancel</PenButton>
          <button type="button" className="min-w-0 flex-1 text-center text-[12px] text-link" onClick={() => onDialog?.('change-plan')}>
            Compare plans in Usage & billing
          </button>
        </>
      }
    >
      <div className="flex h-[155px] w-full gap-[10px]">
        {business && seats?.planId !== business.id && (
          <div className="flex min-w-0 flex-1 flex-col gap-[10px] rounded-lg p-[14px] outline-[1.5px] -outline-offset-[1.5px] outline-ink">
            <div className="flex w-full items-center gap-[8px]">
              <Rocket size={16} aria-hidden className="text-ink" />
              <span className="text-[13px] font-semibold text-ink">{business.name}</span>
              <div className="h-px flex-1" />
              <Chip>Recommended</Chip>
            </div>
            <Lines lines={[
              `${business.seats} seats included, add more any time`,
              ...(business.features ?? []).filter((f) => /SSO/i.test(f)).slice(0, 1),
              `${formatIdrShort(business.monthlyPriceIdr)} / month · prorated today`,
            ]} />
            <PenButton variant="primary" h={30} fs={13} className="w-full" disabled={changePlan.isPending} onClick={() => void upgrade()}>
              Upgrade & invite
            </PenButton>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-[10px] rounded-lg p-[14px] outline-1 -outline-offset-1 outline-line-strong">
          <div className="flex w-full items-center gap-[8px]">
            <Eye size={16} aria-hidden className="text-ink" />
            <span className="text-[13px] font-semibold text-ink">Invite as Viewer</span>
          </div>
          <Lines lines={['Free, doesn’t use a seat', 'Reads goals, docs and runs', 'Promote when a seat opens']} />
          <PenButton h={30} fs={13} className="w-full" onClick={() => onDialog?.('invite')}>Invite as Viewer</PenButton>
        </div>
      </div>
      {(oldestInvite || inactive.length > 0) && (
        <div className="flex w-full flex-col gap-[8px] rounded-md bg-soft px-[14px] py-[12px]">
          <span className="text-[12.5px] font-semibold text-ink">Or free a seat</span>
          {oldestInvite && (
            <div className="flex w-full items-center gap-[8px]">
              <Mail size={14} aria-hidden className="text-muted" />
              <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">
                {oldestInvite.email} — invite pending{inviteAge != null ? ` ${inviteAge} day${inviteAge === 1 ? '' : 's'}` : ''}
              </span>
              <PenButton variant="quiet" h={26} fs={12.5} disabled={revoke.isPending} onClick={() => void revokeOldest()}>Revoke</PenButton>
            </div>
          )}
          {inactive.length > 0 && (
            <div className="flex w-full items-center gap-[8px]">
              <Moon size={14} aria-hidden className="text-muted" />
              <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">
                {inactive.length} member{inactive.length === 1 ? '' : 's'} inactive for {INACTIVE_DAYS}+ days
              </span>
              <PenButton variant="quiet" h={26} fs={12.5} onClick={onClose}>Review</PenButton>
            </div>
          )}
        </div>
      )}
    </DialogCard>
  )
}
