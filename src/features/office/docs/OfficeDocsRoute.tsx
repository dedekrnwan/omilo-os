import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { FileText, Spline, Sparkles, PanelRight, Brain, Plus, CheckCircle2, Circle, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { DocSummary } from '../../../core/domain/types'
import { Button } from '../../../ui/ds/Button'
import { Topbar } from '../../../ui/ds/Frame'
import { notify } from '../../../ui/ds/Toaster'
import {
  useArea,
  useChannels,
  useCompanySettings,
  useCreateDoc,
  useDeleteDoc,
  useLessons,
  useMemoryDocs,
  usePatchDoc,
  useUpdateCompanySettings,
} from '../../../app/queries'
import { useUIStore } from '../../../app/store'
import { GraphView } from './GraphView'
import { KnowledgeView } from './KnowledgeView'
import { AskChiefView } from './AskChiefView'
import { HandbookView } from './HandbookView'
import { NoteDocViewer, NotesSidebar } from './NotesView'
import type { DocActions } from './NotesView'
import { HANDBOOK_ROW_ID, groupDocs } from './docsUtil'

// ── Types ─────────────────────────────────────────────────────────────────────

export type DocsMainView = 'notes' | 'graph' | 'knowledge' | 'ask-chief' | 'handbook'


// ── View toggle (icon-only button group, pen Docs topbar) ─────────────────────

const VIEW_TABS: Array<{ id: Exclude<DocsMainView, 'handbook'>; label: string; icon: LucideIcon }> = [
  { id: 'notes', label: 'Notes', icon: FileText },
  { id: 'graph', label: 'Graph', icon: Spline },
  { id: 'knowledge', label: 'Knowledge', icon: Brain },
  { id: 'ask-chief', label: 'Ask Chief', icon: Sparkles },
]

function ViewToggle({ active, onChange, knowledgeOn }: { active: DocsMainView; onChange: (v: DocsMainView) => void; knowledgeOn: boolean }) {
  const current = active === 'handbook' ? 'notes' : active
  return (
    <div role="tablist" aria-label="Docs views" className="flex items-center gap-[2px] rounded-base bg-soft p-[2px] outline-1 -outline-offset-1 outline-line">
      {VIEW_TABS.map(({ id, label, icon: Icon }) => {
        const on = current === id
        const off = id === 'knowledge' && !knowledgeOn && !on
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={label}
            onClick={() => onChange(id)}
            className={`group relative flex size-[28px] items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ink ${
              on ? 'bg-surface text-ink shadow-[0_1px_2px_#00000014]' : off ? 'text-faint hover:text-muted' : 'text-muted hover:text-ink-2'
            }`}
          >
            <Icon size={15} aria-hidden />
            <span
              role="tooltip"
              className="pointer-events-none absolute top-[calc(100%+6px)] left-1/2 z-50 hidden h-[24px] -translate-x-1/2 items-center rounded-btn bg-primary px-[8px] text-[12px] whitespace-nowrap text-white shadow-[0_4px_10px_#0C0A0929] group-hover:flex"
            >
              {id === 'knowledge' && !knowledgeOn ? 'Knowledge · off' : label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function PanelToggle({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={open}
      title={label}
      onClick={onToggle}
      className={`flex size-[30px] items-center justify-center rounded-sm hover:bg-hover ${open ? 'text-ink' : 'text-muted'}`}
    >
      <PanelRight size={16} aria-hidden />
    </button>
  )
}

// ── Knowledge off ─────────────────────────────────────────────────────────────

function KnowledgeOff({ onTurnOn, busy }: { onTurnOn: () => void; busy: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-0 px-[40px]">
      <div className="flex flex-col items-center gap-[16px] max-w-[420px] text-center">
        <div
          className="flex size-[56px] items-center justify-center rounded-xl bg-soft outline-1 -outline-offset-1 outline-line-strong"
          aria-hidden
        >
          <Brain size={24} className="text-muted" />
          <span className="absolute text-[10px] text-muted font-bold" style={{ marginTop: 20, marginLeft: 10 }}>○</span>
        </div>

        <div className="flex flex-col gap-[8px]">
          <h2 className="text-[22px] font-semibold tracking-[-0.4px] text-ink m-0">
            Knowledge is off
          </h2>
          <p className="text-[13.5px] text-muted m-0 leading-[1.6]">
            When it's on, agents remember lessons, preferences and company facts from your chats and
            decisions, and recall them by meaning. It runs on vector search (pgvector) in your workspace
            database.
          </p>
        </div>

        {/* Benefits */}
        <div className="flex flex-col gap-[6px] w-full text-left">
          {[
            'Agents stop repeating mistakes you already corrected',
            'Ask Chief can search docs and memory by meaning',
            'You review every lesson before agents use it',
          ].map((b) => (
            <div key={b} className="flex items-start gap-[8px]">
              <span className="mt-[3px] text-muted text-[13px]">↗</span>
              <span className="text-[13px] text-muted">{b}</span>
            </div>
          ))}
        </div>

        {/* Setup check */}
        <div className="w-full rounded-base bg-soft px-[14px] py-[12px] outline-1 -outline-offset-1 outline-line-strong">
          <p className="text-[10.5px] font-medium tracking-[0.8px] text-faint mb-[8px] uppercase">
            Setup check
          </p>
          {[
            { label: 'Workspace database', status: 'Ready', ok: true },
            { label: 'pgvector extension', status: 'Installed', ok: true },
            { label: 'Embedding model', status: 'Built in — no AI credits used', ok: null },
          ].map((row) => (
            <div key={row.label} className="flex items-start gap-[8px] py-[4px]">
              {row.ok === true ? (
                <CheckCircle2 size={14} className="text-ok mt-[1px] shrink-0" aria-hidden />
              ) : (
                <Circle size={14} className="text-faint mt-[1px] shrink-0" aria-hidden />
              )}
              <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">{row.label}</span>
              <span className="text-[12px] text-muted whitespace-nowrap">{row.status}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-[8px]">
          <button
            type="button"
            onClick={onTurnOn}
            disabled={busy}
            className="flex h-[32px] disabled:opacity-60 items-center gap-[6px] rounded-btn bg-primary px-[12px] text-[13px] font-medium text-primary-ink hover:bg-primary-hover transition-colors"
          >
            <Zap size={14} aria-hidden /> {busy ? 'Turning on…' : 'Turn on Knowledge'}
          </button>
          <button type="button" onClick={() => notify('Knowledge stores what agents learn and recalls it by meaning (pgvector) before every run. You review each lesson first.')} className="flex h-[32px] items-center gap-[6px] rounded-btn bg-soft px-[12px] text-[13px] text-muted outline-1 -outline-offset-1 outline-line-strong hover:text-ink transition-colors">
            How it works
          </button>
        </div>
        <p className="text-[11.5px] text-faint m-0">
          Only admins can turn this on. Turn it off anytime in Control panel — memories are kept.
        </p>
      </div>
    </div>
  )
}

// ── Topbar meta per view ──────────────────────────────────────────────────────

function topbarMeta(view: DocsMainView, knowledgeOn: boolean, scope: string, docTitle: string | null, docCount: number, memories: number): string {
  switch (view) {
    case 'notes':     return docTitle ? `${scope} / ${docTitle}` : scope
    case 'graph':     return `Graph · ${docCount} doc${docCount === 1 ? '' : 's'}`
    case 'knowledge': return knowledgeOn ? `Knowledge · on · ${memories} memories` : 'Knowledge · off'
    case 'ask-chief': return knowledgeOn ? 'Ask Chief · searches docs and memory' : 'Ask Chief · searches docs only'
    case 'handbook':  return 'Company / Company handbook'
  }
}

// ── Docs board (shared by both modes) ──────────────────────────────────────────

/**
 * Shared Docs board: Notes · Graph · Knowledge · Ask Chief (icon-only toggle);
 * Handbook opens from the Notes list. The panel toggle shows/hides the view's
 * side panel (graph filters, Ask & teach).
 */
function DocsBoard({ areaId, routeDocId }: { areaId: string | null; routeDocId: string | null }) {
  const { data: area } = useArea(areaId ?? '')
  const areaName = areaId ? area?.name ?? null : null
  const { data: channels = [] } = useChannels()

  const { data: allDocs = [], isLoading, isError } = useMemoryDocs()
  const docs = useMemo(() => allDocs.filter((d) => !d.helperId && d.kind !== 'handbook' && d.kind !== 'memory'), [allDocs])
  const { data: lessons = [] } = useLessons()
  const { data: settings } = useCompanySettings()
  const updateSettings = useUpdateCompanySettings()
  const knowledgeOn = (settings?.knowledge as { enabled?: boolean } | undefined)?.enabled === true

  const [view, setView] = useState<DocsMainView>(routeDocId === 'handbook' ? 'handbook' : 'notes')
  const [picked, setPicked] = useState<string | null>(routeDocId && routeDocId !== 'handbook' ? routeDocId : null)
  const [graphFocus, setGraphFocus] = useState<string | null>(null)
  const [askAbout, setAskAbout] = useState<{ q: string; n: number } | null>(null)
  const [pending, setPending] = useState<string[]>([])
  const [panel, setPanel] = useState<Record<string, boolean>>({ graph: true, knowledge: false, notes: true })
  const [teach, setTeach] = useState(0)
  const panelOpen = panel[view] ?? false
  const setPanelOpen = useCallback((open: boolean) => setPanel((p) => ({ ...p, [view]: open })), [view])

  // A /docs/$docId link opens that doc (or the handbook).
  useEffect(() => {
    if (!routeDocId) return
    if (routeDocId === 'handbook') setView('handbook')
    else {
      setPicked(routeDocId)
      setView('notes')
    }
  }, [routeDocId])

  const visibleDocs = docs.filter((d) => !pending.includes(d.id))
  const activeDocId = picked && !pending.includes(picked) ? picked : visibleDocs[0]?.id ?? null
  const activeDoc = docs.find((d) => d.id === activeDocId) ?? null
  const groups = useMemo(() => groupDocs(docs, channels, true), [docs, channels])

  const createDoc = useCreateDoc()
  const patchDoc = usePatchDoc()
  const deleteDoc = useDeleteDoc()
  const deleteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const timers = deleteTimers.current
    return () => {
      for (const [id, t] of timers) {
        clearTimeout(t)
        deleteDoc.mutate(id)
      }
      timers.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openDoc(id: string) {
    if (id === HANDBOOK_ROW_ID) return setView('handbook')
    setPicked(id)
    setView('notes')
  }

  function newDoc(title = 'Untitled doc') {
    createDoc.mutate(
      { title, content: '', kind: 'doc', area: areaId ?? undefined },
      {
        onSuccess: (doc) => {
          notify(title === 'Untitled doc' ? 'Draft created' : `Created “${title}”`)
          openDoc(doc.id)
        },
        onError: () => notify("Couldn't create the doc"),
      },
    )
  }

  const actions: DocActions = {
    rename: (doc, title) =>
      patchDoc.mutate({ id: doc.id, patch: { title } }, { onError: () => notify("Couldn't rename the doc") }),
    pin: (doc, pinned) =>
      patchDoc.mutate(
        { id: doc.id, patch: { pinned } },
        { onSuccess: () => notify(pinned ? `Pinned “${doc.title}”` : `Unpinned “${doc.title}”`), onError: () => notify("Couldn't update the doc") },
      ),
    duplicate: (doc: DocSummary) =>
      createDoc.mutate(
        { title: `${doc.title} (copy)`, content: doc.content, kind: doc.kind, area: doc.area ?? undefined },
        { onSuccess: (copy) => { notify(`Made a copy of “${doc.title}”`); openDoc(copy.id) }, onError: () => notify("Couldn't duplicate the doc") },
      ),
    remove: (doc) => {
      setPending((p) => [...p, doc.id])
      const timer = setTimeout(() => {
        deleteTimers.current.delete(doc.id)
        deleteDoc.mutate(doc.id, {
          onSettled: () => setPending((p) => p.filter((x) => x !== doc.id)),
          onError: () => notify(`Couldn't delete “${doc.title}”`),
        })
      }, 6000)
      deleteTimers.current.set(doc.id, timer)
      notify(`Deleted “${doc.title}”`, () => {
        clearTimeout(timer)
        deleteTimers.current.delete(doc.id)
        setPending((p) => p.filter((x) => x !== doc.id))
      })
    },
  }

  function askChief(q: string) {
    setAskAbout((a) => ({ q, n: (a?.n ?? 0) + 1 }))
    setView('ask-chief')
  }

  function turnOnKnowledge() {
    updateSettings.mutate(
      { knowledge: { enabled: true } },
      { onSuccess: () => notify('Knowledge is on'), onError: () => notify('Only admins can turn Knowledge on') },
    )
  }

  const scope = areaName ?? 'All areas'

  return (
    <>
      <Topbar
        icon={FileText}
        title="Docs"
        meta={topbarMeta(view, knowledgeOn, scope, activeDoc?.title ?? null, docs.length, lessons.length)}
        actions={
          <div className="flex items-center gap-[10px]">
            {view === 'knowledge' && knowledgeOn && (
              <Button
                variant="secondary"
                height={30}
                icon={Plus}
                onClick={() => {
                  setPanel((p) => ({ ...p, knowledge: true }))
                  setTeach((t) => t + 1)
                }}
              >
                Teach something
              </Button>
            )}
            <ViewToggle active={view} onChange={setView} knowledgeOn={knowledgeOn} />
            <PanelToggle
              open={panelOpen}
              onToggle={() => setPanelOpen(!panelOpen)}
              label={view === 'knowledge' ? 'Ask & teach panel' : view === 'graph' ? 'Graph filters' : 'Side panel'}
            />
          </div>
        }
      />

      {view === 'notes' && (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <NotesSidebar
            activeId={activeDocId}
            onSelect={openDoc}
            onShowInGraph={(id) => {
              setGraphFocus(id)
              setView('graph')
            }}
            onAskChief={(title) => askChief(`What does “${title}” say?`)}
            onOpenKnowledge={() => setView('knowledge')}
            onNewDoc={() => newDoc()}
            groups={groups}
            hidden={pending}
            actions={actions}
            isLoading={isLoading}
            isError={isError}
          />
          <NoteDocViewer docId={activeDocId} channels={channels} allDocs={docs} actions={actions} onOpenDoc={openDoc} onCreateDoc={newDoc} />
        </div>
      )}

      {view === 'graph' && (
        <GraphView
          key={graphFocus ?? 'graph'}
          showFilters={panelOpen}
          channels={channels}
          focusDocId={graphFocus}
          onOpenNote={openDoc}
          onAskChief={(about) => askChief(`What does “${about}” say?`)}
        />
      )}

      {view === 'knowledge' &&
        (knowledgeOn ? (
          <KnowledgeView panelOpen={panelOpen} onPanelOpen={setPanelOpen} teachSignal={teach} />
        ) : (
          <KnowledgeOff onTurnOn={turnOnKnowledge} busy={updateSettings.isPending} />
        ))}

      {view === 'ask-chief' && (
        <AskChiefView key={askAbout?.n ?? 0} docs={visibleDocs} channels={channels} initialQuestion={askAbout?.q} onOpenDoc={openDoc} />
      )}

      {view === 'handbook' && <HandbookView onOpenKnowledge={() => setView('knowledge')} onAsk={askChief} areas={groups} />}
    </>
  )
}

// ── Route wrappers (shared board, area from the store) ────────────────────────

/** Office · Docs (also /docs/$docId — opens that doc; /docs/handbook opens the handbook). */
export function OfficeDocsRoute() {
  const areaId = useUIStore((s) => s.areaId)
  const params = useParams({ strict: false }) as { docId?: string }
  return <DocsBoard areaId={areaId} routeDocId={params.docId ?? null} />
}

/** Chat · Docs — same full board (Notes · Graph · Knowledge · Ask Chief · Handbook). */
export function ChatDocsRoute() {
  const areaId = useUIStore((s) => s.areaId)
  const params = useParams({ strict: false }) as { docId?: string }
  return <DocsBoard areaId={areaId} routeDocId={params.docId ?? null} />
}
