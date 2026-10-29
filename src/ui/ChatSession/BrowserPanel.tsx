/**
 * BrowserPanel — the 600px agent-browser card beside the chat
 * (pen `Chat · Session + Browser` E5554m).
 *
 * Omilo has no live remote browser stream yet, so the panel shows what was
 * actually recorded: the browser / tool actions helpers took in this chat
 * (GET /v1/sessions/{id}/results → activity), grouped into one tab per site.
 * With nothing recorded it says so instead of showing a mock page.
 */
import { useMemo, useState } from 'react'
import { ArrowUpRight, Globe, Lock, Maximize2, Minimize2, MousePointerClick, X } from 'lucide-react'
import type { SessionActivity } from '../../core/domain/types'
import { useSessionResults } from '../../app/queries'
import { Mascot } from '../ds/Mascot'

const iconBtn = 'flex items-center justify-center text-muted hover:text-ink-2'

export interface BrowserPanelProps {
  /** Chat whose helper browser activity is shown. */
  sessionId: string
  onClose: () => void
}

function hostOf(url?: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

function timeOf(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function BrowserPanel({ sessionId, onClose }: BrowserPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const { data, isLoading, isError } = useSessionResults(sessionId)
  const activity = useMemo(() => data?.activity ?? [], [data])

  // One "tab" per site visited (actions without a URL are grouped as "Actions").
  const tabs = useMemo(() => {
    const map = new Map<string, SessionActivity[]>()
    for (const a of activity) {
      const key = hostOf(a.url) ?? 'Actions'
      map.set(key, [...(map.get(key) ?? []), a])
    }
    return [...map.entries()].map(([host, items]) => ({ host, items }))
  }, [activity])
  const [tab, setTab] = useState<string | null>(null)
  const current = tabs.find((t) => t.host === tab) ?? tabs[tabs.length - 1]
  const lastUrl = current ? [...current.items].reverse().find((a) => a.url)?.url : undefined

  return (
    <aside
      aria-label="Agent browser"
      data-testid="browser-panel"
      className={`ml-[6px] flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg bg-surface outline-1 -outline-offset-1 outline-line-strong ${expanded ? 'w-[900px]' : 'w-[600px]'}`}
    >
      {/* Tabs */}
      <div className="flex w-full items-center gap-[6px] bg-soft px-[10px] py-[8px]">
        {tabs.map((t) => {
          const active = t.host === current?.host
          return (
            <button
              key={t.host}
              type="button"
              aria-pressed={active}
              onClick={() => setTab(t.host)}
              className={`flex min-w-0 items-center gap-[8px] rounded-sm px-[10px] py-[6px] ${
                active ? 'bg-surface outline-1 -outline-offset-1 outline-line' : ''
              }`}
            >
              <Globe size={13} aria-hidden className={active ? 'text-ok' : 'text-muted'} />
              <span className={`truncate text-[12px] ${active ? 'text-ink' : 'text-muted'}`}>{t.host}</span>
            </button>
          )
        })}
        {tabs.length === 0 && <span className="px-[4px] text-[12px] text-muted">Agent browser</span>}
        <span className="h-px flex-1" />
        <button
          type="button"
          aria-label={expanded ? 'Collapse browser' : 'Expand browser'}
          onClick={() => setExpanded((v) => !v)}
          className={iconBtn}
        >
          {expanded ? <Minimize2 size={15} aria-hidden /> : <Maximize2 size={15} aria-hidden />}
        </button>
        <button type="button" aria-label="Close browser panel" onClick={onClose} className={iconBtn}>
          <X size={15} aria-hidden />
        </button>
      </div>

      {/* Nav: the last page the helper was on */}
      <div className="flex w-full items-center gap-[10px] px-[12px] py-[8px] shadow-[inset_0_-1px_0_var(--color-line)]">
        <div className="flex h-[28px] min-w-0 flex-1 items-center gap-[6px] rounded-sm bg-soft px-[10px]">
          <Lock size={12} aria-hidden className="text-muted" />
          <span className="truncate font-mono text-[12px] text-ink-2">{lastUrl ?? 'No page open'}</span>
        </div>
        {lastUrl && (
          <a href={lastUrl} target="_blank" rel="noreferrer" aria-label="Open page in a new tab" className={iconBtn}>
            <ArrowUpRight size={15} aria-hidden />
          </a>
        )}
      </div>

      {/* View: what helpers did */}
      <div className="relative flex min-h-0 w-full flex-1 flex-col gap-[14px] overflow-y-auto bg-app p-[28px]">
        {isLoading ? (
          <p className="m-0 text-[13px] text-muted">Loading activity…</p>
        ) : isError ? (
          <p role="alert" className="m-0 text-[13px] text-bad">Couldn’t load browser activity.</p>
        ) : !current ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-[10px] text-center">
            <Mascot size={40} radius={11} />
            <p className="m-0 text-[13.5px] font-medium text-ink">No browser activity in this chat</p>
            <p className="m-0 max-w-[360px] text-[12.5px] text-muted">
              When a helper opens a page or clicks something to get your task done, each step shows up here.
            </p>
          </div>
        ) : (
          <>
            <div className="flex w-full flex-col gap-[4px]">
              <span className="text-[10.5px] font-semibold tracking-[1px] text-faint">ACTIVITY</span>
              <h2 className="m-0 font-display text-[22px] font-semibold text-ink">{current.host}</h2>
              <p className="m-0 text-[12.5px] text-muted">
                {current.items.length} action{current.items.length === 1 ? '' : 's'} recorded in this chat
              </p>
            </div>
            <div className="flex w-full flex-col rounded-md bg-surface outline-1 -outline-offset-1 outline-line-strong">
              {current.items.map((a, i) => (
                <div
                  key={a.id}
                  className={`flex w-full items-center gap-[12px] px-[16px] py-[12px] ${
                    i < current.items.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''
                  }`}
                >
                  <MousePointerClick size={15} aria-hidden className="shrink-0 text-muted" />
                  <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                    <span className="truncate text-[13px] font-medium text-ink">{a.title ?? a.action}</span>
                    <span className="truncate text-[12px] text-muted">
                      {a.helper} · {a.action}
                      {a.url ? ` · ${a.url}` : ''}
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-faint">{timeOf(a.at)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
