import { Link, UserPlus, X } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Modal, SelectField } from '../ControlPanelShared'

interface Props {
  onClose: () => void
  seatsFull?: boolean
}

export function DialogInvite({ onClose, seatsFull = false }: Props) {
  return (
    <Modal
      title="Invite people to Sahabat Warga"
      subtitle="They get an email and can join with Google or a magic link."
      width={500}
      onClose={onClose}
      footer={
        <>
          <span className="text-[12px] text-muted">Invites expire in 7 days</span>
          <div className="flex-1" />
          <Button variant="secondary" height={30} onClick={onClose}>Cancel</Button>
          <Button variant="primary" height={30} icon={UserPlus}>Send 2 invites</Button>
        </>
      }
    >
      {/* Email tokens */}
      <div className="mb-[12px]">
        <p className="mb-[6px] text-[12px] font-medium text-muted">Emails</p>
        <div className="flex min-h-[36px] flex-wrap items-center gap-[4px] rounded-base border border-line-strong bg-soft p-[6px]">
          {['rina@sahabatwarga.id', 'budi@sahabatwarga.id'].map((e) => (
            <span key={e} className="flex items-center gap-[4px] rounded-pill bg-surface border border-line-strong px-[8px] py-[2px] text-[12px] text-ink">
              {e}
              <X size={10} className="text-muted" aria-hidden />
            </span>
          ))}
          <input placeholder="+ add more…" className="flex-1 min-w-[80px] bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint" />
        </div>
      </div>

      {/* Role + Channel */}
      <div className="mb-[16px] grid grid-cols-2 gap-[10px]">
        <div>
          <p className="mb-[6px] text-[12px] font-medium text-muted">Role</p>
          <SelectField value="Member" />
        </div>
        <div>
          <p className="mb-[6px] text-[12px] font-medium text-muted">Channels</p>
          <SelectField value="Engineering, General" />
        </div>
      </div>

      {/* Seat status */}
      {seatsFull ? (
        <div className="mb-[12px] rounded-lg border border-warn-line bg-warn-tint px-[12px] py-[10px]">
          <p className="mb-[6px] text-[12.5px] font-semibold text-warn">No seats left for these 2 invites</p>
          <p className="mb-[10px] text-[12px] text-warn/80">5 of 5 used · Members and admins each take a seat. Choose how to make room:</p>
          <div className="flex flex-col gap-[6px]">
            <label className="flex items-start gap-[8px] rounded-base border border-warn-line bg-surface p-[10px]">
              <input type="radio" name="seat-action" defaultChecked className="mt-[2px] shrink-0" />
              <div>
                <p className="text-[12.5px] font-medium text-ink">Add 2 seats · 7 of 15</p>
                <p className="text-[11.5px] text-muted">+Rp 300 rb / month · Rp 77 rb today, prorated</p>
              </div>
            </label>
            <label className="flex items-start gap-[8px] rounded-base border border-line-strong bg-soft p-[10px]">
              <input type="radio" name="seat-action" className="mt-[2px] shrink-0" />
              <div>
                <p className="text-[12.5px] font-medium text-ink">Invite them as Viewers</p>
                <p className="text-[11.5px] text-muted">Free. Read-only — promote them when a seat opens</p>
              </div>
            </label>
            <label className="flex items-start gap-[8px] rounded-base border border-line-strong bg-soft p-[10px]">
              <input type="radio" name="seat-action" className="mt-[2px] shrink-0" />
              <div>
                <p className="text-[12.5px] font-medium text-ink">Upgrade to Business</p>
                <p className="text-[11.5px] text-muted">20 seats included · Rp 6 jt / month</p>
              </div>
            </label>
          </div>
        </div>
      ) : (
        <div className="mb-[12px] flex items-center gap-[8px] rounded-lg border border-ok-line bg-ok-tint px-[12px] py-[8px]">
          <span className="text-ok">✓</span>
          <p className="text-[12.5px] font-medium text-ok">Seats available</p>
          <p className="text-[12px] text-ok/80">These 2 invites use 2 of your 3 free seats. No extra charge.</p>
          <span className="ml-auto rounded-pill bg-surface border border-ok-line px-[8px] py-[1px] text-[11px] text-ok">5 of 8 used</span>
        </div>
      )}

      {/* Magic link */}
      <div className="flex items-center gap-[6px]">
        <Link size={12} className="text-muted" aria-hidden />
        <span className="text-[12px] text-muted">Or share an invite link · expires in 7 days</span>
        <button type="button" className="ml-auto text-[12px] text-link hover:underline flex items-center gap-[4px]">
          <Link size={11} aria-hidden /> Copy link
        </button>
      </div>
    </Modal>
  )
}
