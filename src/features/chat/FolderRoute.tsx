import { useParams } from '@tanstack/react-router'
import { ChevronRight, Folder, MoreHorizontal, Pencil, Share2, Plus } from 'lucide-react'
import type { Session } from '../../core/domain/types'
import { useChannelFolders, useChannelSessions } from '../../app/queries'
import { Button } from '../../ui/ds/Button'

// ── Folder instruction panel ──────────────────────────────────────────────────

interface FolderInstructionsProps {
  instructions: string
}

function FolderInstructions({ instructions }: FolderInstructionsProps) {
  return (
    <div className="flex items-start gap-[10px] rounded-base bg-soft px-[14px] py-[11px] outline-1 -outline-offset-1 outline-line-strong">
      <p className="min-w-0 flex-1 text-[12.5px] text-ink-2 leading-[1.5]">{instructions}</p>
      <button
        type="button"
        aria-label="Edit folder instructions"
        className="shrink-0 text-[12px] font-medium text-ink-2 hover:text-ink transition-colors"
      >
        Edit
      </button>
    </div>
  )
}

// ── Folder file attachment ────────────────────────────────────────────────────

interface FolderFile {
  name: string
}

function FileChip({ name }: { name: string }) {
  return (
    <button
      type="button"
      className="flex items-center gap-[6px] rounded-sm px-[9px] py-[5px] text-[12px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong bg-surface hover:bg-soft transition-colors truncate"
    >
      <Folder size={13} aria-hidden className="text-muted shrink-0" />
      <span className="truncate">{name}</span>
    </button>
  )
}

// ── Chat row in folder view ───────────────────────────────────────────────────

function FolderChatRow({ session }: { session: Session }) {
  return (
    <div className="flex w-full items-start gap-[12px] rounded-base px-[14px] py-[12px] transition-colors hover:bg-soft group">
      {/* Participant avatars */}
      <div className="flex shrink-0 items-center" aria-hidden>
        {(session.participants ?? [{ name: 'Chief', area: 'brand' as const }]).slice(0, 2).map((p, i) => (
          <span
            key={p.name}
            title={p.name}
            className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-line-strong text-[10px] font-medium text-ink-2 outline-2 outline-surface"
            style={{ marginLeft: i > 0 ? -6 : 0 }}
          >
            {p.name.charAt(0)}
          </span>
        ))}
      </div>

      {/* Title + preview */}
      <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
        <div className="flex items-center gap-[8px]">
          <span className="text-[13px] font-medium text-ink truncate">{session.title}</span>
          <span className="ml-auto shrink-0 text-[11.5px] text-faint whitespace-nowrap">{session.updated}</span>
        </div>
        <span className="text-[12px] text-muted truncate">
          {session.participants?.map((p) => p.name).join(', ') ?? 'Chief'} ·{' '}
          {session.goal ?? 'No linked goal'}
        </span>
      </div>

      {/* Options button */}
      <button
        type="button"
        aria-label={`Options for "${session.title}"`}
        className="shrink-0 flex h-[24px] w-[24px] items-center justify-center rounded-xs text-faint opacity-0 group-hover:opacity-100 transition-opacity hover:bg-hover hover:text-muted"
      >
        <MoreHorizontal size={14} aria-hidden />
      </button>
    </div>
  )
}

// ── Static folder-level file stubs ───────────────────────────────────────────

const FOLDER_FILES: FolderFile[] = [
  { name: 'Passkey rollout — v1' },
  { name: 'Launch checklist.xlsx' },
  { name: 'Freeze calendar.pdf' },
]

const FOLDER_DEFAULT_INSTRUCTIONS =
  'Everything here is about the Nov 28 launch. Keep answers short, cite the rollout doc, and flag anything that risks the code freeze.'

// ── FolderRoute ───────────────────────────────────────────────────────────────

/**
 * Route: /chat/$channelId/folder/$folderId
 * Renders the folder view matching A8lWSN.png.
 * Layout (ChatChannelLayout) provides sidebar + Inset wrapper.
 */
