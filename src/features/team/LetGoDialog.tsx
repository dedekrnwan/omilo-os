import { useNavigate } from '@tanstack/react-router'
import { Mascot } from '../../ui/ds/Mascot'
import type { HelperArea } from '../../core/domain/types'
import type { HelperRecord } from './teamData'

interface LetGoDialogProps {
  helper: HelperRecord
  onClose: () => void
}

export function LetGoDialog({ helper, onClose }: LetGoDialogProps) {
  const navigate = useNavigate()

  function handleLetGo() {
    onClose()
    void navigate({ to: '/team' })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20">
      <div
        className="flex w-[360px] flex-col items-center gap-[16px] rounded-[20px] bg-surface p-[32px] shadow-[0_20px_60px_#0C0A0929] outline-1 -outline-offset-1 outline-line-strong"
        onClick={(e) => e.stopPropagation()}
      >
        <Mascot size={56} radius={14} area={helper.area as HelperArea} title={helper.name} />

        <div className="text-center">
          <h2 className="m-0 font-display text-[18px] font-semibold text-ink">
            Let {helper.name} go?
          </h2>
          <p className="m-0 mt-[8px] text-[13px] text-muted leading-relaxed">
            {helper.name} stops answering on WhatsApp and Omilo chat, and hands its open chats back to you. Its files and memory are kept for 30 days — rehire anytime.
          </p>
        </div>

        <div className="flex w-full gap-[8px] mt-[4px]">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-[36px] rounded-btn text-[13px] font-medium text-ink bg-soft outline-1 -outline-offset-1 outline-line-strong hover:bg-hover transition-colors"
          >
            Keep {helper.name}
          </button>
          <button
            type="button"
            onClick={handleLetGo}
            className="flex-1 h-[36px] rounded-btn text-[13px] font-medium text-bad bg-bad-tint outline-1 -outline-offset-1 outline-bad-line hover:bg-bad-tint/80 transition-colors"
          >
            Let go
          </button>
        </div>
      </div>
    </div>
  )
}
