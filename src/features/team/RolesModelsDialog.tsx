import { useState } from 'react'
import { ChevronDown, ExternalLink, X } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { Button } from '../../ui/ds/Button'
import { menuSurface } from '../../ui/ds/Menu'
import type { HelperArea } from '../../core/domain/types'
import { HELPER_MODEL_ROWS, MODELS } from './teamData'
import type { HelperModelRow } from './teamData'

// ── Model selector per helper ─────────────────────────────────────────────────

function ModelSelector({ row }: { row: HelperModelRow }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(row.model)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-[30px] items-center gap-[6px] rounded-md bg-soft px-[10px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-hover transition-colors"
      >
        {selected}
        <ChevronDown size={12} aria-hidden className="text-muted" />
      </button>

      {open && (
        <div
          className={`absolute right-0 top-[36px] z-50 w-[200px] ${menuSurface}`}
          onMouseLeave={() => setOpen(false)}
        >
          <div className="px-[10px] pt-[8px] pb-[4px] text-[10.5px] font-medium tracking-[0.55px] text-muted uppercase">
            Model for {row.name}
          </div>
          {MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => { setSelected(m.label); setOpen(false) }}
              className={`flex h-[30px] w-full items-center gap-[6px] rounded-sm px-[8px] text-[12.5px] text-left transition-colors hover:bg-hover ${
                selected === m.label ? 'text-ink font-medium' : 'text-ink-2'
              }`}
            >
              {selected === m.label && <span className="text-ok">✓</span>}
              <span className="flex-1">{m.label}</span>
              {m.note && <span className="text-[11px] text-faint">{m.note}</span>}
              {m.tag && <span className="text-[11px] text-faint">{m.tag}</span>}
            </button>
          ))}
          <div className="border-t border-line mx-[4px] my-[4px]" />
          <button type="button" className="flex h-[30px] w-full items-center gap-[6px] rounded-sm px-[8px] text-[12.5px] text-muted text-left transition-colors hover:bg-hover">
            Use company default
          </button>
          <button type="button" className="flex h-[30px] w-full items-center gap-[6px] rounded-sm px-[8px] text-[12.5px] text-muted text-left transition-colors hover:bg-hover">
            Manage AI accounts
          </button>
        </div>
      )}
    </div>
  )
}

// ── RolesModelsDialog ─────────────────────────────────────────────────────────

interface RolesModelsDialogProps {
  onClose: () => void
}

export function RolesModelsDialog({ onClose }: RolesModelsDialogProps) {
  const [companyDefault] = useState('Opus 5.5 · Anthropic')

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-40 flex items-start justify-end bg-ink/10"
      onClick={onClose}
    >
      {/* Panel */}
      <div
        className="relative mr-[6px] mt-[6px] mb-[6px] flex h-auto max-h-[calc(100%-12px)] w-[420px] flex-col overflow-hidden rounded-lg bg-surface outline-1 -outline-offset-1 outline-line-strong shadow-[0_10px_40px_#0C0A091F]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line px-[20px] pt-[20px] pb-[14px]">
          <div>
            <h2 className="m-0 text-[15px] font-semibold text-ink">Roles &amp; models</h2>
            <p className="m-0 mt-[2px] text-[12px] text-muted">
              Which model each helper thinks with. Keys and providers live in Control panel → AI accounts.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-[24px] items-center justify-center rounded-sm text-muted hover:bg-hover transition-colors"
          >
            <X size={14} aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-[20px] py-[16px] flex flex-col gap-[16px]">
          {/* Company default */}
          <div>
            <div className="text-[10.5px] font-medium tracking-[0.55px] text-faint uppercase mb-[8px]">
              Company default
            </div>
            <div className="flex items-center justify-between rounded-md bg-soft px-[12px] py-[8px] outline-1 -outline-offset-1 outline-line-strong">
              <span className="flex items-center gap-[6px] text-[13px] text-ink">
                <Mascot size={16} radius={4} area="brand" tile={false} />
                {companyDefault}
              </span>
              <ChevronDown size={13} aria-hidden className="text-muted" />
            </div>
          </div>

          {/* Per helper */}
          <div>
            <div className="text-[10.5px] font-medium tracking-[0.55px] text-faint uppercase mb-[8px]">
              Per helper
            </div>
            <div className="flex flex-col divide-y divide-line">
              {HELPER_MODEL_ROWS.map((row) => (
                <div key={row.helperId} className="flex items-center gap-[12px] py-[10px]">
                  <Mascot size={28} radius={8} area={row.area as HelperArea} title={row.name} />
                  <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                    <span className="text-[13px] font-medium text-ink">{row.name}</span>
                    <span className="text-[11.5px] text-muted">{row.description}</span>
                  </div>
                  <ModelSelector row={row} />
                </div>
              ))}
            </div>
          </div>

          {/* Note */}
          <p className="m-0 text-[11.5px] text-muted">
            Sonnet is ~3× cheaper — good for helpers that write a lot of short replies.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-[16px] py-[12px]">
          <button
            type="button"
            className="flex items-center gap-[4px] text-[12.5px] text-muted hover:text-ink transition-colors"
          >
            <ExternalLink size={13} aria-hidden />
            Open AI accounts
          </button>
          <div className="flex items-center gap-[8px]">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={onClose}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
