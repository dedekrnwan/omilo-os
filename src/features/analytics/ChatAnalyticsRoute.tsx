import { useArea } from '../../app/queries'
import { useUIStore } from '../../app/store'
import { AnalyticsPage } from './AnalyticsPage'
import {
  COMPANY_NAME,
  channelJobs,
  channelStats,
  helpersSub,
  officeHelpersSub,
  officeJobs,
  officeStats,
  spendByChannel,
  tokensByHelper,
} from './data'

/**
 * Chat · Analytics — area-filtered. With no area selected it shows the
 * company-wide view; with one area selected it scopes to that area.
 */
export function ChatAnalyticsRoute() {
  const areaId = useUIStore((s) => s.areaId)
  const { data: channel } = useArea(areaId ?? '')

  if (!areaId) {
    return (
      <AnalyticsPage
        scope={{
          meta: 'All areas',
          title: `Analytics · ${COMPANY_NAME}`,
          sub: 'Every helper across all areas this week.',
          stats: officeStats,
          left: spendByChannel,
          right: officeJobs,
          helpersSub: officeHelpersSub,
        }}
      />
    )
  }

  const name = channel?.name ?? 'this area'
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
