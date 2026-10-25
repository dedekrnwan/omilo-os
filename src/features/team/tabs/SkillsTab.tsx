import { useEffect, useRef, useState } from 'react'
import { Check, Info, Plus } from 'lucide-react'
import { SKILLS } from '../teamData'
import type { HelperRecord, Skill } from '../teamData'
import { Btn, IconTile, Switch } from '../ui'
import { MenuItemBody, menuItemClass, menuSurface } from '../../../ui/ds/Menu'

const PERMISSION_OPTIONS: Skill['permission'][] = ['Always allowed', 'Ask each time']

function PermissionMenu({
  value,
  onPick,
  onClose,
}: {
  value: Skill['permission']
  onPick: (p: Skill['permission']) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Permission"
      className={`absolute top-[calc(100%+4px)] right-0 z-40 flex w-[180px] flex-col ${menuSurface}`}
    >
      {PERMISSION_OPTIONS.map((p) => (
        <button
          key={p}
          type="button"
          role="menuitemradio"
          aria-checked={value === p}
          className={`${menuItemClass} ${value === p ? 'bg-hover' : ''}`}
          onClick={() => { onPick(p); onClose() }}
        >
          <MenuItemBody icon={value === p ? Check : undefined} label={p} />
        </button>
      ))}
    </div>
  )
}

function SkillRow({ s, last }: { s: Skill; last: boolean }) {
  const [on, setOn] = useState(s.enabled)
  const [permission, setPermission] = useState<Skill['permission']>(s.permission)
  const [permOpen, setPermOpen] = useState(false)
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
      <div className="relative" style={{ opacity: on ? 1 : 0.5 }}>
        <button
          type="button"
          onClick={() => on && setPermOpen((v) => !v)}
          disabled={!on}
          className="flex h-[36px] w-[160px] items-center gap-[8px] rounded-base bg-surface px-[10px] text-left outline-1 -outline-offset-1 outline-line-strong hover:bg-soft disabled:cursor-not-allowed"
        >
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{permission}</span>
        </button>
        {permOpen && (
          <PermissionMenu
            value={permission}
            onPick={setPermission}
            onClose={() => setPermOpen(false)}
          />
        )}
      </div>
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
          "Ask each time" shows a skill confirmation card in the chat before it runs.
        </span>
      </div>
    </div>
  )
}
