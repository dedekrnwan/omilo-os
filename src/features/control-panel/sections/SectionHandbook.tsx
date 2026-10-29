import { useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Building2,
  Check,
  ChevronRight,
  Contact,
  Eye,
  FilePlus,
  FileText,
  Globe,
  History,
  ListChecks,
  Lock,
  MessageSquareQuote,
  MessagesSquare,
  Pencil,
  Pin,
  ShieldCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Mascot } from '../../../ui/ds/Mascot'
import type { HandbookFile, HandbookFileDetail } from '../../../core/domain/types'
import { Drawer } from '../../routines/ui'
import { Chip, IconTile, Initials, PageHeader, PageShell, PenButton } from '../ControlPanelShared'
import type { SectionProps } from '../ControlPanel'
import { notify } from '../../../ui/ds/Toaster'
import {
  useHandbook,
  useHandbookFile,
  useHelpers,
  useMembers,
  useResolveHandbookSuggestion,
  useSaveHandbookFile,
} from '../../../app/queries'
import { useSession } from '../../../app/session'
import { longAgo, shortAgo, whoLabel } from '../../office/docs/docsUtil'

// Handbook files live on the backend (GET /v1/handbook, GET/PUT /v1/handbook/{file},
// suggestions accept/dismiss). Readers are the company's helpers + members.

const FILE_ICON: Record<string, LucideIcon> = {
  'COMPANY.md': Building2,
  'SERVICES.md': ListChecks,
  'POLICIES.md': ShieldCheck,
  'VOICE.md': MessageSquareQuote,
  'FAQ.md': MessagesSquare,
  'PEOPLE.md': Contact,
}
const iconFor = (name: string) => FILE_ICON[name] ?? FileText

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

function useWho() {
  const { data: helpers = [] } = useHelpers()
  const { data: members = [] } = useMembers()
  const userId = useSession((s) => s.user?.id)
  return (by: string) => whoLabel(by, { userId, members, helpers })
}

/** pen TZ6Ia · Company handbook. Clicking a file opens it in a right-side drawer. */
export function SectionHandbook({ variant, onVariant }: SectionProps) {
  const navigate = useNavigate()
  const companyName = useSession((s) => s.company?.name) ?? 'your company'
  const { data: members = [] } = useMembers()
  const { data: helpers = [] } = useHelpers()
  const { data: index, isLoading, isError } = useHandbook()
  const who = useWho()
  const files = (index?.files ?? []).filter((f) => !f.brief)
  const briefFile = index?.files.find((f) => f.brief) ?? null
  const [open, setOpen] = useState<string | null>(() => (variant === 'policies' ? 'POLICIES.md' : null))
  const [creating, setCreating] = useState(false)
  const close = () => {
    setOpen(null)
    setCreating(false)
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
            <PenButton fs={13} icon={Eye} onClick={() => void navigate({ to: '/docs/$docId', params: { docId: 'handbook' } })}>Preview as staff</PenButton>
            <PenButton variant="primary" icon={FilePlus} onClick={() => { setOpen(null); setCreating(true) }}>New file</PenButton>
          </>
        }
      />

      <BriefCard file={briefFile} who={who} loading={isLoading} />

      <div className="flex w-full items-center gap-[24px] px-[2px]">
        <div className="flex items-center gap-[8px]">
          <span className="text-[12px] text-muted">Read by</span>
          <div className="flex -space-x-[6px]">
            {helpers.slice(0, 6).map((h) => (
              <Mascot key={h.id} helper area={h.area} size={24} radius={7} className="outline-2 outline-surface" />
            ))}
          </div>
          <span className="text-[12px] font-medium text-ink-2">
            {helpers.length} {helpers.length === 1 ? 'helper' : 'helpers'}
          </span>
        </div>
        <div className="flex items-center gap-[8px]">
          <span className="text-[12px] text-muted">and</span>
          <div className="flex -space-x-[6px]">
            {members.map((m) => (
              <Initials key={m.id} text={nameInitials(m.name)} color={avatarColor(m.id)} size={24} fs={9.5} ring />
            ))}
          </div>
          <span className="text-[12px] font-medium text-ink-2">{members.length} {members.length === 1 ? 'person' : 'people'}</span>
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
        {isError && <span className="text-[12.5px] text-bad">Couldn't load the handbook</span>}
        <div className="grid w-full grid-cols-2 items-start gap-[12px]">
          {isLoading && [1, 2, 3, 4].map((i) => <div key={i} className="h-[76px] animate-pulse rounded-lg bg-soft" />)}
          {files.map((f) => (
            <FileCard key={f.name} file={f} who={who} onOpen={() => { setCreating(false); setOpen(f.name) }} />
          ))}
        </div>
      </section>

      {open && <HandbookFileDrawer name={open} onClose={close} />}
      {creating && <NewFileDrawer onClose={close} onCreated={(name) => { setCreating(false); setOpen(name) }} />}
    </PageShell>
  )
}

