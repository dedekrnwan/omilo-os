import { useState } from 'react'
import { Plus, Upload } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Breadcrumb, SectionPane, Toggle } from '../legacyShared'
import { Segmented } from '../../team/ui'
import { DialogWriteSkill } from '../dialogs/DialogWriteSkill'
import type { DialogKind } from '../legacyTypes'
import { notify } from '../../../ui/ds/Toaster'
import { useSkills } from '../../../app/queries'
import { getCommands } from './getCommands'
import type { Skill } from '../../../core/domain/types'

const SKILL_FILTERS = ['All', 'active', 'draft'] as const
type SkillFilter = (typeof SKILL_FILTERS)[number]

interface Props {
  onDialog: (d: DialogKind) => void
}

export function SectionSkills({ onDialog }: Props) {
  const { data: skills = [], isLoading, isError } = useSkills()
  const [filter, setFilter] = useState<SkillFilter>('All')
  const [editing, setEditing] = useState<Skill | null>(null)

  const shown = filter === 'All' ? skills : skills.filter((s) => s.status === filter)

  function handlePublish(id: string, name: string) {
    getCommands()
      .publishSkill(id)
      .then(() => notify(`Skill "${name}" publish requested`))
      .catch(() => notify(`Failed to publish "${name}"`))
  }

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

        {/* Loading */}
        {isLoading && (
          <div className="flex w-full items-center justify-center py-[40px] text-[13px] text-muted">
            Loading skills…
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="flex w-full items-center justify-center py-[40px] text-[13px] text-muted">
            Could not load skills. Please try again.
          </div>
        )}

        {/* Empty */}
        {!isLoading && !isError && shown.length === 0 && (
          <div className="flex w-full items-center justify-center py-[40px] text-[13px] text-muted">
            No skills found.{' '}
            <button
              type="button"
              className="ml-[4px] text-link hover:underline"
              onClick={() => onDialog('write-skill')}
            >
              Write your first skill
            </button>
          </div>
        )}

        {/* Grid */}
        {!isLoading && !isError && shown.length > 0 && (
          <div className="grid grid-cols-2 gap-[12px]">
            {shown.map((s) => (
              <div
                key={s.id}
                className="flex flex-col gap-[8px] rounded-lg border border-line-strong bg-surface p-[14px]"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-[6px]">
                    <span className="text-[15px]">📋</span>
                    <span className="text-[13px] font-semibold text-ink">{s.name}</span>
                  </div>
                  <span onClick={(e) => e.stopPropagation()}>
                    <Toggle on={s.status === 'active'} />
                  </span>
                </div>
                {s.bodyMd && <p className="text-[12px] text-muted">{s.bodyMd}</p>}
                <div className="flex items-center gap-[6px]">
                  <span className={`rounded-pill border px-[6px] py-[1px] text-[10.5px] ${
                    s.status === 'active'
                      ? 'border-info-line bg-info-tint text-info'
                      : 'border-line-strong bg-soft text-muted'
                  }`}>
                    {s.status}
                  </span>
                  <span className="text-[11px] text-muted">v{s.version}</span>
                  <span className="ml-auto text-[11px] text-muted">used {s.usageCount}×</span>
                  <button
                    type="button"
                    aria-label={`Publish ${s.name}`}
                    onClick={() => handlePublish(s.id, s.name)}
                    className="flex items-center gap-[4px] rounded-sm px-[6px] py-[2px] text-[11px] text-muted hover:bg-soft hover:text-ink"
                  >
                    <Upload size={11} aria-hidden />
                    Publish
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Starters */}
        <div className="mt-[20px] flex items-center gap-[8px] flex-wrap">
          <span className="text-[12px] text-muted">Starters</span>
          {['+ Refund policy', '+ Onboarding guide', '+ House voice'].map((s) => (
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
          skill={{ name: editing.name, desc: editing.bodyMd ?? '' }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
