import { useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import type { HelperRecord } from '../teamData'
import type { Skill } from '../teamData'
import { BrowseSkillsDialog } from '../BrowseSkillsDialog'

function SkillPermissionSelect({ skill }: { skill: Skill }) {
  return (
    <button
      type="button"
      className="flex items-center gap-[4px] rounded-md bg-soft px-[8px] py-[4px] text-[12px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong hover:bg-hover transition-colors"
    >
      {skill.permission}
      <ChevronDown size={11} aria-hidden className="text-muted" />
    </button>
  )
}

function SkillToggle({ enabled }: { enabled: boolean }) {
  return (
    <div
      className={`relative h-[18px] w-[30px] rounded-full transition-colors ${enabled ? 'bg-ok' : 'bg-line-strong'}`}
      aria-hidden
    >
      <span
        className={`absolute top-[2px] size-[14px] rounded-full bg-surface shadow-sm transition-transform ${
          enabled ? 'left-[14px]' : 'left-[2px]'
        }`}
      />
    </div>
  )
}

interface SkillsTabProps {
  helper: HelperRecord
}

export function SkillsTab({ helper }: SkillsTabProps) {
  const [browseOpen, setBrowseOpen] = useState(false)
  const enabledCount = helper.skills.filter((s) => s.enabled).length

  return (
    <>
      <div className="flex flex-col gap-[20px]">
        <div className="flex items-center justify-between">
          <h3 className="m-0 text-[13px] font-medium text-ink">
            Skills {helper.name} can use{' '}
            <span className="font-normal text-muted">{enabledCount} on</span>
          </h3>
          <Button variant="secondary" height={28} icon={Plus} onClick={() => setBrowseOpen(true)}>
            Browse skills
          </Button>
        </div>

        {helper.skills.length === 0 ? (
          <div className="flex flex-col items-center gap-[8px] rounded-lg py-[32px] outline-1 -outline-offset-1 outline-line-strong bg-soft text-center">
            <p className="m-0 text-[13px] text-muted">No skills yet.</p>
            <button
              type="button"
              onClick={() => setBrowseOpen(true)}
              className="text-[12.5px] text-link hover:underline"
            >
              Browse available skills
            </button>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {helper.skills.map((skill) => (
              <div key={skill.name} className="flex items-center gap-[12px] py-[10px]">
                <div className="flex size-[28px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line-strong text-[14px]">
                  📋
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                  <div className="flex items-center gap-[6px]">
                    <span className="text-[13px] font-medium text-ink">{skill.name}</span>
                    <span className="text-[11px] text-faint">{skill.version}</span>
                    <span className="text-[11px] text-faint">·</span>
                    <span className="text-[11px] text-faint">{skill.source}</span>
                  </div>
                  <span className="text-[11.5px] text-muted">{skill.description}</span>
                </div>
                <SkillPermissionSelect skill={skill} />
                <SkillToggle enabled={skill.enabled} />
              </div>
            ))}
          </div>
        )}

        <p className="m-0 text-[11.5px] text-muted">
          "Ask each time" shows a skill confirmation card in the chat before it runs.
        </p>
      </div>

      {browseOpen && (
        <BrowseSkillsDialog
          helperName={helper.name}
          onClose={() => setBrowseOpen(false)}
        />
      )}
    </>
  )
}
