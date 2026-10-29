/**
 * SectionAiAccounts — AI accounts rewired to live useAiAccounts() data.
 * Shows account pool with name, harness, status, pctWindow, lastUsed.
 * Empty state when no accounts. Error state when query rejects.
 */
import { useState } from 'react'
import { KeyRound, Plus, RefreshCw } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Breadcrumb, SectionPane, StatusBadge } from '../legacyShared'
import type { DialogKind } from '../legacyTypes'
import { HARNESS_BY_ID } from '../harnesses'
import type { HarnessId } from '../harnesses'
import { useAiAccounts, useCheckAiAccounts, useTestAiAccount } from '../../../app/queries'
import { notify } from '../../../ui/ds/Toaster'

const GRID = 'grid-cols-[168px_1fr_96px_176px_80px_auto]'

interface Props {
  onDialog: (d: DialogKind) => void
}

function statusColor(status: string): 'info' | 'ok' | 'warn' | 'bad' | 'neutral' {
  if (status === 'near_limit' || status === 'cooling') return 'warn'
  if (status === 'error') return 'bad'
  if (status === 'ready') return 'ok'
  return 'info'
}

function statusLabel(status: string): string {
  if (status === 'ready') return 'Ready'
  if (status === 'near_limit') return 'Near limit'
  if (status === 'cooling') return 'Cooling'
  if (status === 'error') return 'Error'
  return status
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
  const [testingId, setTestingId] = useState<string | null>(null)

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
          <div className="rounded-lg border border-line-strong bg-surface px-[16px] py-[20px] text-center">
            <KeyRound size={20} className="mx-auto mb-[8px] text-faint" aria-hidden />
            <p className="text-[13px] text-muted">No AI accounts configured yet.</p>
            <Button variant="primary" height={28} icon={Plus} style={{ marginTop: 12 }} onClick={() => onDialog('add-harness')}>
              Add account
            </Button>
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
              {accounts.map((a, i) => {
                const harness = HARNESS_BY_ID[a.harness as HarnessId] ?? HARNESS_BY_ID['claude-code']
                return (
                  <div
                    key={a.id}
                    className={`grid ${GRID} items-center px-[16px] py-[10px] ${i < accounts.length - 1 ? 'border-b border-line' : ''}`}
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
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
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
