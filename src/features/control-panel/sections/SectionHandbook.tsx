import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  Building2,
  Check,
  ChevronRight,
  Contact,
  Eye,
  FilePlus,
  Globe,
  History,
  ListChecks,
  Lock,
  MessageSquareQuote,
  MessagesSquare,
  Pencil,
  Pin,
  ShieldCheck,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Mascot } from '../../../ui/ds/Mascot'
import type { HelperArea } from '../../../core/domain/types'
import { Drawer } from '../../routines/ui'
import { Chip, IconTile, Initials, PageHeader, PageShell, PenButton } from '../ControlPanelShared'
import type { SectionProps } from '../ControlPanel'
import { notify } from '../../../ui/ds/Toaster'
import { useMembers } from '../../../app/queries'
import { useSession } from '../../../app/session'

// NOTE: The Handbook uses rich structured HandbookFile objects (sections,
// suggestions, history, used-by stats). useKnowledge() returns KbItem recall
// chunks (sourceId, heading, text, score) which lack this metadata. Wiring the
// handbook *file list* to useKnowledge would require a sources list endpoint
// (GET /v1/knowledge/sources — not yet implemented) and a mapping layer.
// For P13 we wire only the "read by N people" avatar stack to real members;
// the handbook file content stays as-is until a dedicated handbook endpoint exists.

interface Section {
  h: string
  body: string
  /** Optional green "added" note rendered below the section. */
  note?: string
}

interface UsedRow {
  area?: HelperArea
  icon?: LucideIcon
  label: string
  count: string
}

interface HandbookFile {
  name: string
  icon: LucideIcon
  title: string
  desc: string
  meta: string
  /** Footer line in the drawer, e.g. "Edited by you · 1 day ago · v12". */
  edited: string
  locked?: boolean
  badge?: { tone: 'warn' | 'info'; label: string }
  intro: string
  sections: Section[]
  suggestion?: { area: HelperArea; who: string; text: string }
  used?: UsedRow[]
  history?: { label: string; right: string }[]
}

