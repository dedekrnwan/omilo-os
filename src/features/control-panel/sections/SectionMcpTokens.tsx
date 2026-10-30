/**
 * SectionMcpTokens — list MCP access tokens, mint (raw secret shown once), revoke via ConfirmDialog.
 *
 * Mirrors SectionConnectors' row + ⋯ menu layout.
 * Raw token secret is shown EXACTLY ONCE in a copyable input after mint — never in the list,
 * never after the dialog is dismissed.
 */
import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Copy, Ellipsis, KeyRound, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../../../ui/ds/Button'
import { Dialog } from '../../../ui/ds/Dialog'
import { ConfirmDialog } from '../../../ui/ds/ConfirmDialog'
import { MenuItemBody, MenuSeparatorLine, menuItemClass, menuSurface } from '../../../ui/ds/Menu'
import { Breadcrumb, SectionPane, StatusBadge } from '../legacyShared'
import { notify } from '../../../ui/ds/Toaster'
import { useHelpers, useMcpTokens, useMintMcpToken, useRevokeMcpToken } from '../../../app/queries'
import type { McpToken } from '../../../core/domain/types'
import { capture } from '../../../telemetry'
import { EmptyState } from '../../../ui/ds/EmptyState'

// ── constants ─────────────────────────────────────────────────────────────────

const ALL_SCOPES = ['identity', 'goals', 'routines', 'flows', 'docs', 'skills', 'propose', 'connectors'] as const

// ── sub-components ────────────────────────────────────────────────────────────

