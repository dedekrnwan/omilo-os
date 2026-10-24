import { ChevronDown, CircleHelp, Key } from 'lucide-react'
import { Modal, TextInput } from '../ControlPanelShared'
import { Button } from '../../../ui/ds/Button'

interface Props {
  onClose: () => void
}

const PROVIDERS = ['Anthropic', 'OpenAI', 'Google', 'OpenRouter']

export function DialogConnectKey({ onClose }: Props) {
  return (
    <Modal
      title="Connect an AI account"
      subtitle="Use your own provider key. Helpers bill to it instead of Omilo credits."
      width={480}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="flex items-center gap-[4px] text-[12px] text-muted hover:underline">
            <CircleHelp size={12} aria-hidden /> Where do I find my key?
          </button>
          <div className="flex-1" />
          <Button variant="secondary" height={30} onClick={onClose}>Cancel</Button>
          <Button variant="primary" height={30} icon={Key}>Save key</Button>
        </>
      }
    >
      <div className="flex flex-col gap-[16px]">
        {/* Provider tabs */}
        <div>
          <p className="mb-[6px] text-[12px] font-medium text-muted">Provider</p>
          <div className="flex gap-[4px] rounded-base border border-line-strong bg-soft p-[3px]">
            {PROVIDERS.map((p) => (
              <button
                key={p}
                type="button"
                className={`flex-1 rounded-sm py-[5px] text-[12.5px] font-medium transition-colors ${
                  p === 'Anthropic'
                    ? 'bg-surface shadow-[0_1px_3px_#0C0A091F] text-ink'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Label */}
        <div>
          <p className="mb-[6px] text-[12px] font-medium text-muted">Label</p>
          <TextInput value="Saga · production" className="w-full min-w-0" />
        </div>

        {/* API Key */}
        <div>
          <p className="mb-[6px] text-[12px] font-medium text-muted">API key</p>
          <div className="flex items-center gap-[8px]">
            <span className="flex-1 flex items-center gap-[6px] h-[34px] rounded-base border border-line-strong bg-soft px-[12px]">
              <Key size={12} className="text-muted" aria-hidden />
              <span className="font-mono text-[12.5px] text-ink flex-1">sk-ant-api03-•••••••••••••••••Q7xA</span>
            </span>
          </div>
          <p className="mt-[4px] text-[11.5px] text-muted">Stored encrypted. You can rotate or remove it anytime.</p>
        </div>

        {/* Monthly limit */}
        <div>
          <p className="mb-[6px] text-[12px] font-medium text-muted">Monthly limit</p>
          <div className="flex items-center gap-[6px] h-[34px] rounded-base border border-line-strong bg-soft px-[12px]">
            <span className="flex-1 text-[13px] text-ink">Rp 2.000.000 · then pause and ask</span>
            <ChevronDown size={14} className="text-muted" aria-hidden />
          </div>
        </div>

        {/* Success state */}
        <div className="flex flex-col gap-[6px] rounded-lg border border-ok-line bg-ok-tint px-[12px] py-[10px]">
          <p className="text-[12.5px] font-semibold text-ok">✓ Key works · 3 models available</p>
          <p className="text-[12px] text-ok/80">Opus 5.5 · Sonnet 5.5 · Haiku 5.5</p>
        </div>
      </div>
    </Modal>
  )
}
