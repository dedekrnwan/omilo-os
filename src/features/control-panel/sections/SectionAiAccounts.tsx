/**
 * SectionAiAccounts — AI accounts rewired to live useAiAccounts() data.
 * Shows account pool with name, harness, status, pctWindow, lastUsed.
 * Empty state when no accounts. Error state when query rejects.
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Ellipsis, KeyRound, Pause, Pencil, Play, Plus, RefreshCw } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Dialog } from '../../../ui/ds/Dialog'
import { MenuItemBody, menuItemClass, menuSurface } from '../../../ui/ds/Menu'
import { Breadcrumb, SectionPane, StatusBadge } from '../legacyShared'
import type { DialogKind } from '../legacyTypes'
import { HARNESS_BY_ID } from '../harnesses'
import type { HarnessId } from '../harnesses'
import { useAiAccounts, useCheckAiAccounts, useTestAiAccount, useUpdateAiAccount } from '../../../app/queries'
import type { AiAccount } from '../../../core/domain/types'
import { useCommands } from '../../../app/CommandsProvider'
import { notify } from '../../../ui/ds/Toaster'
import { HarnessLogo } from '../../../ui/ds/harnessLogos'
import { DetectedHarnesses } from '../../../ui/ds/DetectedHarnesses'
import { EmptyState } from '../../../ui/ds/EmptyState'

const GRID = 'grid-cols-[168px_1fr_96px_176px_80px_auto]'

interface Props {
  onDialog: (d: DialogKind) => void
}

function statusColor(status: string): 'info' | 'ok' | 'warn' | 'bad' | 'neutral' {
  if (status === 'near_limit' || status === 'cooling') return 'warn'
  if (status === 'error') return 'bad'
  if (status === 'ready') return 'ok'
  if (status === 'paused') return 'neutral'
  return 'info'
}

function statusLabel(status: string): string {
  if (status === 'ready') return 'Ready'
  if (status === 'near_limit') return 'Near limit'
  if (status === 'cooling') return 'Cooling'
  if (status === 'error') return 'Error'
  if (status === 'paused') return 'Paused'
  return status
}

/** Provider-key accounts (not pooled CLI harnesses) display their provider name. */
const PROVIDER_NAMES: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter' }

function AccountMenu({ account, onRename, onTogglePause }: { account: AiAccount; onRename: () => void; onTogglePause: () => void }) {
  const paused = account.status === 'paused'
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label={`${account.name} options`} className="flex size-[28px] items-center justify-center rounded-sm text-muted hover:bg-hover">
          <Ellipsis size={14} aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="bottom" align="end" sideOffset={4} className={`z-50 w-[200px] ${menuSurface}`}>
          <DropdownMenu.Item className={menuItemClass} onSelect={onRename}>
            <MenuItemBody icon={Pencil} label="Rename" />
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItemClass} onSelect={onTogglePause}>
            <MenuItemBody icon={paused ? Play : Pause} label={paused ? 'Resume' : 'Pause'} />
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function RenameDialog({ account, onClose }: { account: AiAccount; onClose: () => void }) {
  const update = useUpdateAiAccount()
  const [name, setName] = useState(account.name)
  async function save() {
    try {
      await update.mutateAsync({ id: account.id, input: { name: name.trim() } })
      notify('Account renamed')
      onClose()
    } catch (e) {
      notify(e instanceof Error && e.message ? e.message : 'Could not rename account')
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => { if (!v) onClose() }}
      title="Rename account"
      width={400}
      footer={
        <>
          <span className="flex-1" />
          <Button variant="secondary" style={{ height: 32 }} onClick={onClose}>Cancel</Button>
          <Button variant="primary" style={{ height: 32 }} disabled={!name.trim() || update.isPending} onClick={() => void save()}>Save</Button>
        </>
      }
    >
      <input
        aria-label="Account name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void save() }}
        className="h-[34px] w-full rounded-base border border-line-strong bg-soft px-[12px] text-[13px] text-ink outline-none focus:border-ink"
      />
    </Dialog>
  )
}

