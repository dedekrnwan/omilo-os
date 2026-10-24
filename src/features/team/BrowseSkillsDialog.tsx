import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '../../ui/ds/Button'

interface BrowseSkillOption {
  name: string
  version: string
  source: string
  description: string
  rating: string
  teams: string
  added?: boolean
  writtenByYou?: boolean
}

const SUGGESTED_SKILLS: BrowseSkillOption[] = [
  { name: 'Refund check', version: '4.0', source: 'Saga', description: 'Checks Midtrans before promising a refund', rating: '4.8', teams: '1.0k' },
  { name: 'Facility booking', version: '3.2', source: 'Saga', description: 'Books the hall or field and confirms on WhatsApp', rating: '4.7', teams: '860' },
  { name: 'Translate replies', version: '2.1', source: 'Saga', description: 'Answers in English, Japanese or Sundanese', rating: '4.9', teams: '2.5k', added: true },
  { name: 'Visitor pass', version: '1.9', source: 'Saga', description: 'Creates a guest QR pass for the security post', rating: '4.6', teams: '', writtenByYou: true },
]

interface BrowseSkillsDialogProps {
  helperName: string
  onClose: () => void
}

export function BrowseSkillsDialog({ helperName, onClose }: BrowseSkillsDialogProps) {
  const [query, setQuery] = useState('')
  const [skills, setSkills] = useState(SUGGESTED_SKILLS)

  function toggleAdd(name: string) {
    setSkills((prev) =>
      prev.map((s) => (s.name === name ? { ...s, added: !s.added } : s))
    )
  }

  const filtered = query
    ? skills.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()) || s.description.toLowerCase().includes(query.toLowerCase()))
    : skills

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-ink/10" onClick={onClose}>
      <div
        className="relative mr-[6px] mt-[6px] mb-[6px] flex h-[calc(100%-12px)] w-[380px] flex-col overflow-hidden rounded-lg bg-surface outline-1 -outline-offset-1 outline-line-strong shadow-[0_10px_40px_#0C0A091F]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line px-[20px] pt-[20px] pb-[14px]">
          <div>
            <h2 className="m-0 text-[15px] font-semibold text-ink">Add a skill to {helperName}</h2>
            <p className="m-0 mt-[2px] text-[12px] text-muted">
              Skills are ready-made routines. Company skills are written in Control panel → Skills
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex size-[24px] items-center justify-center rounded-sm text-muted hover:bg-hover transition-colors">
            <X size={14} aria-hidden />
          </button>
        </div>

        {/* Search */}
        <div className="px-[16px] py-[10px] border-b border-line">
          <div className="relative">
            <span className="absolute left-[10px] top-1/2 -translate-y-1/2 text-faint text-[13px]">🔍</span>
            <input
              type="search"
              placeholder="Search skills"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-md bg-soft pl-[30px] pr-[10px] py-[7px] text-[12.5px] text-ink placeholder:text-faint outline-none focus:outline-2 focus:-outline-offset-1 focus:outline-primary"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-[16px] pt-[12px] pb-[4px] text-[10.5px] font-medium tracking-[0.55px] text-faint uppercase">
            Suggested for {helperName}
          </div>
          <div className="flex flex-col">
            {filtered.map((skill) => (
              <div key={skill.name} className="flex items-start gap-[12px] px-[16px] py-[10px] hover:bg-soft transition-colors">
                <div className="flex size-[28px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line-strong text-[14px]">
                  📋
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <div className="flex items-center gap-[6px]">
                    <span className="text-[13px] font-medium text-ink">{skill.name}</span>
                    {skill.writtenByYou && (
                      <span className="text-[11px] text-faint">Your company · Written by you</span>
                    )}
                  </div>
                  <span className="text-[11.5px] text-muted">{skill.description}</span>
                  {!skill.writtenByYou && (
                    <span className="text-[11px] text-faint">
                      {skill.source} · {skill.rating} · {skill.teams} teams
                    </span>
                  )}
                </div>
                {skill.added ? (
                  <span className="flex items-center gap-[4px] text-[12px] font-medium text-ok">
                    <Check size={13} aria-hidden />
                    Added
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleAdd(skill.name)}
                    className="flex items-center gap-[4px] rounded-md bg-soft px-[8px] py-[4px] text-[12px] text-link outline-1 -outline-offset-1 outline-line-strong hover:bg-hover transition-colors"
                  >
                    + Add
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Write skill */}
        <div className="border-t border-line px-[16px] py-[12px] flex items-center justify-between">
          <button type="button" className="flex items-center gap-[6px] text-[12.5px] text-muted hover:text-ink transition-colors">
            <span className="text-[14px]">✏️</span>
            Write a new skill
          </button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  )
}
