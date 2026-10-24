import { useParams, useNavigate } from '@tanstack/react-router'
import { ControlPanel } from './ControlPanel'
import type { ControlPanelSection } from './types'

const VALID_SECTIONS: ControlPanelSection[] = [
  'general', 'handbook', 'members', 'channels', 'safety',
  'ai-engine', 'ai-accounts', 'knowledge', 'connectors', 'skills',
  'usage', 'activity', 'data', 'account', 'notifications',
]

function isValidSection(s: string | undefined): s is ControlPanelSection {
  return VALID_SECTIONS.includes(s as ControlPanelSection)
}

/**
 * Route component for /control-panel and /control-panel/$section.
 * Reads the $section param from the URL (strict: false) and syncs
 * section changes back to the URL via navigate.
 */
export function ControlPanelRoute() {
  const params = useParams({ strict: false })
  const navigate = useNavigate()

  const sectionParam = params.section
  const section = isValidSection(sectionParam) ? sectionParam : 'general'

  function handleSection(s: ControlPanelSection) {
    void navigate({ to: '/control-panel/$section', params: { section: s } })
  }

  return <ControlPanel section={section} onSection={handleSection} />
}
