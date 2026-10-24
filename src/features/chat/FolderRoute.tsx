import { useState } from 'react'
import type { ReactNode } from 'react'
import { notFound, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Archive,
  Check,
  ChevronRight,
  Ellipsis,
  File,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  ScrollText,
  Target,
  Trash2,
  UserPlus,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Folder as FolderT, Session } from '../../core/domain/types'
import { useChannel, useChannelFolders, useChannelSessions } from '../../app/queries'
import { Button } from '../../ui/ds/Button'
import { Topbar } from '../../ui/ds/Frame'
import { Mascot } from '../../ui/ds/Mascot'
import { accents } from '../../ui/ds/accents'
import { FOLDER_PAGES } from './data'
import type { FolderChat, FolderPage } from './data'

// ── pen `Chat · Folder` (A8lWSN) ─────────────────────────────────────────────

/** Folder page content: the design's copy for Q4 Launch, derived from fixtures otherwise. */
function folderPage(folder: FolderT, sessions: Session[]): FolderPage {
  const known = FOLDER_PAGES[folder.id]
  if (known) return known
  return {
    instructions: 'Add instructions to tell helpers what every chat in this folder is about.',
    files: [],
    chats: sessions
      .filter((s) => s.folderId === folder.id)
      .map((s) => ({
        id: s.id,
        title: s.title,
        snippet: s.goal ? `Linked to ${s.goal}` : 'No linked goal',
        agents: (s.participants ?? [{ area: 'brand' as const }]).map((p) => p.area),
        time: s.updated,
      })),
  }
}

// ── Chat menu (pen `Chat Menu` mXyV3 + `Folder Submenu` LiRnp) ────────────────

const menuSurface =
  'z-50 flex flex-col gap-px rounded-lg bg-surface p-[6px] shadow-[0_12px_32px_#0C0A0924] outline-1 -outline-offset-1 outline-line-strong'
const itemClass =
  'flex w-full cursor-pointer items-center gap-[10px] rounded-btn px-[7px] py-[8px] text-left outline-none select-none data-[highlighted]:bg-hover data-[state=open]:bg-hover hover:bg-hover'

function ItemBody({
  icon: Icon,
  label,
  trail,
  danger,
  sub,
}: {
  icon: LucideIcon
  label: string
  trail?: ReactNode
  danger?: boolean
  sub?: boolean
}) {
  return (
    <>
      <Icon size={15} aria-hidden className={danger ? 'text-bad' : 'text-ink-2'} />
      <span className={`min-w-0 flex-1 text-[12.5px] ${danger ? 'text-bad' : 'text-ink'}`}>{label}</span>
      {trail && <span className="text-[12px] text-faint">{trail}</span>}
      {sub && <ChevronRight size={14} aria-hidden className="text-faint" />}
    </>
  )
}

function Divider() {
  return <div className="h-px w-full bg-line-strong" />
}

function ChatMenu({
  chat,
  folders,
  currentFolderId,
  open,
  onOpenChange,
  subOpen,
}: {
  chat: FolderChat
  folders: FolderT[]
  currentFolderId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Force the Move-to-folder submenu open (design state). */
  subOpen?: boolean
}) {
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`More actions for ${chat.title}`}
          className={`flex shrink-0 hover:text-ink ${open ? 'text-ink' : 'text-faint'}`}
        >
          <Ellipsis size={16} aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} alignOffset={-8} className={`w-[228px] ${menuSurface}`}>
          <DropdownMenu.Item className={itemClass}>
            <ItemBody icon={Pencil} label="Rename" />
          </DropdownMenu.Item>
          <DropdownMenu.Sub open={subOpen || undefined}>
            <DropdownMenu.SubTrigger className={itemClass}>
              <ItemBody icon={FolderInput} label="Move to folder" sub />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent sideOffset={10} alignOffset={-6} className={`w-[200px] ${menuSurface}`}>
                {folders.map((f) => (
                  <DropdownMenu.Item key={f.id} className={itemClass}>
                    <ItemBody
                      icon={Folder}
                      label={f.name}
                      trail={f.id === currentFolderId ? <Check size={14} aria-label="Current folder" className="text-ink" /> : undefined}
                    />
                  </DropdownMenu.Item>
                ))}
                <Divider />
                <DropdownMenu.Item className={itemClass}>
                  <ItemBody icon={FolderPlus} label="New folder…" />
                </DropdownMenu.Item>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <DropdownMenu.Item className={itemClass}>
            <ItemBody icon={Target} label="Link to goal" sub />
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClass}>
            <ItemBody icon={Pin} label="Pin to sidebar" />
          </DropdownMenu.Item>
          <Divider />
          <DropdownMenu.Item className={itemClass}>
            <ItemBody icon={Archive} label="Archive" trail="E" />
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClass}>
            <ItemBody icon={Trash2} label="Delete" trail="⌫" danger />
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ── Chat row ──────────────────────────────────────────────────────────────────