const FILES: HandbookFile[] = [
  {
    name: 'COMPANY.md',
    icon: Building2,
    title: 'Company',
    desc: 'Who we are, who we serve and the 64 RTs we cover',
    meta: 'Everyone · 5d ago',
    edited: 'Edited by you · 5 days ago · v4',
    intro: 'Who Sahabat Warga is, who we serve, and the 64 RTs we cover.',
    sections: [
      {
        h: 'Who we are',
        body: 'Sahabat Warga runs neighbourhood admin for 64 RTs in South Jakarta — monthly dues, cover letters, facility bookings and clean-up days. One small team, one phone number, one place everything is written down.',
      },
      {
        h: 'Who we serve',
        body: '•  Residents first — the people who live in each RT.\n•  RT heads second — they approve, we do the admin.\nWe speak Bahasa Indonesia, warm and plain.',
      },
      {
        h: 'The 64 RTs',
        body: 'We cover RT 01 to RT 64 across four kelurahan. Each RT has one head and one deputy, listed in PEOPLE.md.',
      },
    ],
    used: [
      { area: 'brand', label: 'Chief', count: '12×' },
      { area: 'support', label: 'Support', count: '9×' },
      { area: 'finance', label: 'Finance', count: '4×' },
    ],
    history: [
      { label: 'v4 · you', right: '5d' },
      { label: 'v3 · accepted from Chief', right: '2w' },
      { label: 'v2 · you', right: '1mo' },
    ],
  },
  {
    name: 'SERVICES.md',
    icon: ListChecks,
    title: 'Services',
    desc: 'Dues, letters and bookings — what each costs and takes',
    meta: 'Everyone · 2w ago',
    edited: 'Edited by Chief · 2 weeks ago · v7',
    intro: 'Dues, letters and bookings — what each costs and how long it takes.',
    sections: [
      {
        h: 'Monthly dues',
        body: '•  Rp 50.000 per household, due by the 10th.\n•  Paid by transfer or to the RT head in cash.\n•  A receipt is sent the same day.',
      },
      {
        h: 'Cover letters',
        body: '•  Domicile and introduction letters, issued within 2 working days.\n•  Free for residents in good standing.',
      },
      {
        h: 'Facility bookings',
        body: '•  Hall and sports court, Rp 150.000 deposit.\n•  Deposit is refunded if cancelled 48 hours before.',
      },
    ],
    used: [
      { area: 'finance', label: 'Finance', count: '22×' },
      { area: 'support', label: 'Support', count: '18×' },
    ],
    history: [
      { label: 'v7 · accepted from Finance', right: '2w' },
      { label: 'v6 · you', right: '5w' },
    ],
  },
  {
    name: 'POLICIES.md',
    icon: ShieldCheck,
    title: 'Policies',
    desc: 'Refunds, resident data, and what needs an owner’s OK',
    meta: 'Everyone · 1d ago',
    edited: 'Edited by you · 1 day ago · v12',
    badge: { tone: 'warn', label: '1 suggested edit' },
    intro:
      'The rules every helper and every person at Sahabat Warga follows. When something isn’t covered here, ask the owner — don’t guess.',
    sections: [
      {
        h: 'Refunds',
        body: '•  Dues paid twice are refunded within 3 working days, to the same method.\n•  Booking deposits are refunded if cancelled 48 hours before.\n•  Anything else needs an owner’s OK first.',
      },
      {
        h: 'Resident data',
        body: '•  A resident’s name, phone and address never leave their own RT.\n•  Never paste resident data into a public channel or a shared doc.',
      },
      {
        h: 'Late dues',
        body: '•  A Rp 10.000 late fee applies after the 10th of the month.',
        note: '+  The late fee is waived for residents aged 65 and over.',
      },
    ],
    suggestion: {
      area: 'support',
      who: 'Support suggests an edit',
      text: 'Residents asked about the late fee for elders 4 times this month (RT 04, RT 09). Adding the rule lets me answer without asking you.',
    },
    used: [
      { area: 'support', label: 'Support', count: '41×' },
      { area: 'finance', label: 'Finance', count: '6×' },
      { area: 'brand', label: 'Chief', count: '3×' },
      { icon: Users, label: 'Opened by 3 people', count: '8×' },
    ],
    history: [
      { label: 'v12 · you', right: '1d' },
      { label: 'v11 · accepted from Finance', right: '1w' },
      { label: 'v10 · you', right: '3w' },
    ],
  },
  {
    name: 'VOICE.md',
    icon: MessageSquareQuote,
    title: 'Voice',
    desc: 'How we talk to residents and RT heads',
    meta: 'Everyone · 3w ago',
    edited: 'Edited by you · 3 weeks ago · v3',
    intro: 'How we talk to residents and RT heads — the same voice, every helper.',
    sections: [
      {
        h: 'Tone',
        body: 'Warm, plain and short. Like a helpful neighbour, not an office. Bahasa Indonesia first.',
      },
      { h: 'Do', body: '•  Greet people by name.\n•  Say what happens next, and when.\n•  Thank them for waiting.' },
      { h: 'Don’t', body: '•  No jargon, no legalese.\n•  Never promise money or a date we haven’t approved.' },
    ],
    used: [
      { area: 'support', label: 'Support', count: '38×' },
      { area: 'brand', label: 'Chief', count: '5×' },
    ],
    history: [
      { label: 'v3 · you', right: '3w' },
      { label: 'v2 · accepted from Support', right: '2mo' },
    ],
  },
  {
    name: 'FAQ.md',
    icon: MessagesSquare,
    title: 'FAQ',
    desc: 'What residents ask every week, answered once',
    meta: 'Everyone · today',
    edited: 'Edited today · v9',
    badge: { tone: 'info', label: '3 new from Support' },
    intro: 'What residents ask every week, answered once so every helper replies the same way.',
    sections: [
      { h: 'When are dues due?', body: 'By the 10th of each month. A Rp 10.000 late fee applies after that.' },
      {
        h: 'How do I book the hall?',
        body: 'Ask any helper with the date and time. A Rp 150.000 deposit holds it, refundable up to 48 hours before.',
      },
      {
        h: 'How long does a cover letter take?',
        body: 'Two working days. We send it in the chat and keep a copy in Docs.',
      },
    ],
    suggestion: {
      area: 'support',
      who: 'Support added 3 new answers',
      text: 'From this week’s tickets: parking, visitor hours and the clean-up schedule. Accept to let every helper use them.',
    },
    used: [
      { area: 'support', label: 'Support', count: '54×' },
      { icon: Users, label: 'Opened by 6 people', count: '23×' },
    ],
    history: [
      { label: 'v9 · Support', right: 'today' },
      { label: 'v8 · you', right: '1w' },
    ],
  },
  {
    name: 'PEOPLE.md',
    icon: Contact,
    title: 'People',
    desc: 'Who owns what, and who to call after hours',
    meta: 'Members & helpers only',
    edited: 'Edited by you · 1 week ago · v6',
    locked: true,
    intro: 'Who owns what, and who to call after hours. Members and helpers only.',
    sections: [
      {
        h: 'Owners',
        body: '•  Dues and refunds — Finance.\n•  Letters and bookings — Support.\n•  Everything else — the Chief of Staff.',
      },
      {
        h: 'After hours',
        body: '•  Urgent only: the RT head on duty, listed per RT.\n•  Non-urgent waits until the next working day.',
      },
    ],
    used: [
      { area: 'support', label: 'Support', count: '11×' },
      { area: 'brand', label: 'Chief', count: '7×' },
    ],
    history: [
      { label: 'v6 · you', right: '1w' },
      { label: 'v5 · you', right: '1mo' },
    ],
  },
]