function TokenMoreMenu({ token, onRevoke }: {
  token: McpToken
  onRevoke: () => void
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`${token.label} options`}
          className="flex size-[28px] items-center justify-center rounded-sm text-muted hover:bg-hover"
        >
          <Ellipsis size={14} aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="bottom" align="end" sideOffset={4} className={`z-50 w-[200px] ${menuSurface}`}>
          <MenuSeparatorLine />
          <DropdownMenu.Item className={menuItemClass} onSelect={onRevoke}>
            <MenuItemBody icon={Trash2} label="Revoke" danger />
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ── mint dialog ───────────────────────────────────────────────────────────────

interface MintForm {
  label: string
  helperId: string
  scopes: string[]
}

type MintDialogPhase = 'form' | 'secret'

function MintDialog({
  open,
  onOpenChange,
  onMinted,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onMinted: (secret: string) => void
}) {
  const { data: helpers = [] } = useHelpers()
  const mint = useMintMcpToken()
  const defaultHelper = helpers.find((h) => h.isChief)?.id ?? helpers[0]?.id ?? ''
  const [form, setForm] = useState<MintForm>({ label: '', helperId: '', scopes: [] })
  const helperId = form.helperId || defaultHelper
  const [minting, setMinting] = useState(false)
  const [phase, setPhase] = useState<MintDialogPhase>('form')
  const [secret, setSecret] = useState('')
  const [copied, setCopied] = useState(false)

  function handleOpenChange(v: boolean) {
    if (!v) {
      // Reset on close
      setForm({ label: '', helperId: '', scopes: [] })
      setPhase('form')
      setSecret('')
      setCopied(false)
    }
    onOpenChange(v)
  }

  function toggleScope(scope: string) {
    setForm((f) => ({
      ...f,
      scopes: f.scopes.includes(scope)
        ? f.scopes.filter((s) => s !== scope)
        : [...f.scopes, scope],
    }))
  }

  async function handleCreate() {
    if (!form.label.trim() || !helperId) return
    setMinting(true)
    try {
      const result = await mint.mutateAsync({
        label: form.label.trim(),
        helperId,
        scopes: form.scopes.length > 0 ? form.scopes : ['identity'],
      })
      setSecret(result.token)
      setPhase('secret')
      capture('mcp_token_minted', {})
      onMinted(result.token)
    } catch {
      notify('Failed to mint token')
    } finally {
      setMinting(false)
    }
  }

  function handleCopy() {
    void navigator.clipboard.writeText(secret).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Mint MCP token"
      subtitle={phase === 'form' ? 'Create a token an MCP client can use to authenticate.' : undefined}
      width={480}
      footer={
        phase === 'form' ? (
          <>
            <span className="flex-1" />
            <Button variant="secondary" style={{ height: 32 }} onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" style={{ height: 32 }} disabled={!form.label.trim() || !helperId || minting} onClick={handleCreate}>
              Create
            </Button>
          </>
        ) : (
          <>
            <span className="flex-1" />
            <Button variant="primary" style={{ height: 32 }} onClick={() => handleOpenChange(false)}>
              Done
            </Button>
          </>
        )
      }
    >
      {phase === 'form' ? (
        <div className="flex flex-col gap-[14px]">
          {/* Label */}
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="mint-label" className="text-[12.5px] font-medium text-ink">
              Label
            </label>
            <input
              id="mint-label"
              aria-label="Label"
              type="text"
              placeholder="e.g. Chief · Cursor"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              className="h-[34px] rounded-base border border-line-strong bg-soft px-[12px] text-[13px] text-ink outline-none focus:border-ink"
            />
          </div>

          {/* Helper ID */}
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="mint-helper" className="text-[12.5px] font-medium text-ink">
              Helper (acting as)
            </label>
            <select
              id="mint-helper"
              aria-label="Helper ID"
              value={helperId}
              onChange={(e) => setForm((f) => ({ ...f, helperId: e.target.value }))}
              className="h-[34px] rounded-base border border-line-strong bg-soft px-[12px] text-[13px] text-ink outline-none focus:border-ink"
            >
              {helpers.length === 0 && <option value="">No helpers yet</option>}
              {helpers.map((h) => (
                <option key={h.id} value={h.id}>{h.name}{h.isChief ? ' (Chief)' : ''}</option>
              ))}
            </select>
          </div>

          {/* Scopes */}
          <div className="flex flex-col gap-[6px]">
            <span className="text-[12.5px] font-medium text-ink">Scopes</span>
            <div className="flex flex-wrap gap-[6px]">
              {ALL_SCOPES.map((scope) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() => toggleScope(scope)}
                  className={`rounded-pill border px-[10px] py-[3px] text-[12px] transition-colors ${
                    form.scopes.includes(scope)
                      ? 'border-ink bg-ink text-surface'
                      : 'border-line-strong bg-soft text-muted hover:border-ink hover:text-ink'
                  }`}
                >
                  {scope}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-[14px]">
          <div className="rounded-lg border border-warn-line bg-warn-tint px-[14px] py-[10px]">
            <p className="text-[12.5px] font-medium text-warn">
              Store this token now — you won't see it again.
            </p>
          </div>
          <div className="flex flex-col gap-[6px]">
            <span className="text-[12.5px] font-medium text-ink">Your token</span>
            <div className="flex items-center gap-[8px]">
              <input
                type="text"
                readOnly
                value={secret}
                className="h-[34px] flex-1 rounded-base border border-line-strong bg-soft px-[12px] font-mono text-[12px] text-ink outline-none"
              />
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy token"
                className="flex size-[34px] shrink-0 items-center justify-center rounded-base border border-line-strong bg-soft text-muted hover:bg-hover"
              >
                {copied ? <Check size={14} className="text-ok" aria-hidden /> : <Copy size={14} aria-hidden />}
              </button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  )
}

// ── main section ──────────────────────────────────────────────────────────────

export function SectionMcpTokens() {
  const queryClient = useQueryClient()
  const { data: tokens, isError } = useMcpTokens()
  const { data: helpers = [] } = useHelpers()
  const revoke = useRevokeMcpToken()
  const helperName = (id: string) => helpers.find((h) => h.id === id)?.name ?? id

  const [mintOpen, setMintOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<McpToken | null>(null)

  function handleMinted(_secret: string) {
    void queryClient.invalidateQueries({ queryKey: ['mcpTokens'] })
  }

  async function handleRevoke() {
    if (!revokeTarget) return
    try {
      await revoke.mutateAsync(revokeTarget.id)
      notify(`Token "${revokeTarget.label}" revoked`)
    } catch {
      notify('Revoke failed')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Breadcrumb bar */}
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="MCP tokens" />
        <div className="ml-auto">
          <Button variant="primary" height={28} icon={KeyRound} onClick={() => setMintOpen(true)}>
            Mint token
          </Button>
        </div>
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">MCP tokens</h1>
        <p className="mb-[24px] text-[13px] text-muted">
          Access tokens for MCP clients (Cursor, VS Code, Claude Desktop). Each token grants a client access as a specific helper.
        </p>

        {/* Error state */}
        {isError && (
          <div className="rounded-lg border border-line-strong bg-surface px-[16px] py-[12px]">
            <p className="text-[13px] text-muted">Could not load MCP tokens. Please try again.</p>
          </div>
        )}

        {/* Token list */}
        {!isError && (
          <>
            <p className="mb-[10px] text-[12px] font-medium uppercase tracking-[0.8px] text-faint">
              Tokens · {tokens?.length ?? 0}
            </p>

            {/* Empty state */}
            {tokens && tokens.length === 0 && (
              <div className="rounded-lg border border-line-strong bg-surface">
                <EmptyState
                  title="No MCP tokens yet"
                  description="Mint a token to let an MCP client — Claude Desktop, Cursor — work with your helpers."
                  primary={{ label: 'Mint token', icon: KeyRound, onClick: () => setMintOpen(true) }}
                />
              </div>
            )}

            {tokens && tokens.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-line-strong bg-surface">
                {tokens.map((token, i) => (
                  <div
                    key={token.id}
                    className={`flex items-center gap-[12px] px-[16px] py-[12px] ${i < tokens.length - 1 ? 'border-b border-line' : ''}`}
                  >
                    <span className="flex size-[32px] shrink-0 items-center justify-center rounded-base border border-line-strong bg-soft">
                      <KeyRound size={14} className="text-muted" aria-hidden />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                      <span className="text-[13px] font-semibold text-ink">{token.label}</span>
                      <span className="text-[12px] text-muted">
                        {helperName(token.helperId)}
                        {token.scopes.length > 0 && ` · ${token.scopes.join(', ')}`}
                        {token.lastUsedAt && ` · last used ${new Date(token.lastUsedAt).toLocaleDateString()}`}
                      </span>
                    </div>
                    <StatusBadge
                      label={token.active ? 'Active' : 'Revoked'}
                      color={token.active ? 'ok' : 'neutral'}
                    />
                    <TokenMoreMenu
                      token={token}
                      onRevoke={() => setRevokeTarget(token)}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </SectionPane>

      {/* Mint dialog */}
      <MintDialog
        open={mintOpen}
        onOpenChange={setMintOpen}
        onMinted={handleMinted}
      />

      {/* Revoke confirm dialog */}
      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => { if (!open) setRevokeTarget(null) }}
        title={`Revoke "${revokeTarget?.label ?? ''}"?`}
        message="This token will stop working immediately. Any MCP client using it will lose access."
        confirmLabel="Revoke"
        tone="danger"
        onConfirm={handleRevoke}
      />
    </div>
  )
}
