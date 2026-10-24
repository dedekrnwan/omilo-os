import { useState } from 'react'
import { Check, ExternalLink, X } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'

interface ConnectTelegramDialogProps {
  onClose: () => void
}

export function ConnectTelegramDialog({ onClose }: ConnectTelegramDialogProps) {
  const [token, setToken] = useState('7104829315:AAH-k3Vq••••••••••Xc')
  const [who, setWho] = useState<'anyone' | 'invite' | 'group'>('anyone')
  const tokenValid = token.length > 10

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-ink/10" onClick={onClose}>
      <div
        className="relative mr-[6px] mt-[6px] mb-[6px] flex h-auto max-h-[calc(100%-12px)] w-[380px] flex-col overflow-hidden rounded-lg bg-surface outline-1 -outline-offset-1 outline-line-strong shadow-[0_10px_40px_#0C0A091F]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-[10px] border-b border-line px-[20px] pt-[20px] pb-[14px]">
          <span className="text-[22px]" style={{ color: '#2AABEE' }}>✈</span>
          <div className="flex-1">
            <h2 className="m-0 text-[15px] font-semibold text-ink">Connect Telegram</h2>
            <p className="m-0 text-[12px] text-muted">Support answers through your own Telegram bot</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex size-[24px] items-center justify-center rounded-sm text-muted hover:bg-hover transition-colors">
            <X size={14} aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-[20px] py-[16px] flex flex-col gap-[20px]">
          {/* Step 1 */}
          <div className="flex gap-[12px]">
            <div className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-ok text-white text-[11px] font-bold">
              <Check size={12} />
            </div>
            <div>
              <p className="m-0 text-[13px] font-medium text-ink">Create a bot</p>
              <p className="m-0 mt-[2px] text-[12px] text-muted">
                In Telegram, open @BotFather, send /newbot and give it a name like "Sahabat Warga Support".
              </p>
              <button type="button" className="mt-[6px] flex items-center gap-[4px] text-[12px] text-link hover:underline">
                <ExternalLink size={12} aria-hidden />
                Open @BotFather
              </button>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex gap-[12px]">
            <div className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-primary text-white text-[11px] font-bold">
              2
            </div>
            <div className="flex-1">
              <p className="m-0 text-[13px] font-medium text-ink mb-[8px]">Paste the bot token</p>
              <label className="block text-[11.5px] text-muted mb-[4px]">Bot token</label>
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="w-full rounded-md bg-soft px-[10px] py-[7px] text-[12.5px] font-mono text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-2 focus:-outline-offset-1 focus:outline-primary"
              />
              <p className="mt-[4px] m-0 text-[11px] text-faint">BotFather sends it right after /newbot</p>
              {tokenValid && (
                <div className="mt-[6px] flex items-center gap-[4px] rounded-md bg-ok-tint px-[10px] py-[6px] outline-1 -outline-offset-1 outline-ok-line">
                  <Check size={12} className="text-ok" />
                  <span className="text-[11.5px] text-ok font-medium">Token works · @sahabatwarga_support_bot</span>
                </div>
              )}
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex gap-[12px]">
            <div className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-line-strong text-muted text-[11px] font-bold">
              3
            </div>
            <div className="flex-1">
              <p className="m-0 text-[13px] font-medium text-ink mb-[10px]">Choose who can talk to it</p>
              <div className="flex flex-col gap-[8px]">
                {[
                  { id: 'anyone', label: 'Anyone who finds the bot', desc: 'Good for a public help line' },
                  { id: 'invite', label: 'Only people you invite', desc: 'Share a private link with residents' },
                  { id: 'group', label: 'A Telegram group', desc: 'Support replies when it\'s mentioned' },
                ] .map((opt) => (
                  <label key={opt.id} className={`flex items-start gap-[10px] rounded-md p-[10px] outline-1 -outline-offset-1 cursor-pointer transition-colors ${
                    who === opt.id ? 'outline-primary bg-field-indigo' : 'outline-line-strong bg-surface hover:bg-soft'
                  }`}>
                    <input
                      type="radio"
                      name="telegram-who"
                      value={opt.id}
                      checked={who === opt.id}
                      onChange={() => setWho(opt.id as typeof who)}
                      className="mt-[1px]"
                    />
                    <div>
                      <div className="text-[12.5px] font-medium text-ink">{opt.label}</div>
                      <div className="text-[11.5px] text-muted">{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Security note */}
          <p className="m-0 flex items-center gap-[6px] text-[11px] text-faint">
            <span>🔒</span>
            The token is stored encrypted. Only Support uses this bot.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-[16px] py-[12px]">
          <button type="button" onClick={onClose} className="text-[13px] text-muted hover:text-ink transition-colors">
            Cancel
          </button>
          <Button disabled={!tokenValid} className={!tokenValid ? 'opacity-40 cursor-not-allowed' : ''}>
            Connect Telegram
          </Button>
        </div>
      </div>
    </div>
  )
}
