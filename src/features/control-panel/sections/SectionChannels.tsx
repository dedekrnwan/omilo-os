import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Archive, Bell, BellOff, Ellipsis, Lock, Plus, Trash2 } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Breadcrumb, SectionPane } from '../legacyShared'
import { Mascot } from '../../../ui/ds/Mascot'
import { MenuItemBody, MenuSeparatorLine, menuItemClass, menuSurface } from '../../../ui/ds/Menu'
import { ConfirmDialog } from '../../../ui/ds/ConfirmDialog'
import { notify } from '../../../ui/ds/Toaster'
import { CreateChannelDialog } from '../../chat/CreateChannelDialog'
import { useDeleteChannel, useManagedChannels, useUpdateChannel } from '../../../app/queries'
import type { ManagedChannel } from '../../../core/domain/controlPanel'
import { errorMessage, shortDate } from '../format'

type MascotArea = 'dev' | 'marketing' | 'ops' | 'finance' | 'sales' | 'support' | 'retro' | 'brand'
const AREAS: MascotArea[] = ['dev', 'marketing', 'ops', 'finance', 'sales', 'support', 'retro', 'brand']

/** Channel accent → mascot area for the channel tile. */
const ACCENT_AREA: Record<string, MascotArea> = { general: 'ops', dev: 'dev', marketing: 'marketing', sales: 'sales' }

const asArea = (a: string): MascotArea => (AREAS.includes(a as MascotArea) ? (a as MascotArea) : 'ops')

const CONTEXT_LABEL: Record<string, string> = {
  isolated: 'Isolated',
  isolated_general: 'Isolated + General',
  company: 'Company-wide',
}

function AgentStack({ channel }: { channel: ManagedChannel }) {
  if (channel.helpers.length === 0) return <span className="text-[12.5px] text-muted">—</span>
  return (
    <span className="flex items-center" title={channel.helpers.map((h) => h.name).join(', ')}>
      {channel.helpers.slice(0, 4).map((h, i) => (
        <span key={h.id} style={{ marginLeft: i === 0 ? 0 : -6, zIndex: 4 - i }} className="inline-flex">
          <Mascot helper size={20} radius={0} area={asArea(h.area)} tile={false} />
        </span>
      ))}
    </span>
  )
}

