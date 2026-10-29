// Test-only picker data (the app builds this from live queries in usePickerSource).
import type { PickerSource } from './composerModel'

export const TEST_PICKER_SOURCE: PickerSource = {
  helpers: [
    { name: 'Chief of Staff', mention: 'Chief', area: 'brand', sub: 'In this chat' },
    { name: 'Builder', mention: 'Builder', area: 'dev', sub: 'Engineering · working now' },
    { name: 'Grower', mention: 'Grower', area: 'ops', sub: 'Growth' },
    { name: 'Support', mention: 'Support', area: 'support', sub: 'Customer support' },
  ],
  people: [
    { initials: 'RA', name: 'Rina Ayu', role: 'Engineering lead' },
    { initials: 'BS', name: 'Budi Santoso', role: 'Product' },
  ],
  skills: [
    { cmd: '/skill: weekly-report', desc: 'Builder · writes the Friday report' },
    { cmd: '/skill: release-notes', desc: 'Builder · from merged PRs' },
  ],
  context: [
    { label: 'Passkey rollout plan', sub: 'Doc · Engineering', trail: 'Doc', kind: 'doc' },
    { label: 'Passwordless login by Q4', sub: 'Goal · 64%', trail: 'Goal', kind: 'goal', tone: 'ok' },
  ],
}
