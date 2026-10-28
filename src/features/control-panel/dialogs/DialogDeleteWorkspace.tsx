import { useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { Field, PenButton, Scrim } from '../ControlPanelShared'
import { Mascot } from '../../../ui/ds/Mascot'

const WORKSPACE_NAME = 'Sahabat Warga'

/** pen JS6gc · General · Delete workspace */
export function DialogDeleteWorkspace({ onClose }: { onClose: () => void }) {
  const [confirm, setConfirm] = useState('')
  const canDelete = confirm.trim() === WORKSPACE_NAME
  return (
    <Scrim onClose={onClose} align="right">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Delete Sahabat Warga?"
        className="flex h-full w-[460px] flex-col gap-[14px] overflow-y-auto bg-surface p-[24px] shadow-[-24px_0_48px_#1C191747] duration-200 ease-soft animate-in fade-in-0 slide-in-from-right-8"
      >
        <Mascot helper size={44} radius={12} area="brand" mood="sad" still />
        <h2 className="m-0 font-serif text-[22px] font-medium text-ink">Delete Sahabat Warga?</h2>
        <p className="m-0 text-[13.5px] leading-[1.55] text-ink-2">
          All 6 helpers stop, every channel disconnects and 1.204 chats, goals, flows and docs are deleted after 14 days. Billing ends today.
        </p>
        <Field
          label={`Type “${WORKSPACE_NAME}” to confirm`}
          value={confirm}
          placeholder={WORKSPACE_NAME}
          onChange={setConfirm}
        />
        <button type="button" className="flex w-full items-center gap-[8px] text-left">
          <Download size={13} aria-hidden className="text-muted" />
          <span className="text-[12.5px] text-link">Export everything first</span>
        </button>
        <div className="flex w-full gap-[8px] pt-[6px]">
          <PenButton h={40} fs={13} className="flex-1" onClick={onClose}>Keep workspace</PenButton>
          <PenButton
            h={40}
            fs={13}
            variant="danger-solid"
            icon={Trash2}
            className={`flex-1 ${canDelete ? '' : 'cursor-not-allowed opacity-50'}`}
            disabled={!canDelete}
            onClick={onClose}
          >
            Delete workspace
          </PenButton>
        </div>
      </div>
    </Scrim>
  )
}
