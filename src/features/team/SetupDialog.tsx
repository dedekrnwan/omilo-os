import { useState } from 'react'
import { ArrowLeft, Check, ChevronDown, X } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { Button } from '../../ui/ds/Button'
import type { HelperArea } from '../../core/domain/types'
import type { HireOption } from './teamData'

// ── WhereItWorks channel toggle ────────────────────────────────────────────────

function ChannelToggle({ label, active }: { label: string; active?: boolean }) {
  return (
    <span
      className={`inline-flex h-[24px] items-center gap-[4px] rounded-pill px-[10px] text-[12px] font-medium transition-colors ${
        active
          ? 'bg-primary text-primary-ink'
          : 'bg-soft text-muted outline-1 -outline-offset-1 outline-line-strong'
      }`}
    >
      {active && <Check size={11} aria-hidden />}
      {label}
    </span>
  )
}

// ── SetupDialog ───────────────────────────────────────────────────────────────

interface SetupDialogProps {
  option: HireOption
  onBack: () => void
  onHire: (helperId: string) => void
}

export function SetupDialog({ option, onBack, onHire }: SetupDialogProps) {
  const [name, setName] = useState(option.name)
  const [description] = useState(
    option.id === 'sales-hire'
      ? 'Follow up every new lead from WhatsApp and the website form within an hour. Book a viewing or a call, and hand hot leads to me.'
      : `You are ${option.name} for Sahabat Warga.`
  )

  function handleHire() {
    onHire(option.id.replace('-hire', ''))
  }

  return (
    /* Overlay */
    <div className="fixed inset-0 z-40 flex items-start justify-end bg-ink/10">
      {/* Panel */}
      <div className="relative mr-[6px] mt-[6px] mb-[6px] flex h-[calc(100%-12px)] w-[380px] flex-col overflow-hidden rounded-lg bg-surface outline-1 -outline-offset-1 outline-line-strong shadow-[0_10px_40px_#0C0A091F]">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line px-[20px] pt-[20px] pb-[14px]">
          <div>
            <div className="flex items-center gap-[6px] mb-[2px]">
              <span className="text-[10.5px] font-medium tracking-[0.55px] text-faint uppercase">Step 2 of 2</span>
              <span className="text-[10.5px] text-faint">— you can fine-tune everything after hiring</span>
            </div>
            <h2 className="m-0 text-[15px] font-semibold text-ink">Set up {option.name}</h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onBack}
            className="flex size-[24px] items-center justify-center rounded-sm text-muted hover:bg-hover transition-colors"
          >
            <X size={14} aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-[20px] py-[16px] flex flex-col gap-[20px]">
          {/* Avatar */}
          <div className="flex items-center gap-[12px]">
            <Mascot size={52} radius={14} area={option.area as HelperArea} title={option.name} />
            <div>
              <div className="text-[15px] font-semibold text-ink">{option.name}</div>
              <div className="text-[12.5px] text-muted">{option.tagline}</div>
            </div>
            <button
              type="button"
              className="ml-auto flex items-center gap-[4px] text-[12px] text-link hover:underline"
            >
              Change look
            </button>
          </div>

          {/* Name field */}
          <div>
            <label className="block text-[12px] font-medium text-ink-2 mb-[6px]">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md bg-soft px-[12px] py-[8px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-2 focus:-outline-offset-1 focus:outline-primary"
            />
          </div>

          {/* Job description */}
          <div>
            <label className="block text-[12px] font-medium text-ink-2 mb-[6px]">Job description</label>
            <textarea
              defaultValue={description}
              rows={3}
              className="w-full resize-none rounded-md bg-soft px-[12px] py-[8px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-2 focus:-outline-offset-1 focus:outline-primary"
            />
          </div>

          {/* Reports to + Model row */}
          <div className="grid grid-cols-2 gap-[12px]">
            <div>
              <label className="block text-[12px] font-medium text-ink-2 mb-[6px]">Reports to</label>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md bg-soft px-[10px] py-[7px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-hover transition-colors"
              >
                <span className="flex items-center gap-[6px]">
                  <Mascot size={14} radius={4} area="brand" tile={false} />
                  Chief of Staff
                </span>
                <ChevronDown size={12} aria-hidden className="text-muted" />
              </button>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-ink-2 mb-[6px]">Model</label>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md bg-soft px-[10px] py-[7px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-hover transition-colors"
              >
                <span>Opus 5.5 · default</span>
                <ChevronDown size={12} aria-hidden className="text-muted" />
              </button>
            </div>
          </div>

          {/* Where it works */}
          <div>
            <label className="block text-[12px] font-medium text-ink-2 mb-[8px]">Where it works</label>
            <div className="flex flex-wrap gap-[6px]">
              <ChannelToggle label="Omilo chat" active />
              <ChannelToggle label="WhatsApp" active />
              <ChannelToggle label="+ Telegram" />
              <ChannelToggle label="+ Email" />
            </div>
          </div>

          {/* Cost estimate */}
          <div className="flex items-center gap-[8px] rounded-md bg-field-amber px-[12px] py-[8px]">
            <span className="text-[12px] text-ink-2">
              About Rp 150–250 rb / month at your current volume
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-[16px] py-[12px]">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-[4px] text-[13px] text-muted hover:text-ink transition-colors"
          >
            <ArrowLeft size={13} aria-hidden />
            Back
          </button>
          <Button onClick={handleHire}>
            <Check size={13} aria-hidden />
            Hire {name}
          </Button>
        </div>
      </div>
    </div>
  )
}