/** pen Read-by stack: Chief · Builder · Grower · Sales · Finance · Support (Mini/*, 24, r7). */
const READERS: HelperArea[] = ['brand', 'dev', 'marketing', 'sales', 'finance', 'support']

/** Derive display initials from a name string. */
function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Deterministic color from an id string. */
const AVATAR_PALETTE = ['#57534E', '#0EA5E9', '#14B8A6', '#F97316', '#8B5CF6', '#EC4899', '#10B981', '#F59E0B']
function avatarColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
}

/** pen TZ6Ia · Company handbook. Clicking a file opens it in a right-side drawer. */
export function SectionHandbook({ variant, onVariant }: SectionProps) {
  const companyName = useSession((s) => s.company?.name) ?? 'your company'
  const { data: members } = useMembers()
  const [open, setOpen] = useState<HandbookFile | null>(() =>
    variant === 'policies' ? FILES.find((f) => f.name === 'POLICIES.md') ?? null : null,
  )
  const close = () => {
    setOpen(null)
    if (variant) onVariant?.(null)
  }
  return (
    <PageShell crumb="Company handbook" gap={20}>
      <PageHeader
        gap={10}
        title="Company handbook"
        sub={`What ${companyName} is, how it works and the rules. Every helper reads it before acting, and every person can read it in Docs.`}
        actions={
          <>
            <PenButton fs={13} icon={Eye} onClick={() => notify('Previewing as staff member')}>Preview as staff</PenButton>
            <PenButton variant="primary" icon={FilePlus} onClick={() => notify('New file — editor coming soon')}>New file</PenButton>
          </>
        }
      />

      <div className="flex w-full flex-col gap-[12px] rounded-lg p-[18px] outline-1 -outline-offset-1 outline-line-strong">
        <div className="flex w-full items-center gap-[8px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="text-[14px] font-semibold text-ink">Company brief</span>
            <span className="text-[12.5px] text-muted">The paragraph every helper reads first, and the first page new staff see.</span>
          </div>
          <PenButton variant="quiet" h={30} fs={13} icon={Pencil} onClick={() => notify('Opening brief editor…')}>Edit</PenButton>
        </div>
        <div className="w-full rounded-md bg-soft px-[14px] py-[12px] outline-1 -outline-offset-1 outline-line">
          <p className="m-0 font-mono text-[12.5px] leading-[1.6] text-ink-2">
            {companyName} runs neighbourhood admin for 64 RTs in South Jakarta: monthly dues, cover letters, facility bookings and clean-up days. We serve residents first, RT heads second. We speak Bahasa Indonesia, warm and plain. We never share a resident’s data outside their RT, and we never promise money we haven’t approved…
          </p>
        </div>
        <div className="flex items-center gap-[6px]">
          <History size={12} aria-hidden className="text-muted" />
          <span className="text-[11.5px] text-faint">Edited by you · 5 days ago · v4</span>
        </div>
      </div>

      <div className="flex w-full items-center gap-[24px] px-[2px]">
        <div className="flex items-center gap-[8px]">
          <span className="text-[12px] text-muted">Read by</span>
          <div className="flex -space-x-[6px]">
            {READERS.map((a) => (
              <Mascot key={a} helper area={a} size={24} radius={7} className="outline-2 outline-surface" />
            ))}
          </div>
          <span className="text-[12px] font-medium text-ink-2">6 helpers</span>
        </div>
        <div className="flex items-center gap-[8px]">
          <span className="text-[12px] text-muted">and</span>
          <div className="flex -space-x-[6px]">
            {(members ?? []).map((m) => (
              <Initials key={m.id} text={nameInitials(m.name)} color={avatarColor(m.id)} size={24} fs={9.5} ring />
            ))}
          </div>
          <span className="text-[12px] font-medium text-ink-2">{(members ?? []).length} {(members ?? []).length === 1 ? 'person' : 'people'}</span>
        </div>
        <div className="h-px flex-1" />
        <div className="flex items-center gap-[6px]">
          <Pin size={13} aria-hidden className="text-muted" />
          <span className="text-[12px] text-muted">Pinned in Docs › Company for everyone</span>
        </div>
      </div>

      <section className="flex w-full flex-col gap-[10px]">
        <div className="flex w-full items-center gap-[8px]">
          <h2 className="m-0 text-[14px] font-semibold text-ink">Handbook files</h2>
          <span className="text-[12.5px] text-muted">Helpers suggest edits as they learn — nothing changes until you accept</span>
        </div>
        <div className="grid w-full grid-cols-2 items-start gap-[12px]">
          {FILES.map((f) => (
            <button
              key={f.name}
              type="button"
              onClick={() => setOpen(f)}
              className="flex w-full items-center gap-[12px] rounded-lg px-[16px] py-[14px] text-left outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
            >
              <IconTile icon={f.icon} />
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <div className="flex w-full items-center gap-[8px]">
                  <span className="font-mono text-[13.5px] font-medium text-ink">{f.name}</span>
                  {f.badge && <Chip tone={f.badge.tone}>{f.badge.label}</Chip>}
                </div>
                <span className="text-[12.5px] text-muted">{f.desc}</span>
                <div className="flex items-center gap-[5px] pt-[2px]">
                  {f.locked ? (
                    <Lock size={11} aria-hidden className="text-faint" />
                  ) : (
                    <Globe size={11} aria-hidden className="text-faint" />
                  )}
                  <span className="text-[11.5px] text-faint">{f.meta}</span>
                </div>
              </div>
              <ChevronRight size={16} aria-hidden className="text-muted" />
            </button>
          ))}
        </div>
      </section>

      {open && <HandbookFileDrawer file={open} onClose={close} />}
    </PageShell>
  )
}

