import { useState } from 'react'
import { BookOpenCheck, Check, Info, Pencil, Plus, Search } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useHelperSkillRows, useHelpers, useSetHelperSkills, useSkills } from '../../app/queries'
import { notify } from '../../ui/ds/Toaster'
import type { HelperRecord } from './teamData'
import { Btn, Chip, Drawer, DrawerClose, DrawerTitle, Eyebrow, IconTile, InputField } from './ui'
import { EmptyState } from '../../ui/ds/EmptyState'

/** Browse skills — pen uvNJ3 (Drawer nsZwE). Lists the company's skills; Add attaches one to this helper. */
export function BrowseSkillsDialog({ helper, onClose }: { helper: HelperRecord; onClose: () => void }) {
  const navigate = useNavigate()
  const n = helper.name
  const [q, setQ] = useState('')
  const { data: all = [], isLoading } = useSkills()
  const { data: mine = [] } = useHelperSkillRows(helper.id)
  const { data: team = [] } = useHelpers()
  const setSkills = useSetHelperSkills(helper.id)
  const added = new Set(mine.map((s) => s.id))
  const query = q.trim().toLowerCase()
  const list = all.filter((s) => !query || s.name.toLowerCase().includes(query))
  const ownerOf = (helperId: string) => team.find((h) => h.id === helperId)?.name

  const add = (id: string, name: string) =>
    setSkills.mutate([{ id, enabled: true, permission: 'ask' }], {
      onSuccess: () => notify(`${name} added to ${n}`),
      onError: () => notify(`Couldn't add ${name}`),
    })

  return (
    <Drawer
      label={`Add a skill to ${n}`}
      onClose={onClose}
      head={
        <>
          <IconTile icon={BookOpenCheck} />
          <DrawerTitle
            title={`Add a skill to ${n}`}
            sub="Skills are ready-made routines. Company skills are written in Control panel → Skills."
          />
          <DrawerClose onClose={onClose} />
        </>
      }
      footer={
        <>
          <Btn variant="quiet" icon={Pencil} onClick={() => { onClose(); void navigate({ to: '/control-panel/$section', params: { section: 'skills' } }) }}>
            Write a new skill
          </Btn>
          <span className="h-px flex-1" />
          <Btn variant="primary" onClick={onClose}>
            Done
          </Btn>
        </>
      }
    >
      <InputField icon={Search} placeholder="Search skills" value={q} onChange={setQ} className="w-full" />
      <Eyebrow>COMPANY SKILLS</Eyebrow>
      <div className="flex w-full flex-col rounded-lg px-[14px] outline-1 -outline-offset-1 outline-line-strong">
        {isLoading && <span className="py-[12px] text-[12.5px] text-muted">Loading skills…</span>}
        {!isLoading && list.length === 0 && (
          query ? (
            <EmptyState size="sm" title="No skills match" description="Try another word." />
          ) : (
            <EmptyState
              size="sm"
              title="No company skills yet"
              description="Write one in Control panel → Skills and every helper can use it."
            />
          )
        )}
        {list.map((s, i) => (
          <div
            key={s.id}
            className={`flex w-full items-center gap-[12px] py-[12px] ${i < list.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''}`}
          >
            <IconTile icon={BookOpenCheck} />
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-[13px] font-semibold text-ink">{s.name}</span>
              <span className="text-[11.5px] text-faint">
                v{s.version} · {s.status}
                {ownerOf(s.helperId) ? ` · learned by ${ownerOf(s.helperId)}` : ''} · used {s.usageCount}×
              </span>
            </div>
            {added.has(s.id) ? (
              <Chip tone="ok" icon={Check} className="self-center">
                Added
              </Chip>
            ) : (
              <Btn icon={Plus} h={30} onClick={() => add(s.id, s.name)} disabled={setSkills.isPending}>
                Add
              </Btn>
            )}
          </div>
        ))}
      </div>
      <div className="flex w-full items-center gap-[8px]">
        <Info size={13} aria-hidden className="shrink-0 text-muted" />
        <span className="text-[12px] text-muted">
          New skills start on “Ask each time”. {n} shows a confirmation card before the first run.
        </span>
      </div>
    </Drawer>
  )
}
