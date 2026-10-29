import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { BookOpen, Brain, FileText, Folder, Link2, PenSquare, Search, Share2 } from 'lucide-react'
import { IconButton } from '../../../ui/ds/Button'
import { Mascot } from '../../../ui/ds/Mascot'
import { MoreMenu, copyText } from '../../../ui/ds/ItemMenu'
import { notify } from '../../../ui/ds/Toaster'
import { useHandbook, useHandbookFile, useHelpers, useMembers, useSuggestHandbookEdit } from '../../../app/queries'
import { useSession } from '../../../app/session'
import { docLink, headingOf, longAgo, whoLabel } from './docsUtil'
import type { DocGroup } from './docsUtil'

const RECENT_MS = 2 * 24 * 60 * 60 * 1000

/** Docs · Handbook — the company handbook, read-only for staff, with "Suggest a change". */
export function HandbookView({
  onOpenKnowledge,
  onAsk,
  areas,
}: {
  onOpenKnowledge: () => void
  onAsk: (question: string) => void
  areas: DocGroup[]
}) {
  const navigate = useNavigate()
  const { data: index, isLoading, isError } = useHandbook()
  const files = (index?.files ?? []).filter((f) => !f.brief)
  const [picked, setPicked] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const active = picked ?? files.find((f) => f.name === 'POLICIES.md')?.name ?? files[0]?.name ?? null
  const { data: file } = useHandbookFile(active)
  const { data: helpers = [] } = useHelpers()
  const { data: members = [] } = useMembers()
  const userId = useSession((s) => s.user?.id)
  const who = (by: string) => whoLabel(by, { userId, members, helpers })
  const [suggesting, setSuggesting] = useState(false)
  const [draft, setDraft] = useState('')
  const suggest = useSuggestHandbookEdit()
  const [now] = useState(() => Date.now())

  const shown = query ? files.filter((f) => `${f.name} ${f.title}`.toLowerCase().includes(query.toLowerCase())) : files
  const whatsNew = [...files].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 3)

  function sendSuggestion() {
    if (!file || !draft.trim()) return
    suggest.mutate(
      { file: file.name, text: draft.trim() },
      {
        onSuccess: () => {
          notify('Suggestion sent — an owner reviews it in Control panel › Handbook')
          setDraft('')
          setSuggesting(false)
        },
        onError: () => notify("Couldn't send the suggestion"),
      },
    )
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex w-[240px] shrink-0 flex-col gap-[6px] overflow-y-auto border-r border-line px-[8px] py-[10px]">
        <label className="flex items-center gap-[6px] rounded-base bg-soft px-[8px] py-[5px] outline-1 -outline-offset-1 outline-line-strong">
          <Search size={12} aria-hidden className="text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a doc…"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
          />
        </label>

        <div className="flex flex-col gap-px">
          <div className="flex items-center gap-[6px] px-[8px] py-[4px]">
            <BookOpen size={13} className="text-muted" aria-hidden />
            <span className="flex-1 text-[12.5px] font-medium text-ink">Company handbook</span>
            <span className="text-[11px] text-muted">{files.length}</span>
          </div>
          {isLoading && [1, 2, 3].map((i) => <div key={i} className="mx-[8px] my-[2px] h-[22px] animate-pulse rounded-sm bg-soft" />)}
          {isError && <span className="px-[8px] text-[12px] text-bad">Couldn't load the handbook</span>}
          {shown.map((f) => {
            const badge = f.openSuggestions > 0 ? `${f.openSuggestions} suggested` : f.updatedAt && now - new Date(f.updatedAt).getTime() < RECENT_MS ? 'Updated' : null
            return (
              <button
                key={f.name}
                type="button"
                aria-current={f.name === active ? 'true' : undefined}
                onClick={() => {
                  setPicked(f.name)
                  setSuggesting(false)
                }}
                className={`flex w-full items-center gap-[6px] rounded-sm px-[8px] py-[4px] text-left transition-colors ${f.name === active ? 'bg-hover' : 'hover:bg-hover'}`}
              >
                <FileText size={12} className="shrink-0 text-faint" aria-hidden />
                <span className={`min-w-0 flex-1 truncate text-[12.5px] ${f.name === active ? 'font-medium text-ink' : 'text-ink-2'}`}>{f.name}</span>
                {badge && (
                  <span
                    className="shrink-0 rounded-pill px-[5px] py-[0.5px] text-[10.5px] font-medium"
                    style={{
                      background: badge === 'Updated' ? 'var(--color-info-tint)' : 'var(--color-ok-tint)',
                      color: badge === 'Updated' ? 'var(--color-info)' : 'var(--color-ok)',
                    }}
                  >
                    {badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {areas.length > 0 && (
          <div className="mt-[8px] flex flex-col gap-px">
            <div className="px-[10px] pb-[4px]">
              <span className="text-[10.5px] font-medium tracking-[0.8px] text-faint">AREAS</span>
            </div>
            {areas.map((area) => (
              <div key={area.id} className="flex items-center gap-[8px] rounded-sm px-[8px] py-[3px] transition-colors hover:bg-hover">
                <Folder size={13} className="shrink-0 text-muted" aria-hidden />
                <span className="flex-1 text-[12.5px] text-ink-2">{area.label}</span>
                <span className="text-[11px] text-muted">{area.docs.filter((d) => d.doc).length}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center gap-[6px] px-[4px] py-[6px]">
          <Brain size={12} className="text-faint" aria-hidden />
          <span className="text-[11.5px] text-muted">Agent memory is separate</span>
          <button type="button" onClick={onOpenKnowledge} className="ml-auto text-[11.5px] whitespace-nowrap text-link hover:underline">
            Open Knowledge
          </button>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {file && (
          <>
            <div className="flex h-[44px] shrink-0 items-center gap-[8px] border-b border-line px-[16px]">
              <span className="text-[12px] text-muted">
                Read-only · updated {longAgo(file.updatedAt)} by {who(file.updatedBy)}
              </span>
              <div className="ml-auto flex items-center gap-[4px]">
                <button
                  type="button"
                  onClick={() => setSuggesting((s) => !s)}
                  className="flex h-[26px] items-center gap-[4px] rounded-btn bg-soft px-[10px] text-[12px] text-muted outline-1 -outline-offset-1 outline-line-strong transition-colors hover:text-ink"
                >
                  Suggest a change
                </button>
                <span className="ml-[8px] text-[12px] text-muted">Saved · v{file.version}</span>
                <IconButton icon={Share2} size={14} aria-label="Share" onClick={() => { copyText(docLink('handbook')); notify('Link copied') }} />
                <IconButton icon={Link2} size={14} aria-label="Link" onClick={() => { copyText(docLink('handbook')); notify('Link copied') }} />
                <MoreMenu
                  label="More"
                  size={28}
                  items={[{ label: 'Edit in Control panel', icon: PenSquare, onSelect: () => void navigate({ to: '/control-panel/$section', params: { section: 'handbook' } }) }]}
                />
              </div>
            </div>

            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="min-h-0 flex-1 overflow-y-auto px-[48px] py-[36px]">
                {suggesting && (
                  <div className="mb-[20px] flex flex-col gap-[8px] rounded-lg bg-soft p-[12px] outline-1 -outline-offset-1 outline-line-strong">
                    <span className="text-[12.5px] font-medium text-ink">What should change in {file.name}?</span>
                    <textarea
                      autoFocus
                      aria-label="Suggested change"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={3}
                      className="resize-none rounded-base bg-surface px-[10px] py-[7px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-ink"
                    />
                    <div className="flex gap-[6px]">
                      <button type="button" disabled={!draft.trim() || suggest.isPending} onClick={sendSuggestion} className="h-[28px] rounded-btn bg-primary px-[12px] text-[12.5px] font-medium text-primary-ink hover:bg-primary-hover disabled:opacity-50">
                        {suggest.isPending ? 'Sending…' : 'Send suggestion'}
                      </button>
                      <button type="button" onClick={() => setSuggesting(false)} className="h-[28px] rounded-btn bg-surface px-[12px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                <h1 className="mb-[20px] font-display text-[28px] font-semibold tracking-[-0.6px] text-ink">{file.title}</h1>
                {file.content.split('\n').map((line, i) => {
                  const h = headingOf(line)
                  if (h) return <h2 key={i} className="mt-[20px] mb-[8px] text-[17px] font-semibold text-ink">{h.text}</h2>
                  if (line.startsWith('- ') || line.startsWith('* ')) return <li key={i} className="mb-[4px] ml-[16px] text-[13.5px] text-ink-2">{line.slice(2)}</li>
                  if (line.trim() === '') return <div key={i} className="h-[6px]" />
                  return <p key={i} className="m-0 mb-[4px] text-[13.5px] text-muted">{line}</p>
                })}
              </div>

              <aside className="flex w-[220px] shrink-0 flex-col gap-[12px] overflow-y-auto border-l border-line px-[14px] py-[16px]">
                <p className="m-0 text-[10.5px] font-medium tracking-[0.5px] text-faint">WHAT'S NEW</p>
                <div className="flex flex-col gap-[4px]">
                  {whatsNew.map((f) => (
                    <button key={f.name} type="button" onClick={() => setPicked(f.name)} className="flex items-start gap-[8px] text-left">
                      <FileText size={12} className="mt-[2px] shrink-0 text-faint" aria-hidden />
                      <div className="flex flex-col gap-[2px]">
                        <span className="text-[12px] font-medium text-ink-2">{f.name}</span>
                        <span className="text-[11px] text-faint">
                          v{f.version} by {who(f.updatedBy)} · {longAgo(f.updatedAt)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="h-px w-full bg-line" />

                <div className="flex flex-col gap-[4px]">
                  <p className="m-0 text-[10.5px] font-medium tracking-[0.5px] text-faint">ASK CHIEF</p>
                  <div className="rounded-base bg-soft px-[8px] py-[8px] outline-1 -outline-offset-1 outline-line-strong">
                    <div className="mb-[4px] flex items-center gap-[4px]">
                      <Mascot size={14} radius={3} area="brand" />
                      <span className="text-[11.5px] font-medium text-ink">Not sure of a rule?</span>
                    </div>
                    <p className="m-0 text-[11.5px] text-muted">It answers from this handbook and shows the line it used.</p>
                    <button type="button" onClick={() => onAsk(`What does ${file.name} say?`)} className="mt-[6px] text-left text-[11.5px] text-link hover:underline">
                      What does {file.name} say?
                    </button>
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
