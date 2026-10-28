import { useArea } from '../../app/queries'
import { useUIStore } from '../../app/store'
import { AnalyticsPage, FALLBACK_JOBS_CHART, FALLBACK_SPEND_CHART, FALLBACK_TOKENS_CHART } from './AnalyticsPage'

const COMPANY_NAME = 'Sahabat Warga'

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
        meta="All areas"
        title={`Analytics · ${COMPANY_NAME}`}
        sub="Every helper across all areas this week."
        left={FALLBACK_SPEND_CHART}
        right={FALLBACK_JOBS_CHART}
      />
    )
  }

  const name = channel?.name ?? 'this area'
  return (
    <AnalyticsPage
      meta={`in ${name}`}
      title={`Analytics · ${name}`}
      sub={`How ${name}'s helpers did this week.`}
      left={FALLBACK_TOKENS_CHART}
      right={FALLBACK_JOBS_CHART}
    />
  )
}
