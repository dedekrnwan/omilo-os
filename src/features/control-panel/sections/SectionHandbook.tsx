import type { ReactNode } from 'react'
import {
  ArrowLeft,
  Building2,
  ChevronDown,
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
import { Chip, IconTile, Initials, PageHeader, PageShell, PenButton } from '../ControlPanelShared'
import { PEOPLE } from '../data'
import type { SectionProps } from '../ControlPanel'

interface HandbookFile {
  name: string
  icon: LucideIcon
  desc: string
  meta: string
  locked?: boolean
  badge?: { tone: 'warn' | 'info'; label: string }
}

const FILES: HandbookFile[] = [
  { name: 'COMPANY.md', icon: Building2, desc: 'Who we are, who we serve and the 64 RTs we cover', meta: 'Everyone · 5d ago' },
  { name: 'SERVICES.md', icon: ListChecks, desc: 'Dues, letters and bookings — what each costs and takes', meta: 'Everyone · 2w ago' },
  { name: 'POLICIES.md', icon: ShieldCheck, desc: 'Refunds, resident data, and what needs an owner’s OK', meta: 'Everyone · 1d ago', badge: { tone: 'warn', label: '1 suggested edit' } },
  { name: 'VOICE.md', icon: MessageSquareQuote, desc: 'How we talk to residents and RT heads', meta: 'Everyone · 3w ago' },
  { name: 'FAQ.md', icon: MessagesSquare, desc: 'What residents ask every week, answered once', meta: 'Everyone · today', badge: { tone: 'info', label: '3 new from Support' } },
  { name: 'PEOPLE.md', icon: Contact, desc: 'Who owns what, and who to call after hours', meta: 'Members & helpers only', locked: true },
]

/** pen Read-by stack: Chief · Builder · Grower · Sales · Finance · Support (Mini/*, 24, r7). */
const READERS: HelperArea[] = ['brand', 'dev', 'marketing', 'sales', 'finance', 'support']

/** pen TZ6Ia · Company handbook — and bb67G · POLICIES.md (variant `policies`). */
export function SectionHandbook({ variant, onVariant }: SectionProps) {
  if (variant === 'policies') return <PoliciesFile onBack={() => onVariant?.(null)} />
  return (
    <PageShell crumb="Company handbook" gap={20}>
      <PageHeader
        gap={10}
        title="Company handbook"
        sub="What Sahabat Warga is, how it works and the rules. Every helper reads it before acting, and every person can read it in Docs."
        actions={
          <>
            <PenButton fs={13} icon={Eye}>Preview as staff</PenButton>
            <PenButton variant="primary" icon={FilePlus}>New file</PenButton>
          </>
        }
      />

      <div className="flex w-full flex-col gap-[12px] rounded-lg p-[18px] outline-1 -outline-offset-1 outline-line-strong">
        <div className="flex w-full items-center gap-[8px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="text-[14px] font-semibold text-ink">Company brief</span>
            <span className="text-[12.5px] text-muted">The paragraph every helper reads first, and the first page new staff see.</span>
          </div>
          <PenButton variant="quiet" h={30} fs={13} icon={Pencil}>Edit</PenButton>
        </div>
        <div className="w-full rounded-md bg-soft px-[14px] py-[12px] outline-1 -outline-offset-1 outline-line">
          <p className="m-0 font-mono text-[12.5px] leading-[1.6] text-ink-2">
            Sahabat Warga runs neighbourhood admin for 64 RTs in South Jakarta: monthly dues, cover letters, facility bookings and clean-up days. We serve residents first, RT heads second. We speak Bahasa Indonesia, warm and plain. We never share a resident’s data outside their RT, and we never promise money we haven’t approved…
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
            {PEOPLE.map((p) => (
              <Initials key={p.initials} text={p.initials} color={p.initials === 'DK' ? '#44403C' : p.color} size={24} fs={9.5} ring />
            ))}
          </div>
          <span className="text-[12px] font-medium text-ink-2">4 people</span>
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
              onClick={() => f.name === 'POLICIES.md' && onVariant?.('policies')}
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

/** pen bb67G · Company handbook · POLICIES.md */
function PoliciesFile({ onBack }: { onBack: () => void }) {
  return (
    <PageShell crumb={'Company handbook  /  POLICIES.md'} gap={16} width={960}>
      <div className="flex w-full items-center gap-[10px]">
        <button type="button" onClick={onBack} className="flex items-center gap-[6px]">
          <ArrowLeft size={14} aria-hidden className="text-muted" />
          <span className="text-[13px] text-muted">Company handbook</span>
        </button>
        <div className="h-px flex-1" />
        <button
          type="button"
          className="flex h-[30px] items-center gap-[6px] rounded-btn px-[10px] outline-1 -outline-offset-1 outline-line-strong"
        >
          <Globe size={13} aria-hidden className="text-ink-2" />
          <span className="text-[12.5px] text-ink-2">Everyone can read</span>
          <ChevronDown size={13} aria-hidden className="text-muted" />
        </button>
        <PenButton variant="primary" h={30} fs={13} icon={Pencil}>Edit</PenButton>
      </div>

      <div className="flex w-full items-start gap-[24px]">
        <article className="flex min-w-0 flex-1 flex-col gap-[10px] rounded-lg px-[26px] py-[22px] outline-1 -outline-offset-1 outline-line-strong">
          <span className="font-mono text-[11.5px] text-faint">POLICIES.md</span>
          <h1 className="m-0 font-display text-[24px] font-semibold tracking-[-0.4px] text-ink">Policies</h1>
          <p className="m-0 text-[13.5px] leading-[1.6] text-muted">
            The rules every helper and every person at Sahabat Warga follows. When something isn’t covered here, ask the owner — don’t guess.
          </p>
          <h2 className={H}>Refunds</h2>
          <p className={P}>
            {'•  Dues paid twice are refunded within 3 working days, to the same method.\n•  Booking deposits are refunded if cancelled 48 hours before.\n•  Anything else needs an owner’s OK first.'}
          </p>
          <h2 className={H}>Resident data</h2>
          <p className={P}>
            {'•  A resident’s name, phone and address never leave their own RT.\n•  Never paste resident data into a public channel or a shared doc.'}
          </p>
          <h2 className={H}>Late dues</h2>
          <p className={P}>{'•  A Rp 10.000 late fee applies after the 10th of the month.'}</p>
          <div className="w-full rounded-sm bg-ok-tint px-[12px] py-[8px] shadow-[inset_3px_0_0_var(--color-ok-line)]">
            <p className="m-0 whitespace-pre-wrap text-[13.5px] leading-[1.6] text-ok">
              {'+  The late fee is waived for residents aged 65 and over.'}
            </p>
          </div>
        </article>

        <aside className="flex w-[280px] shrink-0 flex-col gap-[14px]">
          <div className="flex w-full flex-col gap-[10px] rounded-lg bg-warn-tint p-[14px] outline-1 -outline-offset-1 outline-warn-line">
            <div className="flex w-full items-center gap-[8px]">
              <Mascot helper area="support" size={24} radius={7} />
              <span className="text-[12.5px] font-semibold text-ink">Support suggests an edit</span>
            </div>
            <p className="m-0 text-[12.5px] leading-[1.5] text-ink-2">
              Residents asked about the late fee for elders 4 times this month (RT 04, RT 09). Adding the rule lets me answer without asking you.
            </p>
            <div className="flex gap-[6px]">
              <PenButton variant="primary" h={28} fs={12.5} px={12}>Accept</PenButton>
              <PenButton h={28} fs={12.5} px={12}>Dismiss</PenButton>
            </div>
          </div>
          <div className="flex w-full flex-col gap-[8px] px-[2px] py-[4px]">
            <SideTitle>USED THIS WEEK</SideTitle>
            <SideRow lead={<Mascot helper area="support" size={24} radius={7} />} label="Support" right="41×" />
            <SideRow lead={<Mascot helper area="finance" size={24} radius={7} />} label="Finance" right="6×" />
            <SideRow lead={<Mascot helper area="brand" size={24} radius={7} />} label="Chief" right="3×" />
            <SideRow lead={<Users size={14} aria-hidden className="text-muted" />} label="Opened by 3 people" right="8×" />
          </div>
          <div className="flex w-full flex-col gap-[8px] px-[2px] py-[4px]">
            <SideTitle>HISTORY</SideTitle>
            <SideRow lead={null} label="v12 · you" right="1d" />
            <SideRow lead={null} label="v11 · accepted from Finance" right="1w" />
            <SideRow lead={null} label="v10 · you" right="3w" />
          </div>
        </aside>
      </div>
    </PageShell>
  )
}
