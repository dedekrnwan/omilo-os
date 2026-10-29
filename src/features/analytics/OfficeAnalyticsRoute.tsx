import { useSession } from '../../app/session'
import { AnalyticsPage, FALLBACK_JOBS_CHART, FALLBACK_SPEND_CHART } from './AnalyticsPage'

/** Office · Analytics (company) — pen gcqA2. */
export function OfficeAnalyticsRoute() {
  const companyName = useSession((s) => s.company?.name) ?? 'your company'
  return (
    <AnalyticsPage
      meta="All channels"
      title={`Analytics · ${companyName}`}
      sub="Every helper across all channels this week."
      left={FALLBACK_SPEND_CHART}
      right={FALLBACK_JOBS_CHART}
    />
  )
}