function FileCard({ file, who, onOpen }: { file: HandbookFile; who: (by: string) => string; onOpen: () => void }) {
  const Icon = iconFor(file.name)
  const locked = file.visibility === 'members'
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-[12px] rounded-lg px-[16px] py-[14px] text-left outline-1 -outline-offset-1 outline-line-strong hover:bg-soft">
      <IconTile icon={Icon} />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="flex w-full items-center gap-[8px]">
          <span className="font-mono text-[13.5px] font-medium text-ink">{file.name}</span>
          {file.openSuggestions > 0 && (
            <Chip tone="warn">{`${file.openSuggestions} suggested edit${file.openSuggestions === 1 ? '' : 's'}`}</Chip>
          )}
        </div>
        <span className="text-[12.5px] text-muted">{file.description}</span>
        <div className="flex items-center gap-[5px] pt-[2px]">
          {locked ? <Lock size={11} aria-hidden className="text-faint" /> : <Globe size={11} aria-hidden className="text-faint" />}
          <span className="text-[11.5px] text-faint">
            {locked ? 'Members & helpers only' : 'Everyone'} · {shortAgo(file.updatedAt) === 'now' ? 'now' : `${shortAgo(file.updatedAt)} ago`} · v{file.version}
            {who(file.updatedBy) === 'you' ? '' : ` · ${who(file.updatedBy)}`}
          </span>
        </div>
      </div>
      <ChevronRight size={16} aria-hidden className="text-muted" />
    </button>
  )
}

