import { useState } from 'react'
import { notFound, useParams } from '@tanstack/react-router'
import { Ellipsis, SquarePen, Target } from 'lucide-react'
import type { Channel, Model } from '../../core/domain/types'
import { useChannel, useChannelGoals } from '../../app/queries'
import { ChatSession } from '../../ui/ChatSession/ChatSession'
import { Composer } from '../../ui/ChatSession/Composer'
import { DEFAULT_MODEL } from '../../ui/ChatSession/ModelMenu'
import { Topbar } from '../../ui/ds/Frame'
import { Mascot } from '../../ui/ds/Mascot'

// ── New chat hero (pen `Chat · New chat (General)`) ───────────────────────────

export function NewChatHero({ channel }: { channel: Channel }) {
  const [selectedModel, setSelectedModel] = useState<Model>(DEFAULT_MODEL)
  const { data: goals = [] } = useChannelGoals(channel.id)

  return (
    <>
      <Topbar
        icon={SquarePen}
        title="New chat"
        meta={channel.name}
        actions={
          <button type="button" aria-label="More" className="flex text-muted hover:text-ink">
            <Ellipsis size={18} aria-hidden />
          </button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[21px] overflow-y-auto px-[24px] pb-[58px]">
        <div className="flex flex-col items-center gap-[11px] text-center">
          <Mascot size={56} radius={15.68} title="Chief" />
          <h2 className="m-0 font-display text-[26px] font-semibold tracking-[-0.6px] text-ink">
            Morning, Dede. What are we figuring out?
          </h2>
          <p className="m-0 text-[14px] text-muted">
            You’re in {channel.name}. Switch channel to give Chief focused context for one area.
          </p>
        </div>

        <div className="w-[680px] max-w-full">
          <Composer
            sessionId={`new-${channel.id}`}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
          />
        </div>

        {goals.length > 0 && (
          <div className="flex w-[720px] max-w-full flex-col gap-[10px]">
            <span className="text-[12px] text-faint">Or start from a goal in {channel.name}</span>
            <div className="flex w-full gap-[8px]">
              {goals.slice(0, 3).map((g) => (
                <button
                  key={g.id}
                  type="button"
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

// ── ChatIndexRoute: index child of $channelId — shows the new-chat hero ───────

/**
 * Index route under /chat/$channelId.
 * Renders ONLY the main-content hero; the layout provides the sidebar + Inset wrapper.
 */
export function ChatIndexRoute() {
  const params = useParams({ strict: false })
  const channelId = params.channelId ?? 'ch-general'
  const { data: channel, isLoading } = useChannel(channelId)

  if (isLoading) return null
  if (!channel) throw notFound()

  return <NewChatHero channel={channel} />
}

// ── ChatSessionRoute: $sessionId child — shows the session thread ─────────────

/**
 * Session route under /chat/$channelId/$sessionId.
 * Renders ONLY the ChatSession main content; the layout provides sidebar + Inset.
 */
export function ChatSessionRoute() {
  const params = useParams({ strict: false })
  const sessionId = params.sessionId ?? ''

  return <ChatSession key={sessionId} sessionId={sessionId} />
}

/**
 * @deprecated Use ChatChannelLayout + ChatIndexRoute + ChatSessionRoute instead.
 * Kept temporarily so existing imports don't break during migration.
 * Remove once router.tsx and tests are fully updated.
 */
export function ChatRoute() {
  const params = useParams({ strict: false })
  const channelId = params.channelId ?? 'ch-general'
  const sessionId = params.sessionId
  const { data: channel, isLoading } = useChannel(channelId)

  if (isLoading) return null
  if (!channel) throw notFound()

  return sessionId
    ? <ChatSession key={sessionId} sessionId={sessionId} />
    : <NewChatHero channel={channel} />
}
