import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'

interface ConnectWhatsAppDialogProps {
  onClose: () => void
}

export function ConnectWhatsAppDialog({ onClose }: ConnectWhatsAppDialogProps) {
  const [method, setMethod] = useState<'app' | 'cloud'>('app')

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-ink/10" onClick={onClose}>
      <div
        className="relative mr-[6px] mt-[6px] mb-[6px] flex h-auto max-h-[calc(100%-12px)] w-[380px] flex-col overflow-hidden rounded-lg bg-surface outline-1 -outline-offset-1 outline-line-strong shadow-[0_10px_40px_#0C0A091F]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-[10px] border-b border-line px-[20px] pt-[20px] pb-[14px]">
          <span className="text-[22px]" style={{ color: '#25D366' }}>●</span>
          <div className="flex-1">
            <h2 className="m-0 text-[15px] font-semibold text-ink">Connect WhatsApp Business</h2>
            <p className="m-0 text-[12px] text-muted">Residents message Support on your business number</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex size-[24px] items-center justify-center rounded-sm text-muted hover:bg-hover transition-colors">
            <X size={14} aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-[20px] py-[16px] flex flex-col gap-[16px]">
          {/* Method selector */}
          <div>
            <div className="text-[11px] font-medium tracking-[0.55px] text-faint uppercase mb-[8px]">How to connect</div>
            <div className="flex flex-col gap-[6px]">
              <label className={`flex items-start gap-[10px] rounded-md p-[10px] outline-1 -outline-offset-1 cursor-pointer transition-colors ${
                method === 'app' ? 'outline-primary bg-field-indigo' : 'outline-line-strong bg-surface hover:bg-soft'
              }`}>
                <input type="radio" name="wa-method" checked={method === 'app'} onChange={() => setMethod('app')} className="mt-[1px]" />
                <div>
                  <div className="text-[12.5px] font-medium text-ink">WhatsApp Business app</div>
                  <div className="text-[11.5px] text-muted">Scan a QR code with the phone that runs your business number. Best for small teams.</div>
                </div>
              </label>
              <label className={`flex items-start gap-[10px] rounded-md p-[10px] outline-1 -outline-offset-1 cursor-pointer transition-colors ${
                method === 'cloud' ? 'outline-primary bg-field-indigo' : 'outline-line-strong bg-surface hover:bg-soft'
              }`}>
                <input type="radio" name="wa-method" checked={method === 'cloud'} onChange={() => setMethod('cloud')} className="mt-[1px]" />
                <div>
                  <div className="text-[12.5px] font-medium text-ink">WhatsApp Cloud API</div>
                  <div className="text-[11.5px] text-muted">For higher volume. Needs a verified Meta Business account and a dedicated number.</div>
                </div>
              </label>
            </div>
          </div>

          {/* QR code placeholder */}
          {method === 'app' && (
            <div className="flex items-start gap-[16px]">
              {/* QR placeholder */}
              <div className="flex size-[120px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line-strong">
                <div className="grid grid-cols-6 gap-[2px] p-[8px]">
                  {Array.from({ length: 36 }).map((_, i) => (
                    <div
                      key={i}
                      className="size-[10px] rounded-[1px]"
                      style={{ background: ((i * 7 + 3) % 11) > 4 ? '#0C0A09' : 'transparent' }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-[6px] pt-[4px]">
                <ol className="m-0 pl-[16px] flex flex-col gap-[4px]">
                  <li className="text-[12px] text-ink-2">Open WhatsApp Business on your phone</li>
                  <li className="text-[12px] text-ink-2">Tap ⋯ → Linked devices</li>
                  <li className="text-[12px] text-ink-2">Tap Link a device and point it here</li>
                </ol>
                <span className="text-[11.5px] text-muted">Waiting for scan · new code in 0:45</span>
              </div>
            </div>
          )}

          {/* After connecting bullets */}
          <div>
            <div className="text-[11px] font-medium tracking-[0.55px] text-faint uppercase mb-[6px]">After connecting</div>
            <ul className="m-0 pl-0 list-none flex flex-col gap-[4px]">
              {[
                'Support reads the last 30 days so it knows ongoing chats',
                'Your phone keeps working — you can still reply yourself',
                'Support never messages anyone who hasn\'t messaged first',
              ].map((item) => (
                <li key={item} className="flex items-start gap-[6px] text-[12px] text-muted">
                  <span className="text-ok mt-[1px]">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-[16px] py-[12px]">
          <button type="button" className="text-[12px] text-link hover:underline" onClick={() => setMethod(method === 'app' ? 'cloud' : 'app')}>
            Use Cloud API instead
          </button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}
