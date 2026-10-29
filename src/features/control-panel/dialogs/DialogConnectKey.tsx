import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CircleHelp, Key } from 'lucide-react'
import { Modal, TextInput } from '../legacyShared'
import { Button } from '../../../ui/ds/Button'
import { useCommands } from '../../../app/CommandsProvider'
import { notify } from '../../../ui/ds/Toaster'

interface Props {
  onClose: () => void
}

const PROVIDERS = ['Anthropic', 'OpenAI', 'Google', 'OpenRouter']
/** Map a provider display name to the backend harness id. */
const PROVIDER_HARNESS: Record<string, string> = {
  Anthropic: 'anthropic',
  OpenAI: 'openai',
  Google: 'gemini-cli',
  OpenRouter: 'openrouter',
}

/** Where each provider issues API keys. */
const KEY_HELP: Record<string, string> = {
  Anthropic: 'https://console.anthropic.com/settings/keys',
  OpenAI: 'https://platform.openai.com/api-keys',
  Google: 'https://aistudio.google.com/app/apikey',
  OpenRouter: 'https://openrouter.ai/keys',
}

/** Mask a key to a short hint for display (never stores the full key in the hint). */
function keyHint(key: string): string {
  const trimmed = key.trim()
  if (!trimmed) return ''
  return `${trimmed.slice(0, 7)}...${trimmed.slice(-4)}`
}

export function DialogConnectKey({ onClose }: Props) {
  const commands = useCommands()
  const qc = useQueryClient()
  const [provider, setProvider] = useState('Anthropic')
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!apiKey.trim()) {
      notify('Enter an API key')
      return
    }
    if (!label.trim()) {
      notify('Enter a label')
      return
    }
    setSaving(true)
    try {
      await commands.createAiAccount({
        harness: PROVIDER_HARNESS[provider] ?? 'anthropic',
        name: label.trim(),
        tokenEnc: apiKey.trim(),
        tokenHint: keyHint(apiKey),
      })
      await qc.invalidateQueries({ queryKey: ['aiAccounts'] })
      notify('AI account connected')
      onClose()
    } catch (e) {
      notify(e instanceof Error && e.message ? e.message : 'Could not save key')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Connect an AI account"
      subtitle="Use your own provider key. Helpers bill to it instead of Omilo credits."
      width={480}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="flex items-center gap-[4px] text-[12px] text-muted hover:underline"
            onClick={() => window.open(KEY_HELP[provider], '_blank', 'noopener')}
          >
            <CircleHelp size={12} aria-hidden /> Where do I find my key?
          </button>
          <div className="flex-1" />
          <Button variant="secondary" height={30} onClick={onClose}>Cancel</Button>
          <Button variant="primary" height={30} icon={Key} disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Saving…' : 'Save key'}
          </Button>
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
                onClick={() => setProvider(p)}
                className={`flex-1 rounded-sm py-[5px] text-[12.5px] font-medium transition-colors ${
                  p === provider
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
          <TextInput aria-label="Label" value={label} placeholder={`${provider} · production`} onChange={setLabel} className="w-full min-w-0" />
        </div>

        {/* API Key */}
        <div>
          <p className="mb-[6px] text-[12px] font-medium text-muted">API key</p>
          <div className="flex items-center gap-[8px]">
            <span className="flex-1 flex items-center gap-[6px] h-[34px] rounded-base border border-line-strong bg-soft px-[12px]">
              <Key size={12} className="text-muted" aria-hidden />
              <input
                type="password"
                aria-label="API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-api03-…"
                className="flex-1 bg-transparent font-mono text-[12.5px] text-ink outline-none placeholder:text-faint"
              />
            </span>
          </div>
          <p className="mt-[4px] text-[11.5px] text-muted">Stored encrypted. You can rotate or remove it anytime.</p>
        </div>

      </div>
    </Modal>
  )
}