function BriefCard({ file, who, loading }: { file: HandbookFile | null; who: (by: string) => string; loading: boolean }) {
  const { data: detail } = useHandbookFile(file?.name ?? null)
  const save = useSaveHandbookFile()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  return (
    <div className="flex w-full flex-col gap-[12px] rounded-lg p-[18px] outline-1 -outline-offset-1 outline-line-strong">
      <div className="flex w-full items-center gap-[8px]">
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[14px] font-semibold text-ink">Company brief</span>
          <span className="text-[12.5px] text-muted">The paragraph every helper reads first, and the first page new staff see.</span>
        </div>
        {editing ? (
          <>
            <PenButton h={30} fs={13} onClick={() => setEditing(false)}>Cancel</PenButton>
            <PenButton
              variant="primary"
              h={30}
              fs={13}
              icon={Check}
              onClick={() =>
                save.mutate(
                  { name: 'BRIEF.md', input: { content: draft, title: 'Company brief' } },
                  { onSuccess: () => { setEditing(false); notify('Brief saved — helpers use it from the next run') }, onError: () => notify("Couldn't save the brief") },
                )
              }
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </PenButton>
          </>
        ) : (
          <PenButton
            variant="quiet"
            h={30}
            fs={13}
            icon={Pencil}
            disabled={loading}
            onClick={() => {
              setDraft(detail?.content ?? '')
              setEditing(true)
            }}
          >
            Edit
          </PenButton>
        )}
      </div>
      {editing ? (
        <textarea
          autoFocus
          aria-label="Edit company brief"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          className="w-full resize-y rounded-md bg-surface px-[14px] py-[12px] font-mono text-[12.5px] leading-[1.6] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-ink"
        />
      ) : (
        <div className="w-full rounded-md bg-soft px-[14px] py-[12px] outline-1 -outline-offset-1 outline-line">
          <p className="m-0 font-mono text-[12.5px] leading-[1.6] whitespace-pre-wrap text-ink-2">
            {detail?.content?.trim() || (loading ? '…' : 'No brief yet — press Edit to write one.')}
          </p>
        </div>
      )}
      {file && (
        <div className="flex items-center gap-[6px]">
          <History size={12} aria-hidden className="text-muted" />
          <span className="text-[11.5px] text-faint">
            Edited by {who(file.updatedBy)} · {longAgo(file.updatedAt)} · v{file.version}
          </span>
        </div>
      )}
    </div>
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

/** Split a handbook file's markdown into an intro and `## ` sections. */
function sectionsOf(content: string): { intro: string; sections: { h: string; body: string }[] } {
  const parts = content.split(/^##\s+/m)
  const intro = parts[0].trim()
  const sections = parts.slice(1).map((p) => {
    const [h, ...rest] = p.split('\n')
    return { h: h.trim(), body: rest.join('\n').trim().replace(/^- /gm, '•  ') }
  })
  return { intro, sections }
}

/** pen bb67G · a handbook file opened in the right-side drawer. */
function HandbookFileDrawer({ name, onClose }: { name: string; onClose: () => void }) {
  const { data: file, isLoading, isError } = useHandbookFile(name)
  if (!file) {
    return (
      <Drawer title={name} subtitle={isError ? "Couldn't load this file" : isLoading ? 'Loading…' : 'Not found'} onClose={onClose} bodyClass="gap-[16px] px-[24px] py-[20px]">
        {isLoading && <div className="h-[120px] animate-pulse rounded-md bg-soft" />}
      </Drawer>
    )
  }
  return <FileDrawerBody key={`${file.name}:${file.version}`} file={file} onClose={onClose} />
}

function FileDrawerBody({ file, onClose }: { file: HandbookFileDetail; onClose: () => void }) {
  const who = useWho()
  const { data: helpers = [] } = useHelpers()
  const save = useSaveHandbookFile()
  const resolve = useResolveHandbookSuggestion()
  const locked = file.visibility === 'members'
  const scope = locked ? 'Members & helpers only' : 'Everyone can read'
  const ScopeIcon = locked ? Lock : Globe
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(file.content)
  const { intro, sections } = sectionsOf(file.content)
  const suggestion = file.suggestions[0] ?? null
  const suggester = suggestion?.helperId ? helpers.find((h) => h.id === suggestion.helperId) : undefined

  function settle(accept: boolean) {
    if (!suggestion) return
    resolve.mutate(
      { id: suggestion.id, accept },
      {
        onSuccess: () =>
          notify(accept ? (suggestion.proposedContent != null ? 'Suggestion accepted — handbook updated' : 'Suggestion accepted — edit the file to apply it') : 'Suggestion dismissed'),
        onError: () => notify("Couldn't update the suggestion"),
      },
    )
    if (accept && suggestion.proposedContent == null) {
      setDraft(file.content)
      setEditing(true)
    }
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
                setDraft(file.content)
                setEditing(false)
              }}
            >
              Cancel
            </PenButton>
            <PenButton
              variant="primary"
              h={30}
              fs={13}
              icon={Check}
              onClick={() =>
                save.mutate(
                  { name: file.name, input: { content: draft } },
                  { onSuccess: () => notify(`Saved ${file.name}`), onError: () => notify("Couldn't save changes") },
                )
              }
            >
              {save.isPending ? 'Saving…' : 'Save changes'}
            </PenButton>
          </>
        ) : (
          <>
            <History size={12} aria-hidden className="text-muted" />
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">
              Edited by {who(file.updatedBy)} · {longAgo(file.updatedAt)} · v{file.version}
            </span>
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
          className="min-h-[55vh] w-full flex-1 resize-none rounded-md bg-surface p-[14px] font-mono text-[13px] leading-[1.6] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-ink"
        />
      ) : (
        <>
          <div className="flex w-full items-center gap-[8px]">
            <span className="inline-flex h-[26px] items-center gap-[6px] rounded-btn px-[10px] outline-1 -outline-offset-1 outline-line-strong">
              <ScopeIcon size={12} aria-hidden className="text-ink-2" />
              <span className="text-[12px] text-ink-2">{scope}</span>
            </span>
          </div>

          {intro && <p className="m-0 text-[13.5px] leading-[1.6] whitespace-pre-wrap text-muted">{intro}</p>}

          {sections.map((s, i) => (
            <div key={`${s.h}-${i}`} className="flex w-full flex-col gap-[6px]">
              <h2 className={H}>{s.h}</h2>
              <p className={P}>{s.body}</p>
            </div>
          ))}

          {suggestion && (
            <div className="flex w-full flex-col gap-[10px] rounded-lg bg-warn-tint p-[14px] outline-1 -outline-offset-1 outline-warn-line">
              <div className="flex w-full items-center gap-[8px]">
                <Mascot helper area={suggester?.area ?? 'brand'} size={24} radius={7} />
                <span className="text-[12.5px] font-semibold text-ink">{suggestion.author} suggests an edit</span>
              </div>
              <p className="m-0 text-[12.5px] leading-[1.5] text-ink-2">{suggestion.text}</p>
              <div className="flex gap-[6px]">
                <PenButton variant="primary" h={28} fs={12.5} px={12} onClick={() => settle(true)}>Accept</PenButton>
                <PenButton h={28} fs={12.5} px={12} onClick={() => settle(false)}>Dismiss</PenButton>
              </div>
            </div>
          )}

          {file.versions.length > 0 && (
            <div className="flex w-full flex-col gap-[8px]">
              <SideTitle>HISTORY</SideTitle>
              {file.versions.slice(0, 5).map((h) => (
                <SideRow key={`${h.version}-${h.createdAt}`} lead={null} label={`v${h.version} · ${h.note && h.note !== 'Created' ? h.note.toLowerCase() : who(h.updatedBy)}`} right={shortAgo(h.createdAt)} />
              ))}
            </div>
          )}
        </>
      )}
    </Drawer>
  )
}

