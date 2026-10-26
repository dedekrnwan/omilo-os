import { useState } from 'react'
import { BadgeDollarSign, BookOpenCheck, CalendarCheck, Check, Info, Languages, Pencil, Plus, QrCode, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import type { HelperRecord } from './teamData'
import { Btn, Chip, Drawer, DrawerClose, DrawerTitle, Eyebrow, IconTile, InputField } from './ui'

const SUGGESTED: { name: string; desc: string; meta: string; icon: LucideIcon; added?: boolean }[] = [
  { name: 'Refund check', desc: 'Checks Midtrans before promising a refund', meta: 'Saga · 4.8 · 1.2k teams', icon: BadgeDollarSign },
  { name: 'Facility booking', desc: 'Books the hall or field and confirms on WhatsApp', meta: 'Saga · 4.7 · 860 teams', icon: CalendarCheck },
  { name: 'Translate replies', desc: 'Answers in English, Javanese or Sundanese', meta: 'Saga · 4.9 · 2.1k teams', icon: Languages, added: true },
  { name: 'Visitor pass', desc: 'Creates a guest QR pass for the security post', meta: 'Your company · Written by you', icon: QrCode },
]

/** Browse skills — pen uvNJ3 (Drawer nsZwE). */
export function BrowseSkillsDialog({ helper, onClose }: { helper: HelperRecord; onClose: () => void }) {
  const navigate = useNavigate()
  const n = helper.name
  const [added, setAdded] = useState(new Set(SUGGESTED.filter((s) => s.added).map((s) => s.name)))
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
      <InputField icon={Search} placeholder="Search skills" className="w-full" />
      <Eyebrow>SUGGESTED FOR {n.toUpperCase()}</Eyebrow>
      <div className="flex w-full flex-col rounded-lg px-[14px] outline-1 -outline-offset-1 outline-line-strong">
        {SUGGESTED.map((s, i) => (
          <div
            key={s.name}
            className={`flex w-full items-center gap-[12px] py-[12px] ${i < SUGGESTED.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''}`}
          >
            <IconTile icon={s.icon} />
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-[13px] font-semibold text-ink">{s.name}</span>
              <span className="text-[12.5px] text-ink-2">{s.desc}</span>
              <span className="text-[11.5px] text-faint">{s.meta}</span>
            </div>
            {added.has(s.name) ? (
              <Chip tone="ok" icon={Check} className="self-center">
                Added
              </Chip>
            ) : (
              <Btn icon={Plus} h={30} onClick={() => setAdded((a) => new Set(a).add(s.name))}>
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