export function FolderRoute() {
  const params = useParams({ strict: false })
  const channelId = params.channelId ?? 'ch-engineering'
  const folderId = params.folderId ?? ''

  const { data: folders = [] } = useChannelFolders(channelId)
  const { data: sessions = [] } = useChannelSessions(channelId)

  const folder = folders.find((f) => f.id === folderId) ?? folders[0]
  const folderSessions = sessions.filter((s) => s.folderId === (folder?.id ?? folderId))

  if (!folder) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
        Folder not found.
      </div>
    )
  }

  return (
    <>
      {/* Topbar */}
      <header className="flex h-[44px] w-full shrink-0 items-center gap-[8px] border-b border-line px-[16px]">
        <Folder size={15} aria-hidden className="shrink-0 text-muted" />
        {/* Breadcrumb */}
        <div className="flex min-w-0 items-center gap-[5px] text-[13px]">
          <span className="text-muted">Folder</span>
          <ChevronRight size={13} aria-hidden className="text-faint shrink-0" />
          <span className="font-medium text-ink truncate">{folder.name}</span>
        </div>
        <div className="h-px min-w-0 flex-1" />
        {/* Actions */}
        <button
          type="button"
          aria-label="Share folder"
          className="flex h-[28px] items-center gap-[5px] rounded-sm px-[9px] text-[12px] font-medium text-ink-2 outline-1 -outline-offset-1 outline-line-strong bg-surface hover:bg-hover transition-colors"
        >
          <Share2 size={13} aria-hidden className="text-muted" />
          Share
        </button>
        <Button icon={Plus} height={28} variant="primary">
          New chat in folder
        </Button>
      </header>

      {/* Content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Folder meta hero */}
        <div className="flex flex-col gap-[14px] border-b border-line px-[20px] py-[18px]">
          {/* Title + count */}
          <div className="flex items-center gap-[12px]">
            <span className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md bg-hover">
              <Folder size={20} aria-hidden className="text-muted" />
            </span>
            <div className="flex flex-col gap-[1px]">
              <h1 className="m-0 text-[18px] font-semibold text-ink tracking-[-0.3px]">{folder.name}</h1>
              <span className="text-[12.5px] text-muted">
                {folder.count} chats · 3 files · shared with Rina, Bayu
              </span>
            </div>
            <div className="flex-1" />
            <button
              type="button"
              aria-label="Rename folder"
              className="flex h-[28px] w-[28px] items-center justify-center rounded-xs text-faint hover:text-muted hover:bg-hover transition-colors"
            >
              <Pencil size={14} aria-hidden />
            </button>
          </div>

          {/* Two-column: instructions + files */}
          <div className="flex gap-[16px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
              <span className="text-[11px] font-medium tracking-[0.8px] text-faint">FOLDER INSTRUCTIONS</span>
              <FolderInstructions instructions={FOLDER_DEFAULT_INSTRUCTIONS} />
            </div>
            <div className="flex w-[200px] shrink-0 flex-col gap-[6px]">
              <div className="flex items-center gap-[4px]">
                <span className="text-[11px] font-medium tracking-[0.8px] text-faint">FILES</span>
                <div className="flex-1" />
                <button
                  type="button"
                  aria-label="Add file to folder"
                  className="flex h-[18px] w-[18px] items-center justify-center rounded-xs text-faint hover:text-muted hover:bg-hover transition-colors"
                >
                  <Plus size={12} aria-hidden />
                </button>
              </div>
              <div className="flex flex-col gap-[4px]">
                {FOLDER_FILES.map((f) => (
                  <FileChip key={f.name} name={f.name} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Chats in folder */}
        <div className="flex flex-col">
          <div className="flex items-center gap-[8px] px-[20px] py-[10px]">
            <span className="text-[12px] font-medium text-ink-2">Chats in this folder</span>
            <div className="flex-1" />
            <button
              type="button"
              className="text-[12px] text-muted hover:text-ink-2 transition-colors"
            >
              Recent first
            </button>
          </div>

          <div className="flex flex-col gap-px px-[8px] pb-[8px]">
            {folderSessions.length > 0 ? (
              folderSessions.map((s) => <FolderChatRow key={s.id} session={s} />)
            ) : (
              <p className="px-[14px] py-[12px] text-[13px] text-muted">No chats in this folder yet.</p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
