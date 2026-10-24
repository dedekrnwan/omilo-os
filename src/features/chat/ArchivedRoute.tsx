import { Archive, RotateCcw, Trash2 } from 'lucide-react'
import { Topbar } from '../../ui/ds/Frame'
import { Button } from '../../ui/ds/Button'

// ── Static archived chat data (matches PHRy6.png) ────────────────────────────

interface ArchivedChat {
  id: string
  title: string
  channel: string
  archivedAt: string
}

const ARCHIVED_CHATS: ArchivedChat[] = [
  { id: 'a-1', title: 'Sprint 41 planning',           channel: 'Chief',   archivedAt: 'Sep 30' },
  { id: 'a-2', title: 'Old CI runner migration',       channel: 'Dev',     archivedAt: 'Sep 22' },
  { id: 'a-3', title: 'Logo refresh feedback',         channel: 'Growler', archivedAt: 'Sep 18' },
  { id: 'a-4', title: 'Q3 hiring plan',                channel: 'Chief',   archivedAt: 'Sep 10' },
  { id: 'a-5', title: 'Status page outage notes',      channel: 'Chief',   archivedAt: 'Aug 29' },
  { id: 'a-6', title: 'Vendor invoice dispute',        channel: 'Finance', archivedAt: 'Aug 21' },
]

// ── ArchivedChatRow ───────────────────────────────────────────────────────────

function ArchivedChatRow({ chat }: { chat: ArchivedChat }) {
  return (
    <div className="flex w-full items-center gap-[12px] rounded-base px-[14px] py-[12px] transition-colors hover:bg-soft group">
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-[13px] font-medium text-ink truncate">{chat.title}</span>
        <span className="text-[12px] text-muted">
          {chat.channel} · archived {chat.archivedAt}
        </span>
      </div>
      {/* Action buttons — visible on hover */}
      <div className="flex shrink-0 items-center gap-[4px] opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          aria-label={`Restore "${chat.title}"`}
          className="flex h-[28px] items-center gap-[5px] rounded-sm px-[8px] text-[12px] font-medium text-ink-2 outline-1 -outline-offset-1 outline-line-strong bg-surface hover:bg-hover transition-colors"
        >
          <RotateCcw size={13} aria-hidden className="text-muted" />
          Restore
        </button>
        <button
          type="button"
          aria-label={`Delete "${chat.title}"`}
          className="flex h-[28px] w-[28px] items-center justify-center rounded-sm text-bad bg-surface outline-1 -outline-offset-1 outline-line-strong hover:bg-bad-tint transition-colors"
        >
          <Trash2 size={13} aria-hidden />
        </button>
      </div>
    </div>
  )
}

// ── ArchivedRoute ─────────────────────────────────────────────────────────────

/**
 * Route: /chat/$channelId/archived
 * Renders the archived-chats list; layout provides sidebar + Inset.
 * Matches PHRy6.png — the panel shown when clicking "Archived" in the sidebar.
 */
export function ArchivedRoute() {
  return (
    <>
      <Topbar
        icon={Archive}
        title="Archived"
        meta={`${ARCHIVED_CHATS.length} chats`}
        actions={
          <Button variant="secondary" height={28}>
            Delete all
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Search row */}
        <div className="flex items-center gap-[8px] border-b border-line px-[16px] py-[10px]">
          <label className="flex flex-1 items-center gap-[8px] rounded-base outline-1 -outline-offset-1 outline-line-strong bg-surface px-[10px] py-[6px]">
            <span className="sr-only">Search archived chats</span>
            <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-faint shrink-0">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="search"
              placeholder="Search archived…"
              aria-label="Search archived chats"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
            />
          </label>
        </div>

        {/* Archived list */}
        <div className="flex flex-col gap-px px-[8px] py-[8px]">
          {ARCHIVED_CHATS.map((chat) => (
            <ArchivedChatRow key={chat.id} chat={chat} />
          ))}
        </div>

        {/* Footer note */}
        <p className="px-[22px] py-[12px] text-[11.5px] text-faint">
          Archived chats are deleted after 180 days unless restored.
        </p>
      </div>
    </>
  )
}
