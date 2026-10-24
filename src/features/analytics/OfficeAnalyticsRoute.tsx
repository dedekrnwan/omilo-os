import { AnalyticsPage } from './AnalyticsPage'
import { COMPANY_NAME, officeHelpersSub, officeJobs, officeStats, spendByChannel } from './data'

/** Office · Analytics (company) — pen gcqA2. */
export function OfficeAnalyticsRoute() {
  return (
    <AnalyticsPage
      scope={{
        meta: 'All channels',
        title: `Analytics · ${COMPANY_NAME}`,
        sub: 'Every helper across all channels this week.',
        stats: officeStats,
        left: spendByChannel,
        right: officeJobs,
        helpersSub: officeHelpersSub,
      }}
    />
  )
}
