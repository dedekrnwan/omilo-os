import { useCallback, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { SquarePen, Target } from 'lucide-react'
import type { Channel, Goal, Model } from '../../core/domain/types'
import { useArea, useFolders, useGoals, useStartChat } from '../../app/queries'
import { useSession as useAuthSession } from '../../app/session'
import { useUIStore } from '../../app/store'
import { notify } from '../../ui/ds/Toaster'
import { ChatSession } from '../../ui/ChatSession/ChatSession'
import { Composer } from '../../ui/ChatSession/Composer'
import { DEFAULT_MODEL } from '../../ui/ChatSession/ModelMenu'
import { Topbar } from '../../ui/ds/Frame'
import { Mascot } from '../../ui/ds/Mascot'

// ── New chat hero (pen `Chat · New chat (General)`) ───────────────────────────

/** "Morning" / "Afternoon" / "Evening" for the local hour. */
function partOfDay(hour = new Date().getHours()): string {
  if (hour < 12) return 'Morning'
  if (hour < 18) return 'Afternoon'
  return 'Evening'
}

/** Title for a new chat: the first line of the first message, trimmed. */
function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0].replace(/[@#]/g, '')
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line
}

/** `channel` is the selected area, or null for "All areas". */
export function NewChatHero({ channel }: { channel: Channel | null }) {
  const [selectedModel, setSelectedModel] = useState<Model>(DEFAULT_MODEL)
  const areaId = useUIStore((s) => s.areaId)
  const { data: goals = [] } = useGoals(areaId)
  // `?folder=<id>` — "New chat in folder" / "New chat here" file the chat there.
  const { folder: folderId } = useSearch({ strict: false }) as { folder?: string }
  const { data: allFolders = [] } = useFolders(null)
  const folder = folderId ? allFolders.find((f) => f.id === folderId) : undefined
  const firstName = useAuthSession((s) => s.user?.name?.trim().split(/\s+/)[0] ?? '')
  const startChat = useStartChat()
  const navigate = useNavigate()
  const where = folder ? folder.name : channel ? channel.name : 'all areas'

  // Create a fresh session (optionally seeded by a goal / filed in a folder),
  // send the first message, then land on the live thread. Used by both the hero
  // Composer and the "start from a goal" chips.
  const startSession = useCallback(
    async (text: string, goal?: Goal) => {
      const trimmed = text.trim()
      if (!trimmed) return
      try {
        const session = await startChat.mutateAsync({
          input: {
            channelId: goal?.channelId ?? folder?.channelId ?? channel?.id ?? areaId ?? undefined,
            goalId: goal?.id,
            folderId: goal ? undefined : folder?.id,
            title: goal ? goal.title : titleFrom(trimmed),
            model: selectedModel.id,
          },
          text: trimmed,
        })
        void navigate({ to: '/chat/$sessionId', params: { sessionId: session.id } })
      } catch {
        notify('Couldn’t start the chat — try again')
      }
    },
    [startChat, navigate, channel, areaId, folder, selectedModel],
  )

  return (
    <>
      <Topbar
        icon={SquarePen}
        title="New chat"
        meta={folder ? `${folder.name} · ${channel?.name ?? 'Folder'}` : channel?.name ?? 'All areas'}
      />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[21px] overflow-y-auto px-[24px] pb-[58px]">
        <div className="flex flex-col items-center gap-[11px] text-center">
          <Mascot size={56} radius={15.68} title="Chief" />
          <h2 className="m-0 font-display text-[26px] font-semibold tracking-[-0.6px] text-ink">
            {partOfDay()}{firstName ? `, ${firstName}` : ''}. What are we figuring out?
          </h2>
          <p className="m-0 text-[14px] text-muted">
            You’re in {where}. Switch area to give Chief focused context for one part of the company.
          </p>
        </div>

        <div className="w-[680px] max-w-full">
          <Composer
            sessionId={`new-${areaId ?? 'all'}`}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            onSend={(text) => { void startSession(text) }}
          />
        </div>

        {goals.length > 0 && (
          <div className="flex w-[720px] max-w-full flex-col gap-[10px]">
            <span className="text-[12px] text-faint">Or start from a goal in {where}</span>
            <div className="flex w-full gap-[8px]">
              {goals.slice(0, 3).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => { void startSession(`Let's make progress on "${g.title}". Where should we start?`, g) }}
                  className="flex min-w-0 flex-1 items-center gap-[8px] rounded-md outline-1 -outline-offset-1 outline-line-strong px-[9px] py-[7px] text-left transition-colors hover:bg-soft"
                >
                  <Target size={14} aria-hidden className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{g.title}</span>
                  <span className="text-[12px] text-faint">{g.progress}%</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── ChatIndexRoute: index child of /chat — the new-chat hero ──────────────────

/**
 * Index route at /chat. Renders the main-content hero, driven by the selected
 * Area (null = All areas). The layout provides the sidebar + Inset wrapper.
 */
export function ChatIndexRoute() {
  const areaId = useUIStore((s) => s.areaId)
  const { data: channel } = useArea(areaId ?? '')
  return <NewChatHero channel={areaId ? channel ?? null : null} />
}

// ── ChatSessionRoute: $sessionId child — the session thread ───────────────────

/**
 * Session route at /chat/$sessionId (and /office/chat/$sessionId).
 * Renders ONLY the ChatSession main content; the layout provides sidebar + Inset.
 */
export function ChatSessionRoute() {
  const params = useParams({ strict: false })
  const sessionId = params.sessionId ?? ''

  return <ChatSession key={sessionId} sessionId={sessionId} />
}
