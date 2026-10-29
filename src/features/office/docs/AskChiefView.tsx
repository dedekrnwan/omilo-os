import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Brain, FileText } from 'lucide-react'
import type { AskAnswer, Channel, DocSummary, Model } from '../../../core/domain/types'
import { Composer } from '../../../ui/ChatSession/Composer'
import { DEFAULT_MODEL } from '../../../ui/ChatSession/ModelMenu'
import { Mascot } from '../../../ui/ds/Mascot'
import { notify } from '../../../ui/ds/Toaster'
import { useAsk } from '../../../app/queries'
import { areaLabel, shortAgo } from './docsUtil'

const question = (title: string) => `What does “${title}” say?`

/** Ask Chief — answers from company docs (and agent memory while Knowledge is on) via POST /v1/ask. */
export function AskChiefView({
  docs,
  channels,
  initialQuestion,
  onOpenDoc,
}: {
  docs: DocSummary[]
  channels: Channel[]
  /** Asked once on mount (e.g. "Ask Chief about it" from a doc). */
  initialQuestion?: string | null
  onOpenDoc: (id: string) => void
}) {
  const [model, setModel] = useState<Model>(DEFAULT_MODEL)
  const [asked, setAsked] = useState<{ q: string; a: AskAnswer | null; ms: number } | null>(null)
  const [scope, setScope] = useState<string | null>(null)
  const ask = useAsk()

  const recent = [...docs].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  const inScope = scope ? recent.filter((d) => areaLabel(d.area, channels) === scope) : recent
  const suggestions = inScope.slice(0, 3).map((d) => question(d.title))
  const areas = [...new Set(recent.map((d) => areaLabel(d.area, channels)))].slice(0, 2)

  function send(q: string) {
    const text = q.trim()
    if (!text) return
    const started = Date.now()
    setAsked({ q: text, a: null, ms: 0 })
    ask.mutate(text, {
      onSuccess: (a) => {
        // Narrowed to an area: keep citations from docs in that area (and non-doc sources).
        const citations = scope
          ? a.citations.filter((c) => !c.docId || areaLabel(docs.find((d) => d.id === c.docId)?.area, channels) === scope)
          : a.citations
        setAsked({ q: text, a: { ...a, citations }, ms: Date.now() - started })
      },
      onError: () => {
        setAsked(null)
        notify("Couldn't ask Chief — try again")
      },
    })
  }

  const firstAsk = useRef(false)
  useEffect(() => {
    if (initialQuestion && !firstAsk.current) {
      firstAsk.current = true
      send(initialQuestion)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion])

  if (asked) {
    const a = asked.a
    const sources = a ? [...new Set(a.citations.map((c) => c.title))] : []
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-[20px] overflow-y-auto px-[60px] py-[40px]">
          <p className="m-0 text-right text-[13.5px] text-muted">{asked.q}</p>

          <div className="flex gap-[10px]">
            <Mascot size={28} radius={7} area="brand" />
            <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
              <div className="flex items-center gap-[6px]">
                <span className="text-[13px] font-medium text-ink">Chief</span>
                <span className="text-[11.5px] text-faint">
                  {a ? `Chief of Staff · read ${a.citations.length} source${a.citations.length === 1 ? '' : 's'} · ${Math.max(1, Math.round(asked.ms / 1000))}s` : 'Searching your docs…'}
                </span>
              </div>
              {a ? (
                <p className="m-0 text-[13.5px] leading-[1.7] text-ink-2">{a.answer}</p>
              ) : (
                <div className="h-[14px] w-2/3 animate-pulse rounded-sm bg-soft" />
              )}

              {sources.length > 0 && (
                <div className="mt-[2px] flex flex-wrap items-center gap-[6px]">
                  <span className="text-[11.5px] text-faint">Sources</span>
                  {sources.map((s) => (
                    <span key={s} className="flex h-[20px] items-center rounded-pill bg-soft px-[6px] text-[11px] text-muted outline-1 -outline-offset-1 outline-line-strong">
                      {s}
                    </span>
                  ))}
                </div>
              )}

              {a && a.citations.length > 0 && (
                <div className="mt-[8px] flex flex-col gap-[4px]">
                  {a.citations.map((c) => (
                    <button
                      key={`${c.n}-${c.sourceId}`}
                      type="button"
                      disabled={!c.docId}
                      onClick={() => c.docId && onOpenDoc(c.docId)}
                      className="flex items-start gap-[10px] rounded-sm px-[10px] py-[6px] text-left transition-colors hover:bg-hover disabled:hover:bg-transparent"
                    >
                      <span className="w-[14px] shrink-0 text-[11.5px] font-medium text-faint">{c.n}</span>
                      <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                        <span className="text-[13px] font-medium text-ink-2">{c.title}</span>
                        <span className="truncate text-[11.5px] text-faint">{c.heading || c.text.slice(0, 90)}</span>
                      </div>
                      {c.docId && <ArrowUpRight size={13} className="mt-[1px] shrink-0 text-faint" aria-hidden />}
                    </button>
                  ))}
                </div>
              )}

              {a && suggestions.length > 0 && (
                <div className="mt-[8px] flex flex-wrap gap-[4px]">
                  {suggestions
                    .filter((s) => s !== asked.q)
                    .map((s) => (
                      <button key={s} type="button" onClick={() => send(s)} className="h-[28px] rounded-pill bg-soft px-[12px] text-[12px] text-muted outline-1 -outline-offset-1 outline-line-strong transition-colors hover:text-ink">
                        {s}
                      </button>
                    ))}
                </div>
              )}

              {a && !a.memorySearched && (
                <div className="mt-[8px] flex items-center gap-[6px] rounded-base bg-soft px-[10px] py-[6px] outline-1 -outline-offset-1 outline-line-strong">
                  <Brain size={12} className="text-faint" aria-hidden />
                  <span className="text-[11.5px] text-muted">Agent memory wasn't searched — Knowledge is off for this company.</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 px-[20px] pt-[6px] pb-[12px]">
          <Composer sessionId="ask-chief-answer" selectedModel={model} onModelChange={setModel} placeholder="Ask a follow-up…" compact onSend={send} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-[40px]">
        <div className="flex w-full max-w-[520px] flex-col items-center gap-[16px]">
          <Mascot size={40} radius={10} area="brand" />
          <h2 className="m-0 text-[20px] font-semibold tracking-[-0.3px] text-ink">Ask Chief anything in your docs</h2>

          <div className="flex w-full flex-col gap-[4px]">
            <p className="mb-[2px] text-[10.5px] font-medium tracking-[0.8px] text-faint">SUGGESTED QUESTIONS</p>
            {suggestions.length === 0 && <p className="m-0 text-[12.5px] text-faint">Write a doc and Chief will suggest questions about it.</p>}
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="flex w-full items-center rounded-base bg-soft px-[12px] py-[10px] text-left text-[13px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-hover"
              >
                {s}
              </button>
            ))}
          </div>

          {inScope.length > 0 && (
            <div className="flex w-full flex-col gap-[4px]">
              <p className="mb-[2px] text-[10.5px] font-medium tracking-[0.8px] text-faint">MATCHING DOCS</p>
              {inScope.slice(0, 3).map((d) => (
                <button key={d.id} type="button" onClick={() => onOpenDoc(d.id)} className="flex items-center gap-[8px] rounded-base px-[10px] py-[7px] text-left transition-colors hover:bg-hover">
                  <FileText size={13} className="shrink-0 text-muted" aria-hidden />
                  <span className="flex-1 text-[13px] text-ink-2">{d.title}</span>
                  <span className="text-[11.5px] text-faint">{areaLabel(d.area, channels)}</span>
                  <span className="text-[11px] text-faint">{shortAgo(d.updatedAt)}</span>
                </button>
              ))}
            </div>
          )}

          {areas.length > 0 && (
            <div className="flex w-full flex-col gap-[4px]">
              <p className="mb-[2px] text-[10.5px] font-medium tracking-[0.8px] text-faint">NARROW IT</p>
              {areas.map((label) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={scope === label}
                  onClick={() => setScope((s) => (s === label ? null : label))}
                  className={`flex items-center gap-[8px] rounded-base px-[10px] py-[6px] text-left transition-colors hover:bg-hover ${scope === label ? 'bg-hover' : ''}`}
                >
                  <span className="text-[14px] text-muted">⊕</span>
                  <span className="flex-1 text-[13px] text-muted">@{label.toLowerCase()}</span>
                  <span className="text-[12px] text-faint">Only {label} docs</span>
                  <span className="text-[11.5px] text-faint">{scope === label ? 'on' : 'scope'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-[20px] pt-[6px] pb-[12px]">
        <Composer sessionId="ask-chief" selectedModel={model} onModelChange={setModel} placeholder="Ask Chief anything in your docs…" compact onSend={send} autoFocus />
      </div>
    </div>
  )
}
