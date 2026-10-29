import { useArea } from '../../app/queries'
import { useUIStore } from '../../app/store'
import { useSession } from '../../app/session'
import { AnalyticsPage } from './AnalyticsPage'

/**
 * Chat · Analytics — area-filtered. With no area selected it shows the
 * company-wide view; with one area selected it scopes to that area.
 */
export function ChatAnalyticsRoute() {
  const companyName = useSession((s) => s.company?.name) ?? 'your company'
  const areaId = useUIStore((s) => s.areaId)
  const { data: channel } = useArea(areaId ?? '')

  if (!areaId) {
    return (
      <AnalyticsPage
        meta="All areas"
        title={`Analytics · ${companyName}`}
        sub="Every helper across all areas this week."
        left="spend"
        right="jobs"
      />
    )
  }

  const name = channel?.name ?? 'this area'
  return (
    <AnalyticsPage
      meta={`in ${name}`}
      title={`Analytics · ${name}`}
      sub={`How ${name}'s helpers did this week.`}
      left="tokens"
      right="jobs"
      channelId={areaId}
    />
  )
}