function SideRow({ lead, label, right }: { lead: ReactNode; label: string; right: string }) {
  return (
    <div className="flex w-full items-center gap-[8px]">
      {lead}
      <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">{label}</span>
      <span className="font-mono text-[11px] text-faint">{right}</span>
    </div>
  )
}

function SideTitle({ children }: { children: string }) {
  return <span className="text-[10.5px] font-semibold tracking-[1px] text-faint">{children}</span>
}

const H = 'm-0 font-display text-[17px] font-semibold tracking-[-0.2px] text-ink'
const P = 'm-0 whitespace-pre-wrap text-[13.5px] leading-[1.6] text-ink-2'

/** Serialise a handbook file's structured content to editable markdown. */
function fileToMarkdown(f: HandbookFile): string {
  return [
    f.intro,
    ...f.sections.map((s) => `## ${s.h}\n\n${s.body}${s.note ? `\n\n> ${s.note}` : ''}`),
  ].join('\n\n')
}

/** pen bb67G · a handbook file opened in the right-side drawer. */
function HandbookFileDrawer({ file, onClose }: { file: HandbookFile; onClose: () => void }) {
  const [suggestion, setSuggestion] = useState(file.suggestion ?? null)
  const scope = file.locked ? 'Members & helpers only' : 'Everyone can read'
  const ScopeIcon = file.locked ? Lock : Globe
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => fileToMarkdown(file))

  function acceptSuggestion() {
    setSuggestion(null)
    notify('Suggestion accepted — handbook updated')
  }
  function dismissSuggestion() {
    setSuggestion(null)
    notify('Suggestion dismissed')
  }

  return (
    <Drawer
      title={file.title}
      subtitle={`${file.name} · ${scope}`}
      onClose={onClose}
      bodyClass="gap-[16px] px-[24px] py-[20px]"
      footer={
        editing ? (
          <>
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">Editing {file.name}</span>
            <PenButton
              h={30}
              fs={13}
              onClick={() => {
                setDraft(fileToMarkdown(file))
                setEditing(false)
              }}
            >
              Cancel
            </PenButton>
            <PenButton variant="primary" h={30} fs={13} icon={Check} onClick={() => setEditing(false)}>
              Save changes
            </PenButton>
          </>
        ) : (
          <>
            <History size={12} aria-hidden className="text-muted" />
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">{file.edited}</span>
            <PenButton h={30} fs={13} icon={Pencil} onClick={() => setEditing(true)}>
              Edit
            </PenButton>
          </>
        )
      }
    >
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={`Edit ${file.name}`}
          className="w-full min-h-[55vh] flex-1 resize-none rounded-md bg-surface p-[14px] font-mono text-[13px] leading-[1.6] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-ink"
        />
      ) : (
        <>
      <div className="flex w-full items-center gap-[8px]">
        <span className="inline-flex h-[26px] items-center gap-[6px] rounded-btn px-[10px] outline-1 -outline-offset-1 outline-line-strong">
          <ScopeIcon size={12} aria-hidden className="text-ink-2" />
          <span className="text-[12px] text-ink-2">{scope}</span>
        </span>
      </div>

      <p className="m-0 text-[13.5px] leading-[1.6] text-muted">{file.intro}</p>

      {file.sections.map((s) => (
        <div key={s.h} className="flex w-full flex-col gap-[6px]">
          <h2 className={H}>{s.h}</h2>
          <p className={P}>{s.body}</p>
          {s.note && (
            <div className="w-full rounded-sm bg-ok-tint px-[12px] py-[8px] shadow-[inset_3px_0_0_var(--color-ok-line)]">
              <p className="m-0 whitespace-pre-wrap text-[13.5px] leading-[1.6] text-ok">{s.note}</p>
            </div>
          )}
        </div>
      ))}

      {suggestion && (
        <div className="flex w-full flex-col gap-[10px] rounded-lg bg-warn-tint p-[14px] outline-1 -outline-offset-1 outline-warn-line">
          <div className="flex w-full items-center gap-[8px]">
            <Mascot helper area={suggestion.area} size={24} radius={7} />
            <span className="text-[12.5px] font-semibold text-ink">{suggestion.who}</span>
          </div>
          <p className="m-0 text-[12.5px] leading-[1.5] text-ink-2">{suggestion.text}</p>
          <div className="flex gap-[6px]">
            <PenButton variant="primary" h={28} fs={12.5} px={12} onClick={acceptSuggestion}>Accept</PenButton>
            <PenButton h={28} fs={12.5} px={12} onClick={dismissSuggestion}>Dismiss</PenButton>
          </div>
        </div>
      )}

      {file.used && (
        <div className="flex w-full flex-col gap-[8px] pt-[2px]">
          <SideTitle>USED THIS WEEK</SideTitle>
          {file.used.map((u) => {
            const Icon = u.icon
            const lead = u.area ? (
              <Mascot helper area={u.area} size={24} radius={7} />
            ) : Icon ? (
              <Icon size={14} aria-hidden className="text-muted" />
            ) : null
            return <SideRow key={u.label} lead={lead} label={u.label} right={u.count} />
          })}
        </div>
      )}

      {file.history && (
        <div className="flex w-full flex-col gap-[8px]">
          <SideTitle>HISTORY</SideTitle>
          {file.history.map((h) => (
            <SideRow key={h.label} lead={null} label={h.label} right={h.right} />
          ))}
        </div>
      )}
        </>
      )}
    </Drawer>
  )
}
