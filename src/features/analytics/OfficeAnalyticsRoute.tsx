import { AnalyticsPage, FALLBACK_JOBS_CHART, FALLBACK_SPEND_CHART } from './AnalyticsPage'

const COMPANY_NAME = 'Sahabat Warga'

/** Office · Analytics (company) — pen gcqA2. */
export function OfficeAnalyticsRoute() {
  return (
    <AnalyticsPage
      meta="All channels"
      title={`Analytics · ${COMPANY_NAME}`}
      sub="Every helper across all channels this week."
      left={FALLBACK_SPEND_CHART}
      right={FALLBACK_JOBS_CHART}
    />
  )
}
