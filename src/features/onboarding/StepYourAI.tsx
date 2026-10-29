/** Onboarding 2 · Your AI — Self-host (pen InMeZ) / Cloud (pen CbbZR).
 *
 * Wired to the real AI-accounts backend (P13):
 *   - useAiAccounts() drives the "existing" option list.
 *   - Selecting "api-key" and submitting calls createAiAccount via commands.
 *   - The cloud segment is unchanged (credit-based, no AI account needed).
 *
 * NOTE: POST /v1/ai-accounts/check only reclassifies existing pool accounts
 * by pct_window — it does NOT detect locally running processes.  There is no
 * API endpoint that detects "Claude Code signed in on this machine", so the
 * fake hardcoded detection has been removed.  Users connect via an existing
 * pool account OR by entering an API key.
 */
import { useState } from 'react'
import { ArrowLeft, ArrowRight, KeyRound, Loader } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AI_MODES } from './data'
import { CloudSetup, useCloudSetup } from './CloudSetup'
import type { AIMode } from './data'
import { ChipNeutral, IconTile, Pill, PrimaryButton, QuietButton, Radio, StepEyebrow, WizardCard } from './parts'
import { capture } from '../../telemetry'
import { useAiAccounts, useUpdateCompanySettings } from '../../app/queries'
import { useCommands } from '../../app/CommandsProvider'
import { useQueryClient } from '@tanstack/react-query'
import { isMockMode } from '../../app/useAuth'
import type { AiAccount } from '../../core/domain/types'
import { DetectedHarnesses } from '../../ui/ds/DetectedHarnesses'

// ── helpers ───────────────────────────────────────────────────────────────────


// ── harness labels for display ────────────────────────────────────────────────

const HARNESS_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  claude: 'Claude',
  codex: 'Codex',
  copilot: 'GitHub Copilot',
  'gemini-cli': 'Gemini CLI',
  cursor: 'Cursor',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
}

function harnessLabel(harness: string): string {
  return HARNESS_LABELS[harness] ?? harness
}

// ── sub-components ─────────────────────────────────────────────────────────────

/** Single selectable option card — used for self-host top-level options. */
function OptionCard({
  icon: Icon,
  title,
  desc,
  chips,
  selected,
  onSelect,
}: {
  icon: LucideIcon
  title: string
  desc: string
  chips?: string[]
  selected: boolean
  onSelect: () => void
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
      className={`flex w-full cursor-pointer flex-col gap-[10px] rounded-md p-[16px] ${selected ? 'bg-surface' : ''}`}
      style={{
        boxShadow: selected
          ? 'inset 0 0 0 2px var(--color-ink)'
          : 'inset 0 0 0 1px var(--color-line-strong)',
      }}
    >
      <div className="flex w-full items-center gap-[12px]">
        <Radio on={selected} />
        <IconTile icon={Icon} />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[15px] font-semibold text-ink">{title}</span>
          <span className="w-full text-[13px] text-muted">{desc}</span>
        </div>
      </div>
      {chips && (
        <div className="flex gap-[6px] pl-[76px]">
          {chips.map((c) => (
            <Pill key={c}>{c}</Pill>
          ))}
        </div>
      )}
    </div>
  )
}

/** Existing AI account displayed as a selectable pool entry. */
function ExistingAccountRow({
  account,
  selected,
  onSelect,
}: {
  account: AiAccount
  selected: boolean
  onSelect: () => void
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
      className={`flex w-full cursor-pointer items-center gap-[12px] rounded-md px-[16px] py-[10px] ${selected ? 'bg-surface' : ''}`}
      style={{
        boxShadow: selected
          ? 'inset 0 0 0 2px var(--color-ink)'
          : 'inset 0 0 0 1px var(--color-line-strong)',
      }}
    >
      <Radio on={selected} />
      <span className="flex size-[28px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line">
        <KeyRound size={13} className="text-muted" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
        <span className="truncate text-[13px] font-medium text-ink">{account.name}</span>
        <span className="text-[12px] text-muted">{harnessLabel(account.harness)}</span>
      </div>
      {account.status === 'ready' && (
        <span className="flex items-center gap-[5px] text-[11px] text-ok">
          <span aria-hidden className="size-[6px] shrink-0 rounded-full bg-ok" />
          Ready
        </span>
      )}
      {selected && <ChipNeutral>Use this</ChipNeutral>}
    </div>
  )
}

// ── API key inline form ────────────────────────────────────────────────────────

const API_HARNESSES = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'gemini-cli', label: 'Google Gemini' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'copilot', label: 'GitHub Copilot' },
]

