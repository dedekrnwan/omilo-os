import { useState } from 'react'
import { Info, Plus } from 'lucide-react'
import { SKILLS } from '../teamData'
import type { HelperRecord, Skill } from '../teamData'
import { Btn, IconTile, SelectField, Switch } from '../ui'

function SkillRow({ s, last }: { s: Skill; last: boolean }) {
  const [on, setOn] = useState(s.enabled)
  return (
    <div className={`flex w-full items-center gap-[12px] py-[12px] ${last ? '' : 'shadow-[inset_0_-1px_0_var(--color-line)]'}`}>
      <IconTile icon={s.icon} iconClass={on ? 'text-ink-2' : 'text-faint'} />
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <div className="flex items-center gap-[8px]">
          <span className={`text-[13.5px] font-medium ${on ? 'text-ink' : 'text-muted'}`}>{s.name}</span>
          <span className="font-mono text-[11px] text-faint">{s.version}</span>
        </div>
        <span className="text-[12px] text-muted">{s.description}</span>
      </div>
      <SelectField value={s.permission} width={160} style={{ opacity: on ? 1 : 0.5 }} />
      <Switch on={on} onChange={setOn} label={`${s.name} on`} />
    </div>
  )
}

/** Skills tab — pen dXeCS. */
export function SkillsTab({ helper, onBrowse }: { helper: HelperRecord; onBrowse: () => void }) {
  return (
    <div className="flex w-full flex-col gap-[20px]">
      <section className="flex w-full flex-col gap-[10px]">
        <div className="flex w-full items-center gap-[8px]">
          <h3 className="m-0 text-[14px] font-semibold text-ink">Skills {helper.name} can use</h3>
          <span className="text-[12.5px] text-muted">{SKILLS.filter((s) => s.enabled).length} on</span>
          <span className="h-px flex-1" />
          <Btn icon={Plus} h={30} onClick={onBrowse}>
            Browse skills
          </Btn>
        </div>
        <div className="flex w-full flex-col rounded-lg px-[16px] outline-1 -outline-offset-1 outline-line-strong">
          {SKILLS.map((s, i) => (
            <SkillRow key={s.name} s={s} last={i === SKILLS.length - 1} />
          ))}
        </div>
      </section>
      <div className="flex w-full items-center gap-[8px]">
        <Info size={13} aria-hidden className="text-muted" />
        <span className="text-[12px] text-muted">
          “Ask each time” shows a skill confirmation card in the chat before it runs.
        </span>
      </div>
    </div>
  )
}
