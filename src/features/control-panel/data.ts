import type { ControlPanelSection } from './types'

export interface SectionMeta {
  id: ControlPanelSection
  label: string
  badge?: string
}

export interface NavGroup {
  group: string
  items: SectionMeta[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    group: 'WORKSPACE',
    items: [
      { id: 'general', label: 'General' },
      { id: 'handbook', label: 'Company handbook' },
      { id: 'members', label: 'Members & roles' },
      { id: 'channels', label: 'Channels & areas' },
      { id: 'safety', label: 'Safety & limits' },
    ],
  },
  {
    group: 'AI',
    items: [
      { id: 'ai-engine', label: 'AI engine' },
      { id: 'ai-accounts', label: 'AI accounts' },
      { id: 'knowledge', label: 'Knowledge', badge: 'On' },
    ],
  },
  {
    group: 'TOOLS',
    items: [
      { id: 'connectors', label: 'Connectors' },
      { id: 'skills', label: 'Skills' },
    ],
  },
  {
    group: 'DATA',
    items: [
      { id: 'usage', label: 'Usage & billing' },
      { id: 'activity', label: 'Activity log' },
      { id: 'data', label: 'Data & storage' },
    ],
  },
  {
    group: 'YOU',
    items: [
      { id: 'account', label: 'Account' },
      { id: 'notifications', label: 'Notifications' },
    ],
  },
]
