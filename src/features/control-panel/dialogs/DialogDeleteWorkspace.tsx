import { AlertTriangle } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Modal } from '../ControlPanelShared'

interface Props {
  onClose: () => void
}

export function DialogDeleteWorkspace({ onClose }: Props) {
  return (
    <Modal
      title=""
      width={440}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" height={30} onClick={onClose}>Keep workspace</Button>
          <button
            type="button"
            className="flex h-[30px] items-center gap-[5px] rounded-btn bg-bad px-[12px] text-[12.5px] font-medium text-white hover:bg-[#991B1B] transition-colors"
          >
            🗑 Delete workspace
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-[16px]">
        <div className="flex size-[40px] items-center justify-center rounded-full bg-bad-tint">
          <AlertTriangle size={20} className="text-bad" aria-hidden />
        </div>
        <h2 className="m-0 text-[18px] font-semibold text-ink">Delete Sahabat Warga?</h2>
        <p className="text-[13px] text-muted">
          All 6 helpers stop, every channel disconnects and 1,204 chats, goals, flows and docs are deleted after 14 days. Billing ends today.
        </p>
        <div>
          <p className="mb-[6px] text-[12.5px] text-muted">Type "Sahabat Warga" to confirm</p>
          <input
            type="text"
            className="h-[34px] w-full rounded-base border border-line-strong bg-soft px-[12px] text-[13px] text-ink outline-none"
            defaultValue="Sahabat Warga"
          />
        </div>
        <button type="button" className="flex items-center gap-[4px] text-[12.5px] text-link hover:underline">
          ↓ Export everything first
        </button>
      </div>
    </Modal>
  )
}
