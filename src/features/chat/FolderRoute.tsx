import { useMemo, useRef, useState } from 'react'
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
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Folder as FolderT, HelperArea, Session } from '../../core/domain/types'
import { FolderTileButton } from '../shell/LookControls'
import {
  useAddFolderFile,
  useAreas,
  useCreateFolder,
  useDeleteSession,
  useFolder,
  useFolderFiles,
  useFolderShares,
  useFolders,
  useGoals,
  useRemoveFolderFile,
  useSessions,
  useUpdateFolder,
  useUpdateSession,
} from '../../app/queries'
import { notify } from '../../ui/ds/Toaster'
import { ShareDialog } from '../../ui/ChatSession/ShareDialog'
import { Button } from '../../ui/ds/Button'
import { Topbar } from '../../ui/ds/Frame'
import { Mascot } from '../../ui/ds/Mascot'
import { accents } from '../../ui/ds/accents'
import { CreateFolderDialog } from '../shell/CreateFolderDialog'
import { EmptyState } from '../../ui/ds/EmptyState'

// ── pen `Chat · Folder` (A8lWSN) ─────────────────────────────────────────────

interface FolderChat {
  id: string
  title: string
  snippet: string
  /** Helpers in the chat (Mascot avatars, 18px) */
  agents: HelperArea[]
  time: string
  pinned?: boolean
}

const INSTRUCTIONS_PLACEHOLDER = 'Add instructions to tell helpers what every chat in this folder is about.'

function toFolderChat(s: Session): FolderChat {
  return {
    id: s.id,
    title: s.title,
    snippet: s.goal ? `Linked to ${s.goal}` : 'No linked goal',
    agents: (s.participants?.length ? s.participants : [{ name: 'Chief', area: 'brand' as const }]).map((p) => p.area),
    time: s.updated,
    pinned: s.pinned,
  }
}

/** Text-like files are read so helpers can use them as folder context. */
const TEXT_LIKE = /^(text\/|application\/(json|xml|x-yaml|yaml|csv|markdown))/
const TEXT_EXT = /\.(md|markdown|txt|csv|tsv|json|ya?ml|xml|html?)$/i
const MAX_TEXT_BYTES = 1_000_000

async function readFileInput(file: File): Promise<{ name: string; size: number; mime?: string; text?: string }> {
  const base = { name: file.name, size: file.size, mime: file.type || undefined }
  if (file.size <= MAX_TEXT_BYTES && (TEXT_LIKE.test(file.type) || TEXT_EXT.test(file.name))) {
    try {
      return { ...base, text: await file.text() }
    } catch {
      return base
    }
  }
  return base
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
  onRename,
  onMoveToFolder,
  onNewFolder,
  onLinkToGoal,
  onPin,
  onArchive,
  onDelete,
}: {
  chat: FolderChat
  folders: FolderT[]
  currentFolderId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Force the Move-to-folder submenu open (design state). */
  subOpen?: boolean
  onRename?: () => void
  onMoveToFolder?: (folderId: string) => void
  onNewFolder?: () => void
  onLinkToGoal?: () => void
  onPin?: () => void
  onArchive?: () => void
  onDelete?: () => void
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
          <DropdownMenu.Item className={itemClass} onSelect={onRename}>
            <ItemBody icon={Pencil} label="Rename" />
          </DropdownMenu.Item>
          <DropdownMenu.Sub open={subOpen || undefined}>
            <DropdownMenu.SubTrigger className={itemClass}>
              <ItemBody icon={FolderInput} label="Move to folder" sub />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent sideOffset={10} alignOffset={-6} className={`w-[200px] ${menuSurface}`}>
                {folders.map((f) => (
                  <DropdownMenu.Item key={f.id} className={itemClass} onSelect={() => onMoveToFolder?.(f.id)}>
                    <ItemBody
                      icon={Folder}
                      label={f.name}
                      trail={f.id === currentFolderId ? <Check size={14} aria-label="Current folder" className="text-ink" /> : undefined}
                    />
                  </DropdownMenu.Item>
                ))}
                <Divider />
                <DropdownMenu.Item className={itemClass} onSelect={onNewFolder}>
                  <ItemBody icon={FolderPlus} label="New folder…" />
                </DropdownMenu.Item>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <DropdownMenu.Item className={itemClass} onSelect={onLinkToGoal}>
            <ItemBody icon={Target} label="Link to goal" sub />
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClass} onSelect={onPin}>
            <ItemBody icon={Pin} label={chat.pinned ? 'Unpin from sidebar' : 'Pin to sidebar'} />
          </DropdownMenu.Item>
          <Divider />
          <DropdownMenu.Item className={itemClass} onSelect={onArchive}>
            <ItemBody icon={Archive} label="Archive" trail="E" />
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClass} onSelect={onDelete}>
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
 * Route: /folder/$folderId
 * `?state=menu` opens the chat menu + Move-to-folder submenu on the third chat (design state).
 */
