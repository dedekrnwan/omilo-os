import { Copy, X } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'

interface ConnectEmailDialogProps {
  onClose: () => void
}

export function ConnectEmailDialog({ onClose }: ConnectEmailDialogProps) {
  const forwardAddress = 'support-sw7k@in.omilo.app'
  const fromName = 'Sahabat Warga Support'
  const signature = '— Support, Sahabat Warga · replies within 1 hour'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-ink/10" onClick={onClose}>
      <div
        className="relative mr-[6px] mt-[6px] mb-[6px] flex h-auto max-h-[calc(100%-12px)] w-[380px] flex-col overflow-hidden rounded-lg bg-surface outline-1 -outline-offset-1 outline-line-strong shadow-[0_10px_40px_#0C0A091F]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-[10px] border-b border-line px-[20px] pt-[20px] pb-[14px]">
          <span className="text-[22px]">✉</span>
          <div className="flex-1">
            <h2 className="m-0 text-[15px] font-semibold text-ink">Connect email</h2>
            <p className="m-0 text-[12px] text-muted">Support answers emails sent to your support address</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex size-[24px] items-center justify-center rounded-sm text-muted hover:bg-hover transition-colors">
            <X size={14} aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-[20px] py-[16px] flex flex-col gap-[20px]">
          {/* How to connect */}
          <div>
            <div className="text-[11px] font-medium tracking-[0.55px] text-faint uppercase mb-[8px]">How to connect</div>
            <div className="flex gap-[8px]">
              <Button variant="secondary">
                Sign in with Google Workspace
              </Button>
              <Button variant="secondary">
                Sign in with Microsoft 365
              </Button>
            </div>
            <p className="mt-[8px] m-0 text-[12px] text-muted">or forward your mail</p>
          </div>

          {/* Forward address */}
          <div>
            <p className="m-0 mb-[6px] text-[12px] text-ink-2">
              Forward <span className="font-medium">support@sahabatwarga.id</span> to this address:
            </p>
            <div className="flex items-center gap-[8px] rounded-md bg-soft px-[12px] py-[8px] outline-1 -outline-offset-1 outline-line-strong">
              <span className="flex-1 font-mono text-[12px] text-ink">{forwardAddress}</span>
              <button
                type="button"
                className="flex items-center gap-[4px] text-[12px] text-link hover:underline"
                onClick={() => navigator.clipboard.writeText(forwardAddress)}
              >
                <Copy size={12} aria-hidden />
                Copy
              </button>
            </div>
            <p className="mt-[4px] m-0 text-[11px] text-faint">
              Replies go out from support@sahabatwarga.id once you verify the domain.
            </p>
          </div>

          {/* How emails look */}
          <div>
            <div className="text-[11px] font-medium tracking-[0.55px] text-faint uppercase mb-[8px]">How emails look</div>
            <div className="flex flex-col gap-[10px]">
              <div>
                <label className="block text-[12px] font-medium text-ink-2 mb-[4px]">From name</label>
                <input
                  type="text"
                  defaultValue={fromName}
                  className="w-full rounded-md bg-soft px-[10px] py-[7px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-2 focus:-outline-offset-1 focus:outline-primary"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-ink-2 mb-[4px]">Signature</label>
                <input
                  type="text"
                  defaultValue={signature}
                  className="w-full rounded-md bg-soft px-[10px] py-[7px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-2 focus:-outline-offset-1 focus:outline-primary"
                />
                <p className="mt-[4px] m-0 text-[11px] text-faint">Support adds this under every reply.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-[16px] py-[12px]">
          <button type="button" className="text-[12px] text-muted hover:text-ink transition-colors">
            How it works
          </button>
          <div className="flex items-center gap-[8px]">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={onClose}>Connect email</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