function FolderChatRow({
  chat,
  highlighted,
  onOpen,
  menu,
}: {
  chat: FolderChat
  highlighted: boolean
  onOpen: () => void
  menu: ReactNode
}) {
  const topRule = !highlighted
  return (
    <div
      data-highlighted={highlighted || undefined}
      className={`group flex w-full items-center gap-[11px] px-[9px] py-[11px] hover:rounded-md hover:bg-soft data-[highlighted]:rounded-md data-[highlighted]:bg-soft ${
        topRule ? 'shadow-[inset_0_1px_0_var(--color-line-strong)] hover:shadow-none' : ''
      }`}
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 flex-col gap-[3px] text-left">
        <span className="truncate text-[13px] font-medium text-ink">{chat.title}</span>
        <span className="truncate text-[12.5px] text-muted">{chat.snippet}</span>
      </button>
      <span className="flex shrink-0 gap-[4px]">
        {chat.agents.map((a, i) => (
          <Mascot key={`${a}-${i}`} size={18} radius={5} area={a} />
        ))}
      </span>
      <span className="text-[12px] whitespace-nowrap text-faint">{chat.time}</span>
      {menu}
    </div>
  )
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * Route: /chat/$channelId/folder/$folderId
 * `?state=menu` opens the chat menu + Move-to-folder submenu on the third chat (design state).
 */
export function FolderRoute() {
  const params = useParams({ strict: false })
  const channelId = params.channelId ?? ''
  const folderId = params.folderId ?? ''
  const navigate = useNavigate()
  const { state } = useSearch({ strict: false }) as { state?: string }
  const { data: channel } = useChannel(channelId)
  const { data: folders = [], isLoading } = useChannelFolders(channelId)
  const { data: sessions = [] } = useChannelSessions(channelId)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const designMenu = state === 'menu'

  if (isLoading) return null
  const folder = folders.find((f) => f.id === folderId)
  if (!folder) throw notFound()

  const page = folderPage(folder, sessions)
  const accent = accents[channel?.accent ?? 'general']
  const openChatId = menuFor ?? (designMenu ? page.chats[2]?.id : null)
  const highlightedIndex = page.chats.findIndex((c) => c.id === openChatId)
  const sub = [
    `${page.chats.length} chats`,
    `${page.files.length} files`,
    page.sharedWith ? `shared with ${page.sharedWith}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  function openChat(id: string) {
    if (sessions.some((s) => s.id === id)) {
      void navigate({ to: '/chat/$channelId/$sessionId', params: { channelId, sessionId: id } })
    }
  }

  return (
    <>
      <Topbar
        icon={FolderOpen}
        title={folder.name}
        meta={`Folder · ${channel?.name ?? ''}`}
        actions={
          <div className="flex items-center gap-[8px]">
            <Button variant="secondary" icon={UserPlus}>
              Share
            </Button>
            <Button icon={Plus} onClick={() => void navigate({ to: '/chat/$channelId', params: { channelId } })}>
              New chat in folder
            </Button>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto">
        <div className="flex w-[860px] max-w-full flex-col gap-[21px] pt-[26px] pb-[29px]">
          {/* Head */}
          <div className="flex w-full items-center gap-[12px]">
            <span
              aria-hidden
              className="flex size-[48px] shrink-0 items-center justify-center rounded-lg"
              style={{ background: accent.chipBg, color: accent.chipInk }}
            >
              <FolderOpen size={22} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
              <h2 className="m-0 font-display text-[22px] font-semibold tracking-[-0.5px] text-ink">
                {folder.name}
              </h2>
              <p className="m-0 text-[13px] text-muted">{sub}</p>
            </div>
          </div>

          {/* Context: instructions + files */}
          <div className="flex w-full items-start gap-[12px]">
            <section
              aria-label="Folder instructions"
              className="flex min-w-0 flex-1 flex-col gap-[8px] rounded-md bg-soft p-[13px] outline-1 -outline-offset-1 outline-line"
            >
              <div className="flex w-full items-center gap-[6px]">
                <ScrollText size={14} aria-hidden className="text-muted" />
                <span className="flex-1 text-[12.5px] font-medium text-ink-2">Folder instructions</span>
                <button type="button" aria-label="Edit folder instructions" className="text-[12.5px] text-link hover:underline">
                  Edit
                </button>
              </div>
              <p className="m-0 text-[12.5px] leading-[1.55] text-ink-2">{page.instructions}</p>
            </section>
            <section
              aria-label="Files"
              className="flex w-[300px] shrink-0 flex-col gap-[8px] rounded-md p-[13px] outline-1 -outline-offset-1 outline-line-strong"
            >
              <div className="flex w-full items-center gap-[6px]">
                <Paperclip size={14} aria-hidden className="text-muted" />
                <span className="flex-1 text-[12.5px] font-medium text-ink-2">Files</span>
                <button type="button" aria-label="Add file" className="flex text-muted hover:text-ink">
                  <Plus size={14} aria-hidden />
                </button>
              </div>
              {page.files.map((name) => (
                <div key={name} className="flex w-full items-center gap-[8px]">
                  <File size={13} aria-hidden className="text-faint" />
                  <span className="truncate text-[12.5px] text-ink-2">{name}</span>
                </div>
              ))}
            </section>
          </div>

          {/* Chats */}
          <div className="flex w-full items-center">
            <span className="flex-1 text-[12.5px] font-semibold text-ink">Chats in this folder</span>
            <span className="text-[12.5px] text-muted">Recent first</span>
          </div>
          <div className="flex w-full flex-col">
            {page.chats.map((chat, i) => (
              <FolderChatRow
                key={chat.id}
                chat={chat}
                highlighted={i === highlightedIndex}
                onOpen={() => openChat(chat.id)}
                menu={
                  <ChatMenu
                    chat={chat}
                    folders={folders}
                    currentFolderId={folder.id}
                    open={openChatId === chat.id}
                    subOpen={designMenu && menuFor === null}
                    onOpenChange={(o) => setMenuFor(o ? chat.id : null)}
                  />
                }
              />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
