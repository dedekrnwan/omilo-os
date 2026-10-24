import { useState } from 'react'
import { notFound, useParams } from '@tanstack/react-router'
import { SquarePen, Target } from 'lucide-react'
import type { Channel, Model } from '../../core/domain/types'
import { useChannel, useChannelGoals } from '../../app/queries'
import { ChatSession } from '../../ui/ChatSession/ChatSession'
import { Composer } from '../../ui/ChatSession/Composer'
import { DEFAULT_MODEL } from '../../ui/ChatSession/ModelMenu'
import { Inset, Topbar } from '../../ui/ds/Frame'
import { Mascot } from '../../ui/ds/Mascot'
import { ChannelSidebar } from './ChannelSidebar'

/** /chat with no channel opens the default channel. */
const DEFAULT_CHANNEL_ID = 'ch-general'

// ── New chat hero (pen `Chat · New chat (General)`) ───────────────────────────

function NewChatHero({ channel }: { channel: Channel }) {
  const [selectedModel, setSelectedModel] = useState<Model>(DEFAULT_MODEL)
  const { data: goals = [] } = useChannelGoals(channel.id)

  return (
    <>
      <Topbar icon={SquarePen} title="New chat" meta={channel.name} />
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

function ChannelView({ channelId }: { channelId: string }) {
  const { data: channel, isLoading } = useChannel(channelId)
  if (isLoading) return null
  if (!channel) throw notFound()
  return <NewChatHero channel={channel} />
}

// ── ChatRoute ─────────────────────────────────────────────────────────────────

/**
 * Bound to /chat, /chat/$channelId and /chat/$channelId/$sessionId.
 * Channel sidebar + inset main (new-chat hero or the shared ChatSession).
 */
export function ChatRoute() {
  const params = useParams({ strict: false })
  const channelId = params.channelId ?? DEFAULT_CHANNEL_ID
  const sessionId = params.sessionId

  return (
    <>
      <ChannelSidebar channelId={channelId} sessionId={sessionId} />
      <Inset>
        {sessionId ? <ChatSession key={sessionId} sessionId={sessionId} /> : <ChannelView channelId={channelId} />}
      </Inset>
    </>
  )
}
