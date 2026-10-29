import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Ellipsis, KeyRound, Plug, Plus, RefreshCw, Search, Server, Trash2 } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Dialog } from '../../../ui/ds/Dialog'
import { MenuItemBody, MenuSeparatorLine, menuItemClass, menuSurface } from '../../../ui/ds/Menu'
import { ConfirmDialog } from '../../../ui/ds/ConfirmDialog'
import { Breadcrumb, SectionPane, StatusBadge, Toggle } from '../legacyShared'
import type { DialogKind } from '../legacyTypes'
import { notify } from '../../../ui/ds/Toaster'
import {
  useConnectorCredentials,
  useConnectors,
  useDeleteMcpServer,
  useDisconnectConnector,
  useInstallConnector,
  useMarketplace,
  useMcpServers,
  useReauthConnector,
  useRefreshMarketplace,
  useUpdateConnector,
} from '../../../app/queries'
import type { Connector } from '../../../core/domain/types'
import type { McpServer } from '../../../core/domain/controlPanel'
import { capture } from '../../../telemetry'
import { useCommands } from '../../../app/CommandsProvider'
import { useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../format'

// ── helpers ───────────────────────────────────────────────────────────────────

function statusColor(status: string): 'ok' | 'warn' | 'bad' | 'info' | 'neutral' {
  if (status === 'connected') return 'ok'
  if (status === 'needs_auth' || status === 'pending') return 'warn'
  if (status === 'error') return 'bad'
  return 'neutral'
}

function statusLabel(status: string): string {
  if (status === 'connected') return 'Connected'
  if (status === 'needs_auth') return 'Needs auth'
  if (status === 'error') return 'Error'
  if (status === 'pending') return 'Pending'
  return status
}

const fieldLabel = (f: string) => f.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

// ── ⋯ menu for a connected connector row ─────────────────────────────────────

function ConnectorMoreMenu({ connector, onReconnect, onDisconnect }: {
  connector: Connector
  onReconnect: () => void
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
          <DropdownMenu.Item className={menuItemClass} onSelect={onReconnect}>
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

// ── credentials form ──────────────────────────────────────────────────────────

function CredentialsDialog({ connector, onClose }: { connector: Connector; onClose: () => void }) {
  const fields = connector.auth?.fields?.length ? connector.auth.fields : ['api_key']
  const [values, setValues] = useState<Record<string, string>>({})
  const save = useConnectorCredentials()
  const complete = fields.every((f) => (values[f] ?? '').trim())

  async function submit() {
    try {
      await save.mutateAsync({ id: connector.id, fields: Object.fromEntries(fields.map((f) => [f, values[f].trim()])) })
      notify(`${connector.label} connected`)
      onClose()
    } catch (e) {
      notify(errorMessage(e, 'Could not save credentials'))
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(v) => { if (!v) onClose() }}
      title={`Connect ${connector.label}`}
      subtitle={
        connector.auth?.type === 'oauth2'
          ? `Paste an access token from ${connector.auth.provider ?? connector.label}. Stored encrypted.`
          : 'Stored encrypted. Only used when a helper calls this app.'
      }
      width={460}
      footer={
        <>
          <span className="flex-1" />
          <Button variant="secondary" style={{ height: 32 }} onClick={onClose}>Cancel</Button>
          <Button variant="primary" style={{ height: 32 }} disabled={!complete || save.isPending} onClick={() => void submit()}>
            {save.isPending ? 'Connecting…' : 'Connect'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[12px]">
        {fields.map((f) => (
          <label key={f} className="flex flex-col gap-[6px]">
            <span className="text-[12.5px] font-medium text-ink">{fieldLabel(f)}</span>
            <input
              type={/key|token|secret|password/i.test(f) ? 'password' : 'text'}
              aria-label={fieldLabel(f)}
              value={values[f] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
              className="h-[34px] rounded-base border border-line-strong bg-soft px-[12px] font-mono text-[12.5px] text-ink outline-none focus:border-ink"
            />
          </label>
        ))}
      </div>
    </Dialog>
  )
}

// ── MCP server rows ──────────────────────────────────────────────────────────

function McpServerRow({ server, last, onRemove }: { server: McpServer; last: boolean; onRemove: () => void }) {
  const commands = useCommands()
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  async function refresh() {
    setRefreshing(true)
    try {
      const s = await commands.refreshMcpServer(server.id)
      await qc.invalidateQueries({ queryKey: ['mcpServers'] })
      notify(s.status === 'connected' ? `${s.name}: ${s.tools.length} tools` : (s.error ?? `${s.name} is unreachable`))
    } catch (e) {
      notify(errorMessage(e, 'Refresh failed'))
    } finally {
      setRefreshing(false)
    }
  }
  return (
    <div className={`flex items-center gap-[12px] px-[16px] py-[12px] ${last ? '' : 'border-b border-line'}`}>
      <span className="flex size-[32px] shrink-0 items-center justify-center rounded-base border border-line-strong bg-soft">
        <Server size={14} className="text-muted" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
        <span className="text-[13px] font-semibold text-ink">{server.name}</span>
        <span className="truncate text-[12px] text-muted">
          {server.kind === 'openapi' ? 'Built from OpenAPI' : server.url}
          {' · '}
          {server.status === 'error' ? (server.error ?? 'unreachable') : `${server.tools.length} tool${server.tools.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <StatusBadge label={statusLabel(server.status)} color={statusColor(server.status)} />
      {server.kind === 'remote' && (
        <Button variant="secondary" height={28} icon={RefreshCw} disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? 'Checking…' : 'Check'}
        </Button>
      )}
      <button type="button" aria-label={`Remove ${server.name}`} onClick={onRemove} className="flex size-[28px] items-center justify-center rounded-sm text-muted hover:bg-hover">
        <Trash2 size={14} aria-hidden />
      </button>
    </div>
  )
}

// ── main section ──────────────────────────────────────────────────────────────

interface Props {
  onDialog: (d: DialogKind) => void
}

export function SectionConnectors({ onDialog }: Props) {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const { data: connectors, isError: connectorsError } = useConnectors()
  const { data: allPieces } = useMarketplace()
  const { data: pieces, isFetching: piecesLoading } = useMarketplace({
    ...(category ? { category } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  })
  const { data: servers = [] } = useMcpServers()
  const install = useInstallConnector()
  const updateConnector = useUpdateConnector()
  const disconnect = useDisconnectConnector()
  const reauth = useReauthConnector()
  const refreshCatalog = useRefreshMarketplace()
  const deleteServer = useDeleteMcpServer()

  const [disconnectTarget, setDisconnectTarget] = useState<Connector | null>(null)
  const [removeServer, setRemoveServer] = useState<McpServer | null>(null)
  const [credentialsFor, setCredentialsFor] = useState<Connector | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)

  const categories = [...new Set((allPieces ?? []).map((p) => p.category))].sort()

  async function handleInstall(pieceId: string) {
    setInstalling(pieceId)
    try {
      const c = await install.mutateAsync(pieceId)
      capture('connector_installed', { piece: pieceId })
      if (c.status === 'needs_auth') {
        const piece = (allPieces ?? []).find((p) => p.id === pieceId)
        const oauth = piece?.authType === 'oauth2'
        setCredentialsFor({
          ...c,
          auth: c.auth ?? { type: piece?.authType ?? 'api_key', provider: null, fields: [oauth ? 'access_token' : 'api_key'] },
        })
      } else {
        notify('Connector installed')
      }
    } catch (e) {
      notify(errorMessage(e, 'Install failed'))
    } finally {
      setInstalling(null)
    }
  }

  async function handleDisconnect() {
    if (!disconnectTarget) return
    try {
      await disconnect.mutateAsync(disconnectTarget.id)
      notify(`${disconnectTarget.label} disconnected`)
    } catch (e) {
      notify(errorMessage(e, 'Disconnect failed'))
    }
  }

  async function handleReconnect(connector: Connector) {
    try {
      const c = await reauth.mutateAsync(connector.id)
      setCredentialsFor({ ...connector, ...c })
    } catch (e) {
      notify(errorMessage(e, 'Reconnect failed'))
    }
  }

  async function handleToggle(connector: Connector) {
    try {
      await updateConnector.mutateAsync({ id: connector.id, enabled: !connector.enabled })
      notify(`${connector.label} ${connector.enabled ? 'turned off' : 'turned on'}`)
    } catch (e) {
      notify(errorMessage(e, 'Could not update connector'))
    }
  }

  async function handleRefreshCatalog() {
    try {
      await refreshCatalog.mutateAsync()
      notify('Marketplace refreshed')
    } catch (e) {
      notify(errorMessage(e, 'Could not refresh the marketplace'))
    }
  }

  async function handleRemoveServer() {
    if (!removeServer) return
    try {
      await deleteServer.mutateAsync(removeServer.id)
      notify(`${removeServer.name} removed`)
    } catch (e) {
      notify(errorMessage(e, 'Could not remove server'))
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
          <Button variant="secondary" height={28} onClick={() => onDialog('build-oas')}>
            Build from OpenAPI
          </Button>
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
                    {c.status === 'needs_auth' ? (
                      <Button variant="secondary" height={28} icon={KeyRound} onClick={() => setCredentialsFor(c)}>
                        Connect
                      </Button>
                    ) : (
                      <StatusBadge label={statusLabel(c.status)} color={statusColor(c.status)} />
                    )}
                    <Toggle on={c.enabled} label={`${c.label} enabled`} onClick={() => void handleToggle(c)} />
                    <ConnectorMoreMenu
                      connector={c}
                      onReconnect={() => void handleReconnect(c)}
                      onDisconnect={() => setDisconnectTarget(c)}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* MCP servers */}
        {servers.length > 0 && (
          <>
            <p className="mb-[10px] text-[12px] font-medium uppercase tracking-[0.8px] text-faint">
              MCP servers · {servers.length}
            </p>
            <div className="mb-[24px] overflow-hidden rounded-lg border border-line-strong bg-surface">
              {servers.map((s, i) => (
                <McpServerRow key={s.id} server={s} last={i === servers.length - 1} onRemove={() => setRemoveServer(s)} />
              ))}
            </div>
          </>
        )}

        {/* Browse marketplace */}
        <div className="mb-[10px] flex items-center gap-[8px]">
          <p className="text-[13px] font-medium text-ink">Browse marketplace</p>
          <div className="flex-1" />
          <label className="flex h-[28px] w-[220px] items-center gap-[6px] rounded-btn bg-surface px-[8px] outline-1 -outline-offset-1 outline-line-strong">
            <Search size={13} aria-hidden className="shrink-0 text-faint" />
            <input
              type="search"
              aria-label="Search marketplace"
              placeholder="Search apps"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
            />
          </label>
          <Button variant="secondary" height={28} icon={RefreshCw} disabled={refreshCatalog.isPending} onClick={() => void handleRefreshCatalog()}>
            {refreshCatalog.isPending ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
        {categories.length > 0 && (
          <div className="mb-[12px] flex flex-wrap gap-[4px]">
            {['', ...categories].map((cat) => (
              <button
                key={cat || 'all'}
                type="button"
                aria-pressed={category === cat}
                onClick={() => setCategory(cat)}
                className={`rounded-pill px-[10px] py-[4px] text-[12px] capitalize transition-colors ${
                  category === cat ? 'bg-ink text-white' : 'text-muted hover:bg-hover hover:text-ink'
                }`}
              >
                {cat || 'All'}
              </button>
            ))}
          </div>
        )}
        {browsePieces.length === 0 && !piecesLoading && (
          <p className="mb-[16px] text-[12.5px] text-muted">
            {q || category ? 'No apps match.' : 'Everything in the marketplace is installed.'}
          </p>
        )}
        {browsePieces.length > 0 && (
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
                  onClick={() => void handleInstall(piece.id)}
                >
                  Install
                </Button>
              </div>
            ))}
          </div>
        )}
      </SectionPane>

      {credentialsFor && <CredentialsDialog connector={credentialsFor} onClose={() => setCredentialsFor(null)} />}

      {/* Disconnect confirm dialog */}
      <ConfirmDialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => { if (!open) setDisconnectTarget(null) }}
        title={`Disconnect ${disconnectTarget?.label ?? ''}?`}
        message={`This will remove the connector and revoke its access. You can reconnect it later from the marketplace.`}
        confirmLabel="Disconnect"
        tone="danger"
        onConfirm={() => void handleDisconnect()}
      />
      <ConfirmDialog
        open={removeServer !== null}
        onOpenChange={(open) => { if (!open) setRemoveServer(null) }}
        title={`Remove ${removeServer?.name ?? ''}?`}
        message="Helpers lose access to its tools."
        confirmLabel="Remove"
        tone="danger"
        onConfirm={() => void handleRemoveServer()}
      />
    </div>
  )
}