function ApiKeyForm({
  onConnect,
  connecting,
  error,
}: {
  onConnect: (harness: string, name: string, key: string) => void
  connecting: boolean
  error: string | null
}) {
  const [harness, setHarness] = useState('anthropic')
  const [name, setName] = useState('')
  const [key, setKey] = useState('')

  return (
    <div
      className="flex flex-col gap-[10px] rounded-md p-[16px]"
      style={{ boxShadow: 'inset 0 0 0 2px var(--color-ink)' }}
    >
      <div className="flex items-center gap-[12px]">
        <Radio on />
        <IconTile icon={KeyRound} />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[15px] font-semibold text-ink">Connect an API key</span>
          <span className="text-[13px] text-muted">Pay as you go with your own key.</span>
        </div>
      </div>
      <div className="flex flex-col gap-[8px] pl-[72px]">
        <div className="flex gap-[8px]">
          <div className="flex flex-1 flex-col gap-[4px]">
            <label className="text-[11px] font-medium text-muted" htmlFor="ai-provider">
              Provider
            </label>
            <select
              id="ai-provider"
              value={harness}
              onChange={(e) => setHarness(e.target.value)}
              className="rounded-md border border-line-strong bg-surface px-[10px] py-[6px] text-[13px] text-ink outline-none focus:outline-1 focus:-outline-offset-1 focus:outline-ink"
            >
              {API_HARNESSES.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-1 flex-col gap-[4px]">
            <label className="text-[11px] font-medium text-muted" htmlFor="ai-account-name">
              Account name
            </label>
            <input
              id="ai-account-name"
              type="text"
              placeholder="e.g. Main API key"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-line-strong bg-surface px-[10px] py-[6px] text-[13px] text-ink placeholder:text-faint outline-none focus:outline-1 focus:-outline-offset-1 focus:outline-ink"
            />
          </div>
        </div>
        <div className="flex flex-col gap-[4px]">
          <label className="text-[11px] font-medium text-muted" htmlFor="ai-api-key">
            API key
          </label>
          <input
            id="ai-api-key"
            type="password"
            placeholder="sk-ant-..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="rounded-md border border-line-strong bg-surface px-[10px] py-[6px] font-mono text-[13px] text-ink placeholder:text-faint outline-none focus:outline-1 focus:-outline-offset-1 focus:outline-ink"
          />
        </div>
        {error && <p className="text-[12px] text-bad">{error}</p>}
        <button
          type="button"
          disabled={connecting || !name.trim() || !key.trim()}
          onClick={() => onConnect(harness, name.trim(), key.trim())}
          className="flex h-[30px] w-fit items-center gap-[6px] rounded-md bg-ink px-[12px] text-[13px] font-medium text-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          {connecting && <Loader size={12} className="animate-spin" aria-hidden />}
          {connecting ? 'Connecting…' : 'Connect key'}
        </button>
      </div>
    </div>
  )
}

// ── main component ─────────────────────────────────────────────────────────────

type SelfHostPick = 'existing' | 'api-key'

/** What the user picked on the Your-AI step, handed to the wizard on Next. */
export interface AiSelection {
  mode: AIMode
  /** For self-host: the chosen existing pool account id (if any). */
  accountId?: string | null
  /** For cloud: the chosen cloud option id. */
  cloudPick?: string
}

export function StepYourAI({
  initialMode = 'self-host',
  onBack,
  onNext,
}: {
  initialMode?: AIMode
  onBack: () => void
  onNext: (selection?: AiSelection) => void
}) {
  const [mode, setMode] = useState<AIMode>(initialMode)
  const copy = AI_MODES[mode]

  // Self-host: which top-level option is active ('existing' | 'api-key')
  const [selfHostPick, setSelfHostPick] = useState<SelfHostPick>('existing')
  // Self-host existing: which account id is selected in the pool list
  const [existingAccountId, setExistingAccountId] = useState<string | null>(null)
  // Cloud: which cloud option is selected

  // API key connect state
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [connected, setConnected] = useState<AiAccount | null>(null)

  // Live AI accounts from the backend (or mock repo in mock mode)
  const { data: aiAccounts, isLoading: accountsLoading } = useAiAccounts()
  const commands = useCommands()
  const qc = useQueryClient()
  const updateSettings = useUpdateCompanySettings()
  const [checking, setChecking] = useState(false)
  // Cloud: settle trial / pack / plan here; the interview opens once Omilo Cloud's AI is ready.
  const cloud = useCloudSetup(() => onNext({ mode: 'cloud', cloudPick: cloud.pick }))

  /** Prove the picked AI really answers (one tiny call), save it as the company's AI, then move on. */
  async function confirmAccount(accountId: string | null) {
    if (isMockMode()) {
      onNext({ mode, accountId })
      return
    }
    if (!accountId) {
      setConnectError('Connect an AI first — Claude Code on this computer, or an API key — so Chief can interview you.')
      return
    }
    setChecking(true)
    setConnectError(null)
    try {
      const res = (await commands.testAiAccount(accountId)) as { ok?: boolean; detail?: string } | undefined
      if (res && res.ok === false) {
        setConnectError(res.detail ?? 'This AI didn’t answer. Check the key or the sign-in and try again.')
        return
      }
      await updateSettings.mutateAsync({ aiEngine: { defaultAccountId: accountId } })
      void qc.invalidateQueries({ queryKey: ['aiAccounts'] })
      onNext({ mode, accountId })
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Couldn’t check this AI. Try again.')
    } finally {
      setChecking(false)
    }
  }

  // Merge newly-connected account (optimistic) with the live list so it appears
  // immediately without waiting for a refetch.
  const displayAccounts: AiAccount[] = (() => {
    const base = aiAccounts ?? []
    if (connected && !base.find((a) => a.id === connected.id)) {
      return [connected, ...base]
    }
    return base
  })()

  const hasAccounts = displayAccounts.length > 0
  const connectedHarnessIds = new Set(displayAccounts.map((a) => a.harness))

  /** Connect a detected local harness as a keyless "session" account. */
  async function handleConnectHarness(harnessId: string, name: string) {
    const acc = await commands.createAiAccount({
      harness: harnessId,
      name,
      tokenEnc: '',
      tokenHint: 'Local session',
      tag: 'session',
    })
    setConnected(acc)
    setExistingAccountId(acc.id)
    setSelfHostPick('existing')
  }

  const seg = (id: AIMode, label: string) => {
    const on = mode === id
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => {
          setMode(id)
          if (id === 'cloud') capture('connect_to_cloud_clicked', {})
        }}
        className={`flex h-[28px] items-center rounded-sm px-[10px] text-[12px] font-medium ${on ? 'bg-surface text-ink' : 'text-muted'}`}
        style={on ? { boxShadow: '0 1px 2px #00000014' } : undefined}
      >
        {label}
      </button>
    )
  }

  async function handleConnectKey(harness: string, name: string, key: string) {
    setConnecting(true)
    setConnectError(null)
    try {
      const hint =
        key.length > 8
          ? `${key.slice(0, 6)}...${key.slice(-4)}`
          : '...****'
      const acc = await commands.createAiAccount({
        harness,
        name,
        tokenEnc: key,
        tokenHint: hint,
      })
      setConnected(acc)
      setExistingAccountId(acc.id)
      // Switch back to the existing-accounts view so the new account is visible
      setSelfHostPick('existing')
    } catch (err) {
      setConnectError(
        err instanceof Error ? err.message : 'Connection failed. Check your key and try again.',
      )
    } finally {
      setConnecting(false)
    }
  }

  return (
    <WizardCard>
      <div className="flex min-w-0 flex-1 flex-col gap-[16px] px-[24px] py-[28px] sm:px-[48px] sm:py-[44px] lg:min-h-0 lg:overflow-y-auto">
        <StepEyebrow step="your-ai" />
        <h1 className="font-display text-[24px] font-semibold tracking-[-0.5px] text-ink sm:text-[30px]">
          {copy.title}
        </h1>
        <p className="w-full text-[15px] leading-[1.55] text-ink-2">{copy.lead}</p>

        {/* Mode switcher (Self-host / Cloud) */}
        <div className="flex w-full items-center gap-[12px]">
          <div
            role="radiogroup"
            aria-label="Where it runs"
            className="flex gap-[2px] rounded-base bg-soft p-[2px] outline-1 -outline-offset-1 outline-line"
          >
            {seg('self-host', 'Self-host')}
            {seg('cloud', 'Cloud')}
          </div>
          <span className="text-[13px] text-muted">{copy.hint}</span>
        </div>

        {/* ── Self-host ── */}
        {mode === 'self-host' && (
          <div className="flex flex-col gap-[16px]">
            {/* Detected local harness CLIs — connect a running session, no key */}
            <div className="flex flex-col gap-[8px]">
              <span className="text-[11px] font-semibold tracking-[0.8px] text-muted">
                DETECTED ON THIS COMPUTER
              </span>
              <DetectedHarnesses
                onConnect={handleConnectHarness}
                connectedHarnessIds={connectedHarnessIds}
              />
            </div>

          <div role="radiogroup" aria-label="AI account" className="flex flex-col gap-[8px]">
            {/* "Existing accounts" option — shown when there are accounts or still loading */}
            {(hasAccounts || accountsLoading) && (
              <OptionCard
                icon={copy.options.find((o) => o.id === 'existing')?.icon ?? copy.options[0].icon}
                title={
                  copy.options.find((o) => o.id === 'existing')?.title ??
                  'Use an account already connected'
                }
                desc={copy.options.find((o) => o.id === 'existing')?.desc ?? ''}
                selected={selfHostPick === 'existing'}
                onSelect={() => setSelfHostPick('existing')}
              />
            )}

            {/* Pool list (shown when "existing" is selected) */}
            {selfHostPick === 'existing' && (
              <div className="flex flex-col gap-[6px] pl-[8px]">
                {accountsLoading && (
                  <p className="pl-[8px] text-[12px] text-muted">Loading accounts…</p>
                )}
                {displayAccounts.map((acc) => (
                  <ExistingAccountRow
                    key={acc.id}
                    account={acc}
                    selected={existingAccountId === acc.id}
                    onSelect={() => setExistingAccountId(acc.id)}
                  />
                ))}
                {!accountsLoading && displayAccounts.length === 0 && (
                  <p className="pl-[8px] text-[12px] text-muted">
                    No AI accounts connected yet.{' '}
                    <button
                      type="button"
                      className="font-medium text-link hover:underline"
                      onClick={() => setSelfHostPick('api-key')}
                    >
                      Add one below.
                    </button>
                  </p>
                )}
              </div>
            )}

            {/* API key option — collapsed card when not selected, expanded form when selected */}
            {selfHostPick === 'api-key' ? (
              <ApiKeyForm
                onConnect={handleConnectKey}
                connecting={connecting}
                error={connectError}
              />
            ) : (
              <OptionCard
                icon={
                  copy.options.find((o) => o.id === 'api-key')?.icon ?? KeyRound
                }
                title={
                  copy.options.find((o) => o.id === 'api-key')?.title ?? 'Connect an API key'
                }
                desc={copy.options.find((o) => o.id === 'api-key')?.desc ?? ''}
                chips={copy.options.find((o) => o.id === 'api-key')?.chips}
                selected={false}
                onSelect={() => setSelfHostPick('api-key')}
              />
            )}
          </div>
          </div>
        )}

        {/* ── Cloud: trial / pack / plan, settled here (no jump to the pricing pages) ── */}
        {mode === 'cloud' && <CloudSetup s={cloud} />}

        <div className="w-px flex-1" />

        {/* Footer */}
        {connectError && selfHostPick === 'existing' && mode === 'self-host' && (
          <p role="alert" className="w-full text-[13px] text-bad">{connectError}</p>
        )}
        <div className="flex w-full items-center gap-[10px]">
          <QuietButton icon={ArrowLeft} onClick={onBack}>
            Back
          </QuietButton>
          <span className="h-px flex-1" />
          {copy.footQ && <span className="text-[13px] text-muted">{copy.footQ}</span>}
          {copy.footA && (
            <button
              type="button"
              onClick={() => mode === 'cloud' && setMode('self-host')}
              className="text-[13px] font-medium text-link hover:underline"
            >
              {copy.footA}
            </button>
          )}
          <PrimaryButton
            icon={ArrowRight}
            onClick={() =>
              mode === 'cloud'
                ? cloud.busy ? undefined : void cloud.start()
                : checking ? undefined : void confirmAccount(existingAccountId ?? displayAccounts[0]?.id ?? null)
            }
          >
            {mode === 'cloud' ? cloud.cta : checking ? 'Checking your AI…' : copy.cta}
          </PrimaryButton>
        </div>
      </div>

      {/* "Good to know" aside — stacks below the form (full width) under lg. */}
      <aside
        className="flex w-full shrink-0 flex-col gap-[18px] border-t border-[var(--color-line)] bg-soft px-[24px] py-[28px] sm:px-[32px] lg:w-[360px] lg:border-t-0 lg:border-l lg:py-[44px]"
      >
        <h2 className="text-[11px] font-semibold tracking-[1px] text-muted">GOOD TO KNOW</h2>
        {copy.good.map((g) => (
          <div key={g.title} className="flex w-full gap-[12px]">
            <IconTile icon={g.icon} />
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="text-[13px] font-semibold text-ink">{g.title}</span>
              <span className="w-full text-[12px] leading-[1.5] text-muted">{g.desc}</span>
            </div>
          </div>
        ))}
      </aside>
    </WizardCard>
  )
}
