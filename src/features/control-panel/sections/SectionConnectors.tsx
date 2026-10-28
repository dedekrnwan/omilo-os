import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Ellipsis, Plug, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../../../ui/ds/Button'
import { MenuItemBody, MenuSeparatorLine, menuItemClass, menuSurface } from '../../../ui/ds/Menu'
import { ConfirmDialog } from '../../../ui/ds/ConfirmDialog'
import { Breadcrumb, SectionPane, StatusBadge } from '../legacyShared'
import type { DialogKind } from '../legacyTypes'
import { notify } from '../../../ui/ds/Toaster'
import { useConnectors, useMarketplace } from '../../../app/queries'
import { createCommands } from '../../../adapters/http/commands'
import type { Connector } from '../../../core/domain/types'
import { platform } from '../../../platform'

// ── commands factory ─────────────────────────────────────────────────────────

const BASE_URL = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ?? 'http://localhost:8000'
function getToken(): string | null {
  return platform.tokenStorage.getToken()
}
function getCommands() {
  return createCommands(BASE_URL, getToken)
}

// ── helpers ───────────────────────────────────────────────────────────────────

function statusColor(status: string): 'ok' | 'warn' | 'bad' | 'info' | 'neutral' {
  if (status === 'connected') return 'ok'
  if (status === 'needs_auth') return 'warn'
  if (status === 'error') return 'bad'
  return 'neutral'
}

function statusLabel(status: string): string {
  if (status === 'connected') return 'Connected'
  if (status === 'needs_auth') return 'Needs auth'
  if (status === 'error') return 'Error'
  return status
}

// ── ⋯ menu for a connected connector row ─────────────────────────────────────

function ConnectorMoreMenu({ connector, onDisconnect }: {
  connector: Connector
  onDisconnect: () => void
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`${connector.label} options`}
          className="flex size-[28px] items-center justify-center rounded-sm text-muted hover:bg-hover"
        >
          <Ellipsis size={14} aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="bottom" align="end" sideOffset={4} className={`z-50 w-[200px] ${menuSurface}`}>
          <DropdownMenu.Item className={menuItemClass} onSelect={() => notify(`Reconnecting ${connector.label}…`)}>
            <MenuItemBody icon={RefreshCw} label="Reconnect" />
          </DropdownMenu.Item>
          <MenuSeparatorLine />
          <DropdownMenu.Item className={menuItemClass} onSelect={onDisconnect}>
            <MenuItemBody icon={Trash2} label="Disconnect" danger />
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ── main section ──────────────────────────────────────────────────────────────

interface Props {
  onDialog: (d: DialogKind) => void
}

export function SectionConnectors({ onDialog }: Props) {
  const queryClient = useQueryClient()
  const { data: connectors, isError: connectorsError } = useConnectors()
  const { data: pieces } = useMarketplace()

  const [disconnectTarget, setDisconnectTarget] = useState<Connector | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)

  async function handleInstall(pieceId: string) {
    setInstalling(pieceId)
    try {
      await getCommands().installConnector(pieceId)
      await queryClient.invalidateQueries({ queryKey: ['connectors'] })
      notify('Connector installed')
    } catch {
      notify('Install failed')
    } finally {
      setInstalling(null)
    }
  }

  async function handleDisconnect() {
    if (!disconnectTarget) return
    try {
      await getCommands().disconnectConnector(disconnectTarget.id)
      await queryClient.invalidateQueries({ queryKey: ['connectors'] })
      notify(`${disconnectTarget.label} disconnected`)
    } catch {
      notify('Disconnect failed')
    }
  }

  // Filter marketplace pieces to those not already installed
  const installedPieceIds = new Set((connectors ?? []).map((c) => c.pieceId))
  const browsePieces = (pieces ?? []).filter((p) => !installedPieceIds.has(p.id))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Breadcrumb bar */}
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Connectors" />
        <div className="ml-auto flex items-center gap-[8px]">
          <Button variant="primary" height={28} icon={Plus} onClick={() => onDialog('add-mcp')}>
            Add MCP server
          </Button>
        </div>
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">Connectors</h1>
        <p className="mb-[24px] text-[13px] text-muted">Apps your agents can use. Anything that posts, sends or spends still waits for you.</p>

        {/* Error state */}
        {connectorsError && (
          <div className="mb-[24px] rounded-lg border border-line-strong bg-surface px-[16px] py-[12px]">
            <p className="text-[13px] text-muted">Could not load connectors. Please try again.</p>
          </div>
        )}

        {/* Connected */}
        {!connectorsError && (
          <>
            <p className="mb-[10px] text-[12px] font-medium uppercase tracking-[0.8px] text-faint">
              Connected · {connectors?.length ?? 0}
            </p>

            {/* Empty state */}
            {connectors && connectors.length === 0 && (
              <div className="mb-[24px] rounded-lg border border-line-strong bg-surface px-[16px] py-[20px] text-center">
                <Plug size={20} className="mx-auto mb-[8px] text-faint" aria-hidden />
                <p className="text-[13px] text-muted">No connectors installed yet. Browse the marketplace below to add one.</p>
              </div>
            )}

            {connectors && connectors.length > 0 && (
              <div className="mb-[24px] overflow-hidden rounded-lg border border-line-strong bg-surface">
                {connectors.map((c, i) => (
                  <div
                    key={c.id}
                    className={`flex items-center gap-[12px] px-[16px] py-[12px] ${i < connectors.length - 1 ? 'border-b border-line' : ''}`}
                  >
                    <span className="flex size-[32px] shrink-0 items-center justify-center rounded-base border border-line-strong bg-soft text-[16px]">
                      <Plug size={14} className="text-muted" aria-hidden />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                      <span className="text-[13px] font-semibold text-ink">{c.label}</span>
                      <span className="text-[12px] text-muted">{c.pieceId}</span>
                    </div>
                    <StatusBadge
                      label={statusLabel(c.status)}
                      color={statusColor(c.status)}
                    />
                    <ConnectorMoreMenu
                      connector={c}
                      onDisconnect={() => setDisconnectTarget(c)}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Browse marketplace */}
        {browsePieces.length > 0 && (
          <>
            <p className="mb-[10px] text-[13px] font-medium text-ink">Browse marketplace</p>
            <div className="mb-[16px] grid grid-cols-3 gap-[10px]">
              {browsePieces.map((piece) => (
                <div
                  key={piece.id}
                  className="flex items-center gap-[10px] rounded-lg border border-line-strong bg-surface px-[14px] py-[10px]"
                >
                  <span className="flex size-[28px] shrink-0 items-center justify-center rounded-base border border-line-strong bg-soft text-[14px]">
                    <Plug size={12} className="text-muted" aria-hidden />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                    <span className="text-[13px] font-medium text-ink">{piece.label}</span>
                    <span className="text-[11px] text-muted">{piece.description}</span>
                  </div>
                  <Button
                    variant="secondary"
                    height={28}
                    disabled={installing === piece.id}
                    onClick={() => handleInstall(piece.id)}
                  >
                    Install
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </SectionPane>

      {/* Disconnect confirm dialog */}
      <ConfirmDialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => { if (!open) setDisconnectTarget(null) }}
        title={`Disconnect ${disconnectTarget?.label ?? ''}?`}
        message={`This will remove the connector and revoke its access. You can reconnect it later from the marketplace.`}
        confirmLabel="Disconnect"
        tone="danger"
        onConfirm={handleDisconnect}
      />
    </div>
  )
}
