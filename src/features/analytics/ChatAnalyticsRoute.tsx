import { useParams } from '@tanstack/react-router'
import { useChannel } from '../../app/queries'
import { AnalyticsPage } from './AnalyticsPage'
import { channelJobs, channelStats, helpersSub, tokensByHelper } from './data'

/** Chat · Analytics (channel) — pen fqQP5; tabs MLPUB · BcTka · Q7dBso · Ui79T; states b10Wfq · EIxIX. */
export function ChatAnalyticsRoute() {
  const { channelId } = useParams({ strict: false }) as { channelId?: string }
  const { data: channel } = useChannel(channelId ?? 'ch-engineering')
  const name = channel?.name ?? 'Engineering'
  return (
    <AnalyticsPage
      scope={{
        meta: `in ${name}`,
        title: `Analytics · ${name}`,
        sub: `How ${name}'s helpers did this week.`,
        stats: channelStats,
        left: tokensByHelper,
        right: channelJobs,
        helpersSub,
      }}
    />
  )
}