function formatLastUsed(iso: string | null | undefined): string {
  if (!iso) return 'Never'
  try {
    return new Date(iso).toLocaleDateString()
  } catch {
    return iso
  }
}

export function SectionAiAccounts({ onDialog }: Props) {
  const { data: accounts, isError, isLoading } = useAiAccounts()
  const checkAccounts = useCheckAiAccounts()
  const testAccount = useTestAiAccount()
  const commands = useCommands()
  const qc = useQueryClient()
  const [testingId, setTestingId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<AiAccount | null>(null)
  const updateAccount = useUpdateAiAccount()

  async function togglePause(a: AiAccount) {
    const next = a.status === 'paused' ? 'ready' : 'paused'
    try {
      await updateAccount.mutateAsync({ id: a.id, input: { status: next } })
      notify(next === 'paused' ? `${a.name} paused — jobs skip it` : `${a.name} is back in the pool`)
    } catch (e) {
      notify(e instanceof Error && e.message ? e.message : 'Could not update account')
    }
  }

  const connectedHarnessIds = new Set((accounts ?? []).map((a) => a.harness))

  /** Connect a detected local harness as a keyless "session" account. */
  async function handleConnectHarness(harnessId: string, name: string) {
    try {
      await commands.createAiAccount({
        harness: harnessId,
        name,
        tokenEnc: '',
        tokenHint: 'Local session',
        tag: 'session',
      })
      await qc.invalidateQueries({ queryKey: ['aiAccounts'] })
      notify(`${name} connected`)
    } catch (e) {
      notify(e instanceof Error && e.message ? e.message : 'Could not connect harness')
    }
  }

  async function handleCheck() {
    try {
      await checkAccounts.mutateAsync()
      notify('Connection check complete')
    } catch (e) {
      notify(e instanceof Error && e.message ? e.message : 'Connection check failed')
    }
  }

  async function handleTest(id: string) {
    setTestingId(id)
    try {
      await testAccount.mutateAsync(id)
      notify('Account tested')
    } catch (e) {
      notify(e instanceof Error && e.message ? e.message : 'Account test failed')
    } finally {
      setTestingId(null)
    }
  }

  const isEmpty = !isLoading && !isError && accounts && accounts.length === 0

  const total = accounts?.length ?? 0
  const ready = accounts?.filter((a) => a.status === 'ready' || a.status === 'near_limit').length ?? 0
  const working = accounts?.filter((a) => a.status === 'ready').length ?? 0
  const cooling = accounts?.filter((a) => a.status === 'cooling').length ?? 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="AI accounts" />
        <div className="ml-auto">
          <Button variant="secondary" height={28} icon={RefreshCw} disabled={checkAccounts.isPending} onClick={() => void handleCheck()}>
            {checkAccounts.isPending ? 'Checking…' : 'Run connection check'}
          </Button>
        </div>
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">AI accounts</h1>
        <p className="mb-[24px] text-[13px] text-muted">
          The accounts and keys agents run on. When one hits a limit, the next job moves to another.
        </p>

        {/* Detected local harnesses — connect a running CLI session, no key */}
        <div className="mb-[24px]">
          <div className="mb-[8px] flex items-end justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Detected on this computer</h2>
              <p className="text-[12px] text-muted">
                Local coding-assistant sessions Omilo can pool — no API key, uses the CLI you're signed in to.
              </p>
            </div>
          </div>
          <DetectedHarnesses onConnect={handleConnectHarness} connectedHarnessIds={connectedHarnessIds} />
        </div>

        {/* Error state */}
        {isError && (
          <div className="rounded-lg border border-line-strong bg-surface px-[16px] py-[12px]">
            <p className="text-[13px] text-muted">Could not load AI accounts. Please try again.</p>
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="animate-pulse space-y-[12px]">
            <div className="grid grid-cols-3 gap-[12px]">
              <div className="h-[80px] rounded-lg bg-soft" />
              <div className="h-[80px] rounded-lg bg-soft" />
              <div className="h-[80px] rounded-lg bg-soft" />
            </div>
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="rounded-lg border border-line-strong bg-surface">
            <EmptyState
              title="No AI accounts yet"
              description="Add a Claude, ChatGPT or Gemini subscription — or an API key — and your helpers share it."
              primary={{ label: 'Add account', icon: Plus, onClick: () => onDialog('add-harness') }}
            />
          </div>
        )}

        {/* Live account pool */}
        {accounts && accounts.length > 0 && !isError && (
          <>
            {/* Stats */}
            <div className="mb-[24px] grid grid-cols-3 gap-[12px]">
              <StatCard label="Accounts ready" value={`${ready} / ${total}`} hint={cooling === 0 ? 'all healthy' : `${cooling} cooling`} />
              <StatCard label="Working now" value={String(working)} hint="up to 2 jobs each" />
              <StatCard label="Cooling" value={String(cooling)} hint={cooling === 0 ? 'none hit a limit' : 'hit a rate limit'} />
            </div>

            {/* Account pool table */}
            <div className="mb-[8px] flex items-end justify-between">
              <div>
                <h2 className="text-[15px] font-semibold text-ink">Account pool</h2>
                <p className="text-[12px] text-muted">Subscription seats every agent shares — jobs move to the next ready account on a limit.</p>
              </div>
              <div className="flex items-center gap-[6px]">
                <Button variant="secondary" height={28} icon={KeyRound} onClick={() => onDialog('connect-key')}>
                  Add API key
                </Button>
                <Button variant="secondary" height={28} icon={Plus} onClick={() => onDialog('add-harness')}>
                  Add account
                </Button>
              </div>
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
              {accounts.map((a, i) => {
                const harness = HARNESS_BY_ID[a.harness as HarnessId] ?? null
                return (
                  <div
                    key={a.id}
                    className={`grid ${GRID} items-center px-[16px] py-[10px] ${i < accounts.length - 1 ? 'border-b border-line' : ''}`}
                  >
                    {/* Harness */}
                    <div className="flex items-center gap-[8px]">
                      <span className="flex size-[24px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line">
                        {harness ? <HarnessLogo id={harness.id} size={15} /> : <KeyRound size={13} className="text-muted" aria-hidden />}
                      </span>
                      <span className="truncate text-[12.5px] font-medium text-ink">{harness?.name ?? PROVIDER_NAMES[a.harness] ?? a.harness}</span>
                    </div>
                    {/* Account */}
                    <div className="flex items-center gap-[8px]">
                      <span className="flex size-[28px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line">
                        <KeyRound size={13} className="text-muted" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-ink">{a.name}</p>
                        {a.tokens && <p className="font-mono text-[11px] text-muted">{a.tokens}</p>}
                        {a.tag && !a.tokens && <p className="font-mono text-[11px] text-muted">{a.tag}</p>}
                      </div>
                    </div>
                    {/* Status */}
                    <div className="justify-self-start">
                      <StatusBadge label={statusLabel(a.status)} color={statusColor(a.status)} />
                    </div>
                    {/* Usage window */}
                    <div className="flex items-center gap-[8px] pr-[16px] pl-[4px]">
                      <div className="h-[4px] flex-1 overflow-hidden rounded-full bg-line-strong">
                        <div className="h-full rounded-full bg-ink" style={{ width: `${a.pctWindow}%` }} />
                      </div>
                      <span className="shrink-0 text-[12px] text-muted">{a.pctWindow}%</span>
                    </div>
                    {/* Last used */}
                    <span className="text-[12px] text-muted">{formatLastUsed(a.lastUsed)}</span>
                    {/* Actions */}
                    <div className="flex items-center justify-end gap-[4px]">
                      <Button variant="secondary" height={28} disabled={testingId === a.id} onClick={() => void handleTest(a.id)}>
                        {testingId === a.id ? 'Testing…' : 'Test'}
                      </Button>
                      <AccountMenu account={a} onRename={() => setRenaming(a)} onTogglePause={() => void togglePause(a)} />
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </SectionPane>
      {renaming && <RenameDialog account={renaming} onClose={() => setRenaming(null)} />}
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