function ChannelMoreMenu({ channel, onMute, onArchive, onRemove }: {
  channel: ManagedChannel
  onMute: () => void
  onArchive: () => void
  onRemove: () => void
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label={`${channel.name} options`} className="flex size-[28px] items-center justify-center rounded-sm text-muted hover:bg-hover">
          <Ellipsis size={14} aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="bottom" align="end" sideOffset={4} className={`z-50 w-[200px] ${menuSurface}`}>
          <DropdownMenu.Item className={menuItemClass} onSelect={onMute}>
            <MenuItemBody icon={channel.muted ? Bell : BellOff} label={channel.muted ? 'Unmute' : 'Mute'} />
          </DropdownMenu.Item>
          {!channel.isDefault && (
            <>
              <DropdownMenu.Item className={menuItemClass} onSelect={onArchive}>
                <MenuItemBody icon={Archive} label="Archive" />
              </DropdownMenu.Item>
              <MenuSeparatorLine />
              <DropdownMenu.Item className={menuItemClass} onSelect={onRemove}>
                <MenuItemBody icon={Trash2} label="Remove" danger />
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function SectionChannels() {
  const qc = useQueryClient()
  const { data: all = [], isLoading, isError } = useManagedChannels()
  const updateChannel = useUpdateChannel()
  const deleteChannel = useDeleteChannel()
  const [creating, setCreating] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<ManagedChannel | null>(null)

  const channels = all.filter((c) => !c.archived)
  const archived = all.filter((c) => c.archived)

  async function patch(ch: ManagedChannel, input: { archived?: boolean; muted?: boolean }, done: string) {
    try {
      await updateChannel.mutateAsync({ id: ch.id, input })
      notify(done)
    } catch (e) {
      notify(errorMessage(e, 'Could not update channel'))
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return
    const ch = removeTarget
    try {
      await deleteChannel.mutateAsync(ch.id)
      notify(`${ch.name} removed`)
    } catch (e) {
      notify(errorMessage(e, 'Could not remove channel'))
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Channels & areas" />
        <div className="ml-auto">
          <Button variant="primary" height={28} icon={Plus} onClick={() => setCreating(true)}>New channel</Button>
        </div>
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">Channels & areas</h1>
        <p className="mb-[24px] text-[13px] text-muted">Each channel is an area with its own chats, goals, flows and docs. General is the default and can't be removed.</p>

        {isLoading && <p className="mb-[32px] text-[13px] text-muted">Loading channels…</p>}
        {isError && <p className="mb-[32px] text-[13px] text-muted">Could not load channels. Please try again.</p>}

        {/* Table */}
        {!isLoading && !isError && (
          <div className="mb-[32px] overflow-hidden rounded-lg border border-line-strong bg-surface">
            <div className="grid grid-cols-[1fr_80px_60px_160px_32px] items-center border-b border-line bg-soft px-[16px] py-[8px] text-[11px] font-medium uppercase tracking-[0.8px] text-faint">
              <span>Channel</span>
              <span>Agents</span>
              <span>People</span>
              <span>Context</span>
              <span />
            </div>
            {channels.length === 0 && <p className="px-[16px] py-[12px] text-[13px] text-muted">No channels yet.</p>}
            {channels.map((ch, i) => (
              <div
                key={ch.id}
                className={`grid grid-cols-[1fr_80px_60px_160px_32px] items-center px-[16px] py-[10px] ${
                  i < channels.length - 1 ? 'border-b border-line' : ''
                }`}
              >
                <div className="flex items-center gap-[10px]">
                  <Mascot helper size={28} radius={8} area={ACCENT_AREA[ch.accent] ?? 'ops'} tile />
                  <div>
                    <p className="flex items-center gap-[6px] text-[13px] font-medium text-ink">
                      {ch.name}
                      {ch.muted && <BellOff size={12} aria-label="Muted" className="text-muted" />}
                    </p>
                    <p className="text-[11.5px] text-muted">
                      {ch.isDefault
                        ? `Default · ${ch.chatCount} chats`
                        : `${ch.chatCount} chats · ${ch.goalCount} goal${ch.goalCount === 1 ? '' : 's'}`}
                    </p>
                  </div>
                </div>
                <AgentStack channel={ch} />
                <span className="text-[12.5px] text-ink">{ch.peopleCount ?? 'All'}</span>
                <div className="flex items-center gap-[4px]">
                  <Lock size={12} className="text-muted" aria-hidden />
                  <span className="text-[12.5px] text-ink">
                    {ch.isDefault ? 'Company-wide' : (CONTEXT_LABEL[ch.contextScope] ?? ch.contextScope)}
                  </span>
                </div>
                <ChannelMoreMenu
                  channel={ch}
                  onMute={() => void patch(ch, { muted: !ch.muted }, ch.muted ? `${ch.name} unmuted` : `${ch.name} muted`)}
                  onArchive={() => void patch(ch, { archived: true }, `${ch.name} archived`)}
                  onRemove={() => setRemoveTarget(ch)}
                />
              </div>
            ))}
          </div>
        )}

        {/* Archived */}
        <h2 className="mb-[12px] text-[15px] font-semibold text-ink">Archived channels</h2>
        {archived.length === 0 && !isLoading && (
          <p className="text-[12.5px] text-muted">Nothing archived. Archived channels stay read-only here.</p>
        )}
        <div className="flex flex-col gap-[8px]">
          {archived.map((a) => (
            <div key={a.id} className="flex items-center gap-[12px] rounded-lg border border-line-strong bg-soft px-[16px] py-[10px]">
              <div className="flex size-[28px] shrink-0 items-center justify-center rounded-base bg-line-strong">
                <Lock size={14} className="text-muted" aria-hidden />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                <span className="text-[13px] font-medium text-ink">{a.name}</span>
                <span className="text-[11.5px] text-muted">
                  Archived {shortDate(a.archivedAt) || 'earlier'} · read-only · {a.chatCount} chats
                </span>
              </div>
              <Button variant="secondary" height={28} onClick={() => void patch(a, { archived: false }, `${a.name} restored`)}>Restore</Button>
            </div>
          ))}
        </div>
      </SectionPane>

      <CreateChannelDialog
        open={creating}
        onOpenChange={(open) => {
          setCreating(open)
          if (!open) void qc.invalidateQueries({ queryKey: ['managedChannels'] })
        }}
      />
      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null) }}
        title={`Remove ${removeTarget?.name ?? ''}?`}
        message="Its goals and folders are deleted; chats move out of the channel. Archive instead to keep it read-only."
        confirmLabel="Remove"
        tone="danger"
        onConfirm={() => void confirmRemove()}
      />
    </div>
  )
}
