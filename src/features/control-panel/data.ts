import {
  Bell,
  BookOpen,
  BookOpenCheck,
  Brain,
  Building2,
  Cpu,
  Database,
  Hash,
  History,
  KeyRound,
  Plug,
  Receipt,
  ShieldCheck,
  User,
  Users,
  Fingerprint,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ControlPanelSection } from './types'

export interface SectionMeta {
  id: ControlPanelSection
  label: string
  icon: LucideIcon
  badge?: string
}

export interface NavGroup {
  group: string
  items: SectionMeta[]
}

/** pen `Control Panel Sidebar` (Ljoml) nav. */
export const NAV_GROUPS: NavGroup[] = [
  {
    group: 'WORKSPACE',
    items: [
      { id: 'general', label: 'General', icon: Building2 },
      { id: 'handbook', label: 'Company handbook', icon: BookOpen },
      { id: 'members', label: 'Members & roles', icon: Users },
      { id: 'channels', label: 'Channels & areas', icon: Hash },
      { id: 'safety', label: 'Safety & limits', icon: ShieldCheck },
    ],
  },
  {
    group: 'AI',
    items: [
      { id: 'ai-engine', label: 'AI engine', icon: Cpu },
      { id: 'ai-accounts', label: 'AI accounts', icon: KeyRound },
      { id: 'knowledge', label: 'Knowledge', icon: Brain },
    ],
  },
  {
    group: 'TOOLS',
    items: [
      { id: 'connectors', label: 'Connectors', icon: Plug },
      { id: 'mcp-tokens', label: 'MCP tokens', icon: Fingerprint },
      { id: 'skills', label: 'Skills', icon: BookOpenCheck },
    ],
  },
  {
    group: 'DATA',
    items: [
      { id: 'usage', label: 'Usage & billing', icon: Receipt },
      { id: 'activity', label: 'Activity log', icon: History },
      { id: 'data', label: 'Data & storage', icon: Database },
    ],
  },
  {
    group: 'YOU',
    items: [
      { id: 'account', label: 'Account', icon: User },
      { id: 'notifications', label: 'Notifications', icon: Bell },
    ],
  },
]
