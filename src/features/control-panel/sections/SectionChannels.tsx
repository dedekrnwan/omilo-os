import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Archive, BellOff, Ellipsis, Lock, Plus, Trash2 } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Breadcrumb, SectionPane } from '../legacyShared'
import { Mascot } from '../../../ui/ds/Mascot'
import { MenuItemBody, MenuSeparatorLine, menuItemClass, menuSurface } from '../../../ui/ds/Menu'
import { notify } from '../../../ui/ds/Toaster'

const CHANNELS_INIT = [
  { name: 'General', slug: 'general', area: 'all', chats: 41, agents: ['ops', 'dev'], people: 'All', context: 'Company-wide', default: true },
  { name: 'Engineering', slug: 'engineering', area: 'dev', chats: 24, agents: ['dev', 'ops', 'retro'], people: 3, context: 'Isolated' },
  { name: 'Marketing', slug: 'marketing', area: 'marketing', chats: 19, agents: ['marketing', 'dev'], people: 2, context: 'Isolated + General' },
  { name: 'Business', slug: 'business', area: 'sales', chats: 9, agents: ['finance', 'ops', 'dev'], people: 2, context: 'Isolated' },
]

const ARCHIVED_INIT = [
  { name: 'Launch 2025', date: 'Mar 3', chats: 62 },
]

const AREA_MAP: Record<string, 'dev' | 'marketing' | 'ops' | 'finance' | 'sales' | 'support' | 'retro'> = {
  dev: 'dev',
  marketing: 'marketing',
  ops: 'ops',
  finance: 'finance',
  sales: 'sales',
  support: 'support',
  retro: 'retro',
}

function AgentStack({ agents }: { agents: string[] }) {
  return (
    <span className="flex items-center gap-[-4px]">
      {agents.slice(0, 4).map((a, i) => (
        <span key={a} style={{ marginLeft: i === 0 ? 0 : -6, zIndex: 4 - i }} className="inline-flex">
          <Mascot size={20} radius={0} area={AREA_MAP[a] ?? 'ops'} tile={false} />
        </span>
      ))}
    </span>
  )
}

type Channel = (typeof CHANNELS_INIT)[number]
type Archived = (typeof ARCHIVED_INIT)[number]

function ChannelMoreMenu({ channel, onMute, onArchive, onRemove }: {
  channel: Channel
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
            <MenuItemBody icon={BellOff} label="Mute" />
          </DropdownMenu.Item>
          {!channel.default && (
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
  const [channels, setChannels] = useState<Channel[]>(CHANNELS_INIT)
  const [archived, setArchived] = useState<Archived[]>(ARCHIVED_INIT)

  function muteChannel(_slug: string, name: string) {
    notify(`${name} muted`)
  }

  function archiveChannel(slug: string, name: string) {
    const ch = channels.find((c) => c.slug === slug)
    if (!ch) return
    setChannels((prev) => prev.filter((c) => c.slug !== slug))
    setArchived((prev) => [...prev, { name: ch.name, date: 'today', chats: ch.chats }])
    notify(`${name} archived`)
  }

  function removeChannel(slug: string, name: string) {
    setChannels((prev) => prev.filter((c) => c.slug !== slug))
    notify(`${name} removed`)
  }

  function restoreChannel(name: string) {
    setArchived((prev) => prev.filter((a) => a.name !== name))
    notify(`${name} restored`)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Channels & areas" />
        <div className="ml-auto">
          <Button variant="primary" height={28} icon={Plus}>New channel</Button>
        </div>
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">Channels & areas</h1>
        <p className="mb-[24px] text-[13px] text-muted">Each channel is an area with its own chats, goals, flows and docs. General is the default and can't be removed.</p>

        {/* Table */}
        <div className="mb-[32px] overflow-hidden rounded-lg border border-line-strong bg-surface">
          <div className="grid grid-cols-[1fr_80px_60px_160px_32px] items-center border-b border-line bg-soft px-[16px] py-[8px] text-[11px] font-medium uppercase tracking-[0.8px] text-faint">
            <span>Channel</span>
            <span>Agents</span>
            <span>People</span>
            <span>Context</span>
            <span />
          </div>
          {channels.map((ch, i) => (
            <div
              key={ch.slug}
              className={`grid grid-cols-[1fr_80px_60px_160px_32px] items-center px-[16px] py-[10px] ${
                i < channels.length - 1 ? 'border-b border-line' : ''
              }`}
            >
              <div className="flex items-center gap-[10px]">
                <Mascot size={28} radius={8} area={AREA_MAP[ch.area] ?? 'ops'} tile />
                <div>
                  <p className="text-[13px] font-medium text-ink">{ch.name}</p>
                  <p className="text-[11.5px] text-muted">
                    {ch.default ? `Default · ${ch.chats} chats` : `${ch.chats} chats · ${typeof ch.people === 'number' ? `${ch.people} goals` : ''}`}
                  </p>
                </div>
              </div>
              <AgentStack agents={ch.agents} />
              <span className="text-[12.5px] text-ink">{ch.people}</span>
              <div className="flex items-center gap-[4px]">
                <Lock size={12} className="text-muted" aria-hidden />
                <span className="text-[12.5px] text-ink">{ch.context}</span>
              </div>
              <ChannelMoreMenu
                channel={ch}
                onMute={() => muteChannel(ch.slug, ch.name)}
                onArchive={() => archiveChannel(ch.slug, ch.name)}
                onRemove={() => removeChannel(ch.slug, ch.name)}
              />
            </div>
          ))}
        </div>

        {/* Archived */}
        <h2 className="mb-[12px] text-[15px] font-semibold text-ink">Archived channels</h2>
        {archived.map((a) => (
          <div key={a.name} className="flex items-center gap-[12px] rounded-lg border border-line-strong bg-soft px-[16px] py-[10px]">
            <div className="flex size-[28px] shrink-0 items-center justify-center rounded-base bg-line-strong">
              <Lock size={14} className="text-muted" aria-hidden />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
              <span className="text-[13px] font-medium text-ink">{a.name}</span>
              <span className="text-[11.5px] text-muted">Archived {a.date} · read-only · {a.chats} chats</span>
            </div>
            <Button variant="secondary" height={28} onClick={() => restoreChannel(a.name)}>Restore</Button>
          </div>
        ))}
      </SectionPane>
    </div>
  )
}