/** "New file" — name + content, saved with PUT /v1/handbook/{file}. */
function NewFileDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const save = useSaveHandbookFile()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [members, setMembers] = useState(false)
  const [content, setContent] = useState('')
  const fileName = name.trim() ? `${name.trim().replace(/\.md$/i, '').toUpperCase().replace(/\s+/g, '-')}.md` : ''
  return (
    <Drawer
      title="New handbook file"
      subtitle={fileName || 'Name it, write it, save it'}
      onClose={onClose}
      bodyClass="gap-[12px] px-[24px] py-[20px]"
      footer={
        <>
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">Every helper reads it from the next run</span>
          <PenButton h={30} fs={13} onClick={onClose}>Cancel</PenButton>
          <PenButton
            variant="primary"
            h={30}
            fs={13}
            icon={Check}
            disabled={!fileName || save.isPending}
            onClick={() =>
              save.mutate(
                { name: fileName, input: { content, title: name.trim(), description, visibility: members ? 'members' : 'everyone' } },
                { onSuccess: (f) => { notify(`Created ${f.name}`); onCreated(f.name) }, onError: () => notify("Couldn't create the file — use letters, numbers and dashes") },
              )
            }
          >
            Create file
          </PenButton>
        </>
      }
    >
      <input aria-label="File name" placeholder="File name, e.g. Pricing" value={name} onChange={(e) => setName(e.target.value)} className="h-[32px] rounded-md bg-surface px-[10px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-ink" />
      <input aria-label="Description" placeholder="One line on what's inside" value={description} onChange={(e) => setDescription(e.target.value)} className="h-[32px] rounded-md bg-surface px-[10px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-ink" />
      <label className="flex items-center gap-[8px] text-[12.5px] text-ink-2">
        <input type="checkbox" checked={members} onChange={(e) => setMembers(e.target.checked)} /> Members &amp; helpers only
      </label>
      <textarea aria-label="File content" placeholder={'Intro line\n\n## A section\n\n- A rule'} value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[45vh] w-full resize-none rounded-md bg-surface p-[14px] font-mono text-[13px] leading-[1.6] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-ink" />
      <span className="text-[11.5px] text-faint">Markdown — use ## for sections and - for rules.</span>
    </Drawer>
  )
}