export function FolderRoute() {
  const params = useParams({ strict: false })
  const folderId = params.folderId ?? ''
  const navigate = useNavigate()
  const { state } = useSearch({ strict: false }) as { state?: string }
  // Folders/sessions resolve across all areas so the view works from either mode.
  const { data: areas = [] } = useAreas()
  const { data: folders = [], isLoading } = useFolders(null)
  const { data: detail } = useFolder(folderId)
  const { data: sessions = [] } = useSessions(null)
  const { data: files = [], isLoading: filesLoading } = useFolderFiles(folderId)
  const { data: shares } = useFolderShares(folderId)
  const { data: allGoals = [] } = useGoals(null)
  const updateSession = useUpdateSession()
  const deleteSession = useDeleteSession()
  const updateFolder = useUpdateFolder()
  const createFolder = useCreateFolder()
  const addFile = useAddFolderFile()
  const removeFile = useRemoveFolderFile()
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [renameFor, setRenameFor] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [editingInstructions, setEditingInstructions] = useState(false)
  const [instructionsDraft, setInstructionsDraft] = useState('')
  const [sortOrder, setSortOrder] = useState<'recent' | 'oldest' | 'az'>('recent')
  const [newFolderFor, setNewFolderFor] = useState<string | null>(null)
  const [goalPickerFor, setGoalPickerFor] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const designMenu = state === 'menu'

  const listed = folders.find((f) => f.id === folderId)
  // The detail read carries instructions; the list keeps the look in sync optimistically.
  const folder: FolderT | undefined = listed ? { ...detail, ...listed, instructions: detail?.instructions } : detail ?? undefined

  const chats = useMemo(() => {
    const inFolder = sessions.filter((s) => s.folderId === folderId).map(toFolderChat)
    if (sortOrder === 'oldest') return [...inFolder].reverse()
    if (sortOrder === 'az') return [...inFolder].sort((a, b) => a.title.localeCompare(b.title))
    return inFolder
  }, [sessions, folderId, sortOrder])

  if (isLoading) return null
  if (!folder) throw notFound()
  const channel = areas.find((a) => a.id === folder.channelId)
  const goals = allGoals.filter((g) => g.channelId === folder.channelId).length
    ? allGoals.filter((g) => g.channelId === folder.channelId)
    : allGoals

  const instructions = folder.instructions ?? ''
  const accent = accents[channel?.accent ?? 'general']
  const openChatId = menuFor ?? (designMenu ? chats[2]?.id : null)
  const highlightedIndex = chats.findIndex((c) => c.id === openChatId)
  const sharedWith = (shares?.members ?? []).filter((m) => m.permission !== 'owner').map((m) => m.name.split(' ')[0])
  const sub = [
    `${chats.length} chat${chats.length === 1 ? '' : 's'}`,
    `${files.length} file${files.length === 1 ? '' : 's'}`,
    sharedWith.length ? `shared with ${sharedWith.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const fail = (what: string) => () => notify(`Couldn’t ${what} — try again`)
  const patchChat = (id: string, input: Parameters<typeof updateSession.mutate>[0]['input'], done?: string) =>
    updateSession.mutate({ id, input }, { onSuccess: done ? () => notify(done) : undefined, onError: fail('save that change') })

  function openChat(id: string) {
    void navigate({ to: '/chat/$sessionId', params: { sessionId: id } })
  }

  function startRename(chat: FolderChat) {
    setRenameFor(chat.id)
    setRenameValue(chat.title)
    setMenuFor(null)
  }

  function commitRename() {
    if (renameFor && renameValue.trim()) patchChat(renameFor, { title: renameValue.trim() })
    setRenameFor(null)
  }

  function saveInstructions() {
    updateFolder.mutate(
      { id: folderId, input: { instructions: instructionsDraft.trim() } },
      { onSuccess: () => notify('Folder instructions saved'), onError: fail('save the instructions') },
    )
    setEditingInstructions(false)
  }

  async function onFiles(list: FileList | null) {
    for (const file of Array.from(list ?? [])) {
      const input = await readFileInput(file)
      addFile.mutate({ folderId, input }, { onError: fail(`add ${file.name}`) })
    }
  }

  return (
    <>
      {/* New folder dialog (from a chat's Move-to-folder submenu: the chat moves into it) */}
      <CreateFolderDialog
        open={newFolderFor !== null}
        onOpenChange={(o) => { if (!o) setNewFolderFor(null) }}
        onConfirm={(name) => {
          const chatId = newFolderFor
          createFolder.mutate(
            { channelId: folder.channelId, name },
            {
              onSuccess: (f) => {
                if (chatId) patchChat(chatId, { folderId: f.id }, `Moved to ${f.name}`)
              },
              onError: fail('create the folder'),
            },
          )
        }}
      />

      {/* Goal picker dialog */}
      {goalPickerFor && (
        <div
          role="dialog"
          aria-label="Link to goal"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C0A0926]"
        >
          <div className="flex w-[360px] flex-col gap-[12px] rounded-lg bg-surface p-[16px] outline-1 -outline-offset-1 outline-line-strong shadow-[0_12px_32px_#0C0A0924]">
            <h3 className="m-0 text-[16px] font-semibold text-ink">Link to goal</h3>
            <div className="flex flex-col gap-[4px]">
              {goals.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    patchChat(goalPickerFor, { goalId: g.id }, `Linked to “${g.title}”`)
                    setGoalPickerFor(null)
                  }}
                  className="flex w-full items-center gap-[8px] rounded-base px-[8px] py-[6px] text-left text-[13px] text-ink hover:bg-soft"
                >
                  <Target size={13} aria-hidden className="text-ok" />
                  {g.title}
                </button>
              ))}
              {goals.length === 0 && (
                <EmptyState
                  size="sm"
                  title="No goals in this folder"
                  description="Goals give the chats here something to push on — Chief breaks each into key results."
                />
              )}
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" style={{ height: 32 }} onClick={() => setGoalPickerFor(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Chat rename dialog */}
      {renameFor && (
        <div role="dialog" aria-label="Rename chat" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C0A0926]">
          <div className="flex w-[360px] flex-col gap-[16px] rounded-lg bg-surface p-[24px] outline-1 -outline-offset-1 outline-line-strong shadow-[0_12px_32px_#0C0A0924]">
            <h3 className="m-0 text-[16px] font-semibold text-ink">Rename chat</h3>
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenameFor(null) }}
              aria-label="Chat title"
              className="h-[36px] w-full rounded-base bg-surface px-[9px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong"
            />
            <div className="flex justify-end gap-[8px]">
              <Button variant="secondary" style={{ height: 32 }} onClick={() => setRenameFor(null)}>Cancel</Button>
              <Button variant="primary" style={{ height: 32 }} onClick={commitRename}>Rename</Button>
            </div>
          </div>
        </div>
      )}

      <ShareDialog
        target={{ kind: 'folder', id: folder.id }}
        title={folder.name}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />

      <Topbar
        icon={FolderOpen}
        title={folder.name}
        meta={`Folder · ${channel?.name ?? ''}`}
        actions={
          <div className="flex items-center gap-[8px]">
            <Button variant="secondary" icon={UserPlus} onClick={() => setShareOpen(true)}>
              Share
            </Button>
            <Button icon={Plus} onClick={() => void navigate({ to: '/chat', search: { folder: folder.id } } as never)}>
              New chat in folder
            </Button>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto">
        <div className="flex w-[860px] max-w-full flex-col gap-[21px] pt-[26px] pb-[29px]">
          {/* Head */}
          <div className="flex w-full items-center gap-[12px]">
            <FolderTileButton folder={folder} defaultBg={accent.chipBg} defaultInk={accent.chipInk} />
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
                {editingInstructions ? (
                  <button
                    type="button"
                    onClick={saveInstructions}
                    className="text-[12.5px] text-link hover:underline"
                  >
                    Save
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label="Edit folder instructions"
                    onClick={() => { setInstructionsDraft(instructions); setEditingInstructions(true) }}
                    className="text-[12.5px] text-link hover:underline"
                  >
                    Edit
                  </button>
                )}
              </div>
              {editingInstructions ? (
                <textarea
                  autoFocus
                  value={instructionsDraft}
                  placeholder={INSTRUCTIONS_PLACEHOLDER}
                  onChange={e => setInstructionsDraft(e.target.value)}
                  rows={4}
                  aria-label="Folder instructions text"
                  className="w-full resize-none rounded-base bg-surface p-[8px] text-[12.5px] leading-[1.55] text-ink-2 outline-1 -outline-offset-1 outline-line-strong"
                />
              ) : (
                <p className={`m-0 text-[12.5px] leading-[1.55] ${instructions ? 'text-ink-2' : 'text-muted'}`}>
                  {instructions || INSTRUCTIONS_PLACEHOLDER}
                </p>
              )}
            </section>
            <section
              aria-label="Files"
              className="flex w-[300px] shrink-0 flex-col gap-[8px] rounded-md p-[13px] outline-1 -outline-offset-1 outline-line-strong"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                aria-label="File input"
                className="sr-only"
                onChange={e => {
                  void onFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <div className="flex w-full items-center gap-[6px]">
                <Paperclip size={14} aria-hidden className="text-muted" />
                <span className="flex-1 text-[12.5px] font-medium text-ink-2">Files</span>
                <button
                  type="button"
                  aria-label="Add file"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex text-muted hover:text-ink"
                >
                  <Plus size={14} aria-hidden />
                </button>
              </div>
              {filesLoading ? (
                <span className="text-[12.5px] text-faint">Loading…</span>
              ) : files.length === 0 ? (
                <EmptyState
                  size="sm"
                  title="No files yet"
                  description="Add docs helpers should read before they work in this folder."
                  primary={{ label: 'Add file', icon: Plus, onClick: () => fileInputRef.current?.click() }}
                />
              ) : (
                files.map((f) => (
                  <div key={f.id} className="group flex w-full items-center gap-[8px]">
                    <File size={13} aria-hidden className="text-faint" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{f.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => removeFile.mutate({ folderId, fileId: f.id }, { onError: fail(`remove ${f.name}`) })}
                      className="hidden text-faint hover:text-ink group-hover:flex"
                    >
                      <X size={12} aria-hidden />
                    </button>
                  </div>
                ))
              )}
            </section>
          </div>

          {/* Chats */}
          <div className="flex w-full items-center">
            <span className="flex-1 text-[12.5px] font-semibold text-ink">Chats in this folder</span>
            <button
              type="button"
              onClick={() => setSortOrder(o => o === 'recent' ? 'oldest' : o === 'oldest' ? 'az' : 'recent')}
              className="text-[12.5px] text-muted hover:text-ink transition-colors"
            >
              {sortOrder === 'recent' ? 'Recent first' : sortOrder === 'oldest' ? 'Oldest first' : 'A–Z'}
            </button>
          </div>
          <div className="flex w-full flex-col">
            {chats.length === 0 && (
              <EmptyState
                title="No chats in this folder"
                description="Start one here, or drag a chat in from the sidebar."
                primary={{
                  label: 'New chat in folder',
                  icon: Plus,
                  onClick: () => void navigate({ to: '/chat', search: { folder: folder.id } } as never),
                }}
              />
            )}
            {chats.map((chat, i) => (
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
                    onRename={() => startRename(chat)}
                    onMoveToFolder={(fId) => {
                      if (fId === folder.id) return
                      const target = folders.find((f) => f.id === fId)
                      patchChat(chat.id, { folderId: fId }, target ? `Moved to ${target.name}` : undefined)
                    }}
                    onNewFolder={() => { setNewFolderFor(chat.id); setMenuFor(null) }}
                    onLinkToGoal={() => { setGoalPickerFor(chat.id); setMenuFor(null) }}
                    onPin={() => patchChat(chat.id, { pinned: !chat.pinned }, chat.pinned ? 'Unpinned' : 'Pinned to sidebar')}
                    onArchive={() =>
                      updateSession.mutate(
                        { id: chat.id, input: { archived: true } },
                        {
                          onSuccess: () => notify('Chat archived', () => patchChat(chat.id, { archived: false })),
                          onError: fail('archive the chat'),
                        },
                      )
                    }
                    onDelete={() => deleteSession.mutate(chat.id, { onSuccess: () => notify('Chat deleted'), onError: fail('delete the chat') })}
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
