import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ControlPanel } from './ControlPanel'
import { DIALOG_KINDS } from './types'
import type { ControlPanelSection, DialogKind, PageVariant } from './types'

const VALID_SECTIONS: ControlPanelSection[] = [
  'general', 'handbook', 'members', 'channels', 'safety',
  'ai-engine', 'ai-accounts', 'knowledge', 'connectors', 'mcp-tokens', 'skills',
  'usage', 'activity', 'data', 'account', 'notifications',
]

const VARIANTS: Exclude<PageVariant, null>[] = ['self-hosted', 'cloud', 'credits-low', 'policies']

function isValidSection(s: string | undefined): s is ControlPanelSection {
  return VALID_SECTIONS.includes(s as ControlPanelSection)
}

/**
 * Route component for /control-panel and /control-panel/$section.
 * `?state=<dialog|variant>` opens an overlay or page variant (for review).
 */
export function ControlPanelRoute() {
  const params = useParams({ strict: false })
  const search = useSearch({ strict: false }) as { state?: string }
  const navigate = useNavigate()

  const section = isValidSection(params.section) ? params.section : 'general'
  const state = typeof search.state === 'string' ? search.state : undefined
  const dialog = DIALOG_KINDS.includes(state as never) ? (state as DialogKind) : null
  const variant = VARIANTS.includes(state as never) ? (state as PageVariant) : null

  function handleSection(s: ControlPanelSection) {
    void navigate({ to: '/control-panel/$section', params: { section: s } })
  }

  return <ControlPanel key={`${section}:${state ?? ''}`} section={section} onSection={handleSection} dialog={dialog} variant={variant} />
}
