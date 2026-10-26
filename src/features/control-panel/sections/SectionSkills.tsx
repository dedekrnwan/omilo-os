import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Breadcrumb, SectionPane, Toggle } from '../legacyShared'
import { Mascot } from '../../../ui/ds/Mascot'
import { Segmented } from '../../team/ui'
import { DialogWriteSkill } from '../dialogs/DialogWriteSkill'
import type { DialogKind } from '../legacyTypes'
import { notify } from '../../../ui/ds/Toaster'

type Skill = (typeof SKILLS)[number]

const SKILLS = [
  {
    name: 'House voice',
    desc: 'Bahasa first, warm and short. No jargon with customers.',
    type: 'Standard',
    on: true,
    agents: ['ops', 'marketing', 'support'] as const,
    usage: 'used 214×  this month',
  },
  {
    name: 'Before you reply to a customer',
    desc: '5-point check: name, order, promise, tone, next step.',
    type: 'Standard',
    on: true,
    agents: ['support'] as const,
    usage: 'used 88+',
  },
  {
    name: 'Incident postmortem',
    desc: 'Timeline, cause, impact, fixes — one page.',
    type: 'On demand',
    slug: '/postmortem',
    on: true,
    agents: ['dev', 'ops'] as const,
    usage: 'used 3+',
  },
  {
    name: 'Release notes',
    desc: 'What changed, who it\'s for, how to roll back.',
    type: 'On demand',
    slug: '/release',
    on: true,
    agents: ['ops'] as const,
    usage: 'used 6+',
  },
  {
    name: 'Weekly report',
    desc: 'What moved, what\'s stuck, what you need to decide.',
    type: 'On demand',
    slug: '/weekly',
    on: true,
    agents: ['ops'] as const,
    usage: 'used 4+',
  },
  {
    name: 'Reconcile payouts',
    desc: 'Match Stripe payouts to signups, flag gaps over Rp 500k.',
    type: 'On demand',
    slug: '/reconcile',
    on: false,
    agents: ['finance'] as const,
    usage: 'never used',
  },
]

const AREA_MAP: Record<string, 'ops' | 'dev' | 'marketing' | 'finance' | 'support' | 'sales'> = {
  ops: 'ops', dev: 'dev', marketing: 'marketing', finance: 'finance', support: 'support', sales: 'sales',
}

const SKILL_FILTERS = ['All', 'Standard', 'On demand'] as const
type SkillFilter = (typeof SKILL_FILTERS)[number]

interface Props {
  onDialog: (d: DialogKind) => void
}

export function SectionSkills({ onDialog }: Props) {
  const [filter, setFilter] = useState<SkillFilter>('All')
  const [editing, setEditing] = useState<Skill | null>(null)
  const shown = filter === 'All' ? SKILLS : SKILLS.filter((s) => s.type === filter)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Skills" />
        <div className="ml-auto">
          <Button variant="primary" height={28} icon={Plus} onClick={() => onDialog('write-skill')}>
            Write a skill
          </Button>
        </div>
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">Skills</h1>
        <p className="mb-[20px] text-[13px] text-muted">Know-how your agents follow — a checklist, a house style, a process.</p>

        {/* Filters */}
        <div className="mb-[20px]">
          <Segmented items={SKILL_FILTERS} value={filter} onChange={setFilter} />
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 gap-[12px]">
          {shown.map((s) => (
            <div
              key={s.name}
              role="button"
              tabIndex={0}
              aria-label={`Edit ${s.name}`}
              onClick={() => setEditing(s)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setEditing(s)
                }
              }}
              className="flex cursor-pointer flex-col gap-[8px] rounded-lg border border-line-strong bg-surface p-[14px] text-left outline-none transition-colors hover:border-ink-2 focus-visible:ring-2 focus-visible:ring-ink"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-[6px]">
                  <span className="text-[15px]">📋</span>
                  <span className="text-[13px] font-semibold text-ink">{s.name}</span>
                </div>
                {/* Toggling on/off shouldn't open the editor. */}
                <span onClick={(e) => e.stopPropagation()}>
                  <Toggle on={s.on} />
                </span>
              </div>
              <p className="text-[12px] text-muted">{s.desc}</p>
              <div className="flex items-center gap-[6px]">
                <span className={`rounded-pill border px-[6px] py-[1px] text-[10.5px] ${
                  s.type === 'Standard' ? 'border-info-line bg-info-tint text-info' : 'border-line-strong bg-soft text-muted'
                }`}>
                  {s.type}
                </span>
                {s.slug && (
                  <span className="rounded-sm bg-line-strong px-[4px] py-[1px] font-mono text-[10.5px] text-muted">{s.slug}</span>
                )}
                {s.agents.map((a) => (
                  <Mascot key={a} helper size={16} radius={0} area={AREA_MAP[a] ?? 'ops'} tile={false} />
                ))}
                <span className="ml-auto text-[11px] text-muted">{s.usage}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Starters */}
        <div className="mt-[20px] flex items-center gap-[8px] flex-wrap">
          <span className="text-[12px] text-muted">Starters for Sahabat Warga</span>
          {['+ Refund policy', '+ Onboarding an RT admin', '+ Bahasa ++ English glossary'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => notify(`Starter added: ${s.replace(/^\+\s*/, '')}`)}
              className="rounded-pill border border-line-strong bg-surface px-[8px] py-[3px] text-[12px] text-link hover:bg-soft"
            >
              {s}
            </button>
          ))}
        </div>
      </SectionPane>

      {editing && (
        <DialogWriteSkill
          skill={{ name: editing.name, desc: editing.desc }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
