import { useState } from 'react'
import { Plus, Upload } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Breadcrumb, SectionPane, Toggle } from '../legacyShared'
import { Segmented } from '../../team/ui'
import { DialogWriteSkill } from '../dialogs/DialogWriteSkill'
import type { DialogKind } from '../legacyTypes'
import { notify } from '../../../ui/ds/Toaster'
import { useHelpers, usePublishSkill, useSkills, useUpdateSkill } from '../../../app/queries'
import type { Skill } from '../../../core/domain/types'
import { errorMessage } from '../format'
import { EmptyState } from '../../../ui/ds/EmptyState'

const SKILL_FILTERS = ['All', 'active', 'draft', 'disabled'] as const

/** Starter playbooks — open the editor pre-filled. */
const STARTERS: { name: string; body: string }[] = [
  {
    name: 'Refund policy',
    body: '# When a customer asks for a refund\n1. Find the order and check it is within 14 days.\n2. If it is, refund in full and confirm by email.\n3. If not, offer store credit and explain why.\n# Never\n4. Refund more than the order total.',
  },
  {
    name: 'Onboarding guide',
    body: '# When someone new joins\n1. Send the welcome message with the handbook link.\n2. Add them to their channels.\n3. Book a 15-minute intro with their lead.\n4. Check in after their first week.',
  },
  {
    name: 'House voice',
    body: '# How we write\n1. Short sentences, plain words.\n2. Warm, never pushy. Use the customer’s name.\n3. Bahasa Indonesia unless they write in English.\n# Never\n4. Use slang or emoji in complaints.',
  },
]
type SkillFilter = (typeof SKILL_FILTERS)[number]

interface Props {
  onDialog: (d: DialogKind) => void
}

export function SectionSkills({ onDialog }: Props) {
  const { data: skills = [], isLoading, isError } = useSkills()
  const { data: helpers = [] } = useHelpers()
  const publish = usePublishSkill()
  const updateSkill = useUpdateSkill()
  const [filter, setFilter] = useState<SkillFilter>('All')
  const [editing, setEditing] = useState<Skill | null>(null)
  const [starter, setStarter] = useState<{ name: string; body: string } | null>(null)

  const shown = filter === 'All' ? skills : skills.filter((s) => s.status === filter)
  const helperName = (id: string) => helpers.find((h) => h.id === id)?.name

  function handlePublish(id: string, name: string) {
    publish
      .mutateAsync(id)
      .then(() => notify(`"${name}" sent for review — approve it in your inbox`))
      .catch((e) => notify(errorMessage(e, `Failed to publish "${name}"`)))
  }

  /**
   * On/off toggle: a live skill turns off (helpers stop seeing it) and back on
   * via PATCH /skills/{id}; a draft goes live through publish review.
   */
  async function handleToggle(skill: Skill) {
    if (skill.status === 'draft') {
      handlePublish(skill.id, skill.name)
      return
    }
    const next = skill.status === 'active' ? 'disabled' : 'active'
    try {
      await updateSkill.mutateAsync({ id: skill.id, input: { status: next } })
      notify(next === 'disabled' ? `"${skill.name}" turned off` : `"${skill.name}" turned on`)
    } catch (e) {
      notify(errorMessage(e, 'Could not update the skill'))
    }
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
          <EmptyState
            size="lg"
            title="No skills yet"
            description="A skill is a how-to every helper can follow — how you write an offer, how you close the month."
            primary={{ label: 'Write your first skill', icon: Plus, onClick: () => onDialog('write-skill') }}
          />
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
                    <button
                      type="button"
                      onClick={() => setEditing(s)}
                      className="text-left text-[13px] font-semibold text-ink hover:underline"
                      aria-label={`Edit ${s.name}`}
                    >
                      {s.name}
                    </button>
                  </div>
                  <span onClick={(e) => e.stopPropagation()}>
                    <Toggle on={s.status === 'active'} onClick={() => void handleToggle(s)} label={`Enable ${s.name}`} />
                  </span>
                </div>
                {s.bodyMd && <p className="line-clamp-3 whitespace-pre-line text-[12px] text-muted">{s.bodyMd}</p>}
                {helperName(s.helperId) && <p className="text-[11.5px] text-faint">Used by {helperName(s.helperId)}</p>}
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
          {STARTERS.map((st) => (
            <button
              key={st.name}
              type="button"
              onClick={() => setStarter(st)}
              className="rounded-pill border border-line-strong bg-surface px-[8px] py-[3px] text-[12px] text-link hover:bg-soft"
            >
              + {st.name}
            </button>
          ))}
        </div>
      </SectionPane>

      {editing && (
        <DialogWriteSkill
          skill={{ id: editing.id, name: editing.name, desc: editing.bodyMd ?? '', helperId: editing.helperId, status: editing.status }}
          onClose={() => setEditing(null)}
        />
      )}
      {starter && <DialogWriteSkill starter={starter} onClose={() => setStarter(null)} />}
    </div>
  )
}
