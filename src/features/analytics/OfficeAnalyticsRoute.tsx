import { useSession } from '../../app/session'
import { AnalyticsPage } from './AnalyticsPage'

/** Office · Analytics (company) — pen gcqA2. */
export function OfficeAnalyticsRoute() {
  const companyName = useSession((s) => s.company?.name) ?? 'your company'
  return (
    <AnalyticsPage
      meta="All channels"
      title={`Analytics · ${companyName}`}
      sub="Every helper across all channels this week."
      left="spend"
      right="jobs"
    />
  )
}
