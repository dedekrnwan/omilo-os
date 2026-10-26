import { KeyRound, Plug, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Breadcrumb, SectionPane, StatusBadge } from '../legacyShared'
import type { DialogKind } from '../legacyTypes'
import { HARNESS_BY_ID } from '../harnesses'
import type { HarnessId } from '../harnesses'

type PoolStatus = 'Working' | 'Ready' | 'Resting'

interface PoolAccount {
  harness: HarnessId
  name: string
  tag: string
  status: PoolStatus
  /** Share of the current rate-limit window used (0–100). */
  pct: number
  tokens: string
  lastUsed: string
}

/**
 * One shared pool across every harness (Claude Code, Codex, Copilot, …). Agents
 * share all accounts; when one hits its rate-limit window the next ready account
 * takes over. Rows are grouped only by the Harness column — not separate tables.
 */
const POOL_ACCOUNTS: PoolAccount[] = [
  { harness: 'claude-code', name: 'cloud', tag: '…pwAA', status: 'Working', pct: 42, tokens: '17.5k', lastUsed: 'now' },
  { harness: 'claude-code', name: 'data', tag: '…twAA', status: 'Ready', pct: 8, tokens: '3.1k', lastUsed: '21m ago' },
  { harness: 'codex', name: 'main', tag: '…9f2c', status: 'Working', pct: 31, tokens: '9.4k', lastUsed: '2m ago' },
  { harness: 'copilot', name: 'work', tag: '…k3dP', status: 'Ready', pct: 12, tokens: '4.2k', lastUsed: '1h ago' },
]

const STATUS_COLOR: Record<PoolStatus, 'info' | 'ok' | 'warn'> = {
  Working: 'info',
  Ready: 'ok',
  Resting: 'warn',
}

const DIRECT_PROVIDERS = [
  { name: 'Anthropic', icon: Sparkles, tag: 'sk-ant-…4f2c', connected: true, label: 'Connected · used by Chief' },
  { name: 'OpenAI', icon: Plug, tag: null, connected: false, label: 'Optional fallback' },
  { name: 'Local model', icon: Plug, tag: null, connected: false, label: 'Ollama or LM Studio on this machine' },
]

const GRID = 'grid-cols-[168px_1fr_96px_176px_80px_auto]'

interface Props {
  onDialog: (d: DialogKind) => void
}

export function SectionAiAccounts({ onDialog }: Props) {
  const total = POOL_ACCOUNTS.length
  const working = POOL_ACCOUNTS.filter((a) => a.status === 'Working').length
  const resting = POOL_ACCOUNTS.filter((a) => a.status === 'Resting').length
  const ready = total - resting

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
        <p className="mb-[24px] text-[13px] text-muted">
          The accounts and keys agents run on. When one hits a limit, the next job moves to another.
        </p>

        {/* Stats */}
        <div className="mb-[24px] grid grid-cols-3 gap-[12px]">
          <StatCard label="Accounts ready" value={`${ready} / ${total}`} hint={resting === 0 ? 'all healthy' : `${resting} resting`} />
          <StatCard label="Working now" value={String(working)} hint="up to 2 jobs each" />
          <StatCard label="Resting" value={String(resting)} hint={resting === 0 ? 'none hit a limit' : 'hit a rate limit'} />
        </div>

        {/* Shared account pool */}
        <div className="mb-[8px] flex items-end justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Account pool</h2>
            <p className="text-[12px] text-muted">Subscription seats every agent shares — jobs move to the next ready account on a limit.</p>
          </div>
          <Button variant="secondary" height={28} icon={Plus} onClick={() => onDialog('add-harness')}>
            Add account
          </Button>
        </div>
        <div className="mb-[24px] overflow-hidden rounded-lg border border-line-strong bg-surface">
          <div className={`grid ${GRID} items-center border-b border-line bg-soft px-[16px] py-[8px] text-[11px] font-medium uppercase tracking-[0.8px] text-faint`}>
            <span>Harness</span>
            <span>Account</span>
            <span>Status</span>
            <span>Usage window</span>
            <span>Last used</span>
            <span />
          </div>
          {POOL_ACCOUNTS.map((a, i) => {
            const harness = HARNESS_BY_ID[a.harness]
            return (
              <div
                key={`${a.harness}-${a.name}`}
                className={`grid ${GRID} items-center px-[16px] py-[10px] ${i < POOL_ACCOUNTS.length - 1 ? 'border-b border-line' : ''}`}
              >
                {/* Harness */}
                <div className="flex items-center gap-[8px]">
                  <span className="flex size-[24px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line">
                    <harness.icon size={14} className="text-ink-2" aria-hidden />
                  </span>
                  <span className="truncate text-[12.5px] font-medium text-ink">{harness.name}</span>
                </div>
                {/* Account */}
                <div className="flex items-center gap-[8px]">
                  <span className="flex size-[28px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line">
                    <KeyRound size={13} className="text-muted" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink">{a.name}</p>
                    <p className="font-mono text-[11px] text-muted">{a.tag}</p>
                  </div>
                </div>
                {/* Status */}
                <StatusBadge label={a.status} color={STATUS_COLOR[a.status]} />
                {/* Usage window */}
                <div className="flex items-center gap-[8px] pr-[16px]">
                  <div className="h-[4px] flex-1 overflow-hidden rounded-full bg-line-strong">
                    <div className="h-full rounded-full bg-ink" style={{ width: `${a.pct}%` }} />
                  </div>
                  <span className="shrink-0 text-[12px] text-muted">{a.pct}% · {a.tokens}</span>
                </div>
                {/* Last used */}
                <span className="text-[12px] text-muted">{a.lastUsed}</span>
                {/* Actions */}
                <div className="flex items-center justify-end gap-[4px]">
                  <Button variant="secondary" height={28}>Test</Button>
                  <button
                    type="button"
                    className="inline-flex h-[28px] items-center rounded-btn px-[8px] text-[12.5px] text-muted transition-colors hover:bg-hover hover:text-ink"
                  >
                    Turn off
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Direct providers */}
        <h2 className="mb-[4px] text-[15px] font-semibold text-ink">Direct providers</h2>
        <p className="mb-[12px] text-[12px] text-muted">Use your own API key. Pick per agent which one it runs on.</p>
        <div className="grid grid-cols-3 gap-[10px]">
          {DIRECT_PROVIDERS.map((p) => (
            <div key={p.name} className="flex flex-col gap-[10px] rounded-lg border border-line-strong bg-surface p-[14px]">
              <div className="flex items-start gap-[10px]">
                <span className="flex size-[32px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line">
                  <p.icon size={15} className="text-ink-2" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-ink">{p.name}</p>
                  <p className="font-mono text-[11px] text-muted">{p.tag ?? 'Not connected'}</p>
                </div>
              </div>
              <span className="text-[12px] text-muted">{p.label}</span>
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

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-line-strong bg-surface p-[14px]">
      <p className="text-[11px] font-medium uppercase tracking-[0.8px] text-faint">{label}</p>
      <p className="mt-[4px] text-[24px] font-semibold text-ink">{value}</p>
      <p className="text-[12px] text-muted">{hint}</p>
    </div>
  )
}
