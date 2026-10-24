import { Key, RefreshCw } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Breadcrumb, SectionPane, StatusBadge } from '../ControlPanelShared'
import type { DialogKind } from '../types'

const POOL_ACCOUNTS = [
  { name: 'cloud', tag: '_paáA', status: 'Working', tokens: '17.5k tokens', pct: 42, lastUsed: 'now' },
  { name: 'data', tag: '_taáA', status: 'Ready', tokens: '3.1k tokens', pct: 8, lastUsed: '21m ago' },
]

const DIRECT_PROVIDERS = [
  { name: 'Anthropic', tag: 'sk-ant-…412c', connected: true, label: 'Connected · used by Chief' },
  { name: 'OpenAI', tag: null, connected: false, label: 'Not connected', optional: 'Optional fallback' },
  { name: 'Local model', tag: null, connected: false, label: 'Not connected', optional: 'Ollama or LM Studio on this machine' },
]

interface Props {
  onDialog: (d: DialogKind) => void
}

export function SectionAiAccounts({ onDialog }: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="AI accounts" />
        <div className="ml-auto">
          <Button variant="secondary" height={28} icon={RefreshCw}>Run connection check</Button>
        </div>
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">AI accounts</h1>
        <p className="mb-[24px] text-[13px] text-muted">The accounts and keys agents run on. When one hits a limit, the next job moves to another.</p>

        {/* Stats */}
        <div className="mb-[24px] grid grid-cols-3 gap-[12px]">
          <div className="rounded-lg border border-line-strong bg-surface p-[14px]">
            <p className="text-[11px] font-medium uppercase tracking-[0.8px] text-faint">Accounts ready</p>
            <p className="mt-[4px] text-[24px] font-semibold text-ink">2 / 2</p>
            <p className="text-[12px] text-muted">both healthy</p>
          </div>
          <div className="rounded-lg border border-line-strong bg-surface p-[14px]">
            <p className="text-[11px] font-medium uppercase tracking-[0.8px] text-faint">Working now</p>
            <p className="mt-[4px] text-[24px] font-semibold text-ink">1</p>
            <p className="text-[12px] text-muted">up to 2 jobs each</p>
          </div>
          <div className="rounded-lg border border-line-strong bg-surface p-[14px]">
            <p className="text-[11px] font-medium uppercase tracking-[0.8px] text-faint">Resting</p>
            <p className="mt-[4px] text-[24px] font-semibold text-ink">0</p>
            <p className="text-[12px] text-muted">none hit a limit</p>
          </div>
        </div>

        {/* Claude Code pool */}
        <div className="mb-[8px] flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">Claude Code pool</h2>
          <span className="text-[12px] text-muted">Shared by every agent. v2.1.169 on this machine.</span>
        </div>
        <div className="mb-[24px] overflow-hidden rounded-lg border border-line-strong bg-surface">
          <div className="grid grid-cols-[1fr_80px_200px_80px_80px_80px] items-center border-b border-line bg-soft px-[16px] py-[8px] text-[11px] font-medium uppercase tracking-[0.8px] text-faint">
            <span>Account</span>
            <span>Status</span>
            <span>This 5-hour window</span>
            <span>Last used</span>
            <span />
            <span />
          </div>
          {POOL_ACCOUNTS.map((a, i) => (
            <div
              key={a.name}
              className={`grid grid-cols-[1fr_80px_200px_80px_80px_80px] items-center px-[16px] py-[10px] ${i < POOL_ACCOUNTS.length - 1 ? 'border-b border-line' : ''}`}
            >
              <div className="flex items-center gap-[8px]">
                <Key size={14} className="text-muted" aria-hidden />
                <div>
                  <p className="text-[13px] font-medium text-ink">{a.name}</p>
                  <p className="font-mono text-[11px] text-muted">{a.tag}</p>
                </div>
              </div>
              <StatusBadge label={a.status} color={a.status === 'Working' ? 'ok' : 'neutral'} />
              <div className="flex items-center gap-[6px]">
                <div className="h-[4px] flex-1 overflow-hidden rounded-full bg-line-strong">
                  <div className="h-full rounded-full bg-ink" style={{ width: `${a.pct}%` }} />
                </div>
                <span className="text-[12px] text-muted">{a.tokens}</span>
              </div>
              <span className="text-[12px] text-muted">{a.lastUsed}</span>
              <Button variant="secondary" height={28}>Test</Button>
              <Button variant="secondary" height={28}>Turn off</Button>
            </div>
          ))}
        </div>

        {/* Direct providers */}
        <h2 className="mb-[4px] text-[15px] font-semibold text-ink">Direct providers</h2>
        <p className="mb-[12px] text-[12px] text-muted">Use your own API key. Pick per agent which one it runs on.</p>
        <div className="grid grid-cols-3 gap-[10px]">
          {DIRECT_PROVIDERS.map((p) => (
            <div key={p.name} className="flex flex-col gap-[8px] rounded-lg border border-line-strong bg-surface p-[14px]">
              <div className="flex items-center gap-[6px]">
                <Key size={14} className="text-muted" aria-hidden />
                <span className="text-[13px] font-semibold text-ink">{p.name}</span>
              </div>
              {p.tag && <span className="font-mono text-[11px] text-muted">{p.tag}</span>}
              <span className="text-[12px] text-muted">{p.optional ?? p.label}</span>
              {p.connected ? (
                <Button variant="secondary" height={28} onClick={() => onDialog('connect-key')}>Manage key</Button>
              ) : (
                <Button variant="primary" height={28} onClick={() => onDialog('connect-key')}>Connect</Button>
              )}
            </div>
          ))}
        </div>
      </SectionPane>
    </div>
  )
}
