/**
 * Command menu (⌘/Ctrl-K) — pen RGVME (open) · JdRi5 (typing, with preview) ·
 * aNecq (Ask Chief fallback) · dcWIN (action step: Hire helper).
 * Mounted once in the Shell; `SearchTrigger` (d0lBaO) is the sidebar entry point.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useNavigate } from '@tanstack/react-router'
import { useUIStore, MODE_HOME } from '../../app/store'
import { useAreas, useCreateHelper, useHelpers, useStartChat } from '../../app/queries'
import { useSession as useAuthSession } from '../../app/session'
import { useCompanyLook } from '../../ui/ds/looks'
import { notify } from '../../ui/ds/Toaster'
import {
  Archive,
  Bell,
  Building2,
  CalendarSync,
  ChevronLeft,
  Cpu,
  Crosshair,
  FileText,
  Inbox,
  Lock,
  MessageCircle,
  Plus,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  Target,
  UserPlus,
  Users,
  Workflow,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { HIRE_TEMPLATES, TABS } from './data'
import type { HireOption, Item, Preview, TabId } from './data'
import { flatten, search } from './search'
import { useCommandCorpus } from './corpus'
import type { Section } from './search'
import { EmptyState } from '../../ui/ds/EmptyState'

export interface CommandMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const ICONS: Record<string, LucideIcon> = {
  archive: Archive,
  bell: Bell,
  'building-2': Building2,
  'calendar-sync': CalendarSync,
  cpu: Cpu,
  crosshair: Crosshair,
  'file-text': FileText,
  inbox: Inbox,
  lock: Lock,
  'message-circle': MessageCircle,
  plus: Plus,
  settings: Settings,
  sparkles: Sparkles,
  'square-pen': SquarePen,
  target: Target,
  'user-plus': UserPlus,
  users: Users,
  workflow: Workflow,
}

/** Open the menu from anywhere (the Shell listens for ⌘K on window). */
export function openCommandMenu() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }))
}

// ── Primitives ───────────────────────────────────────────────────────────────

/** pen `Kbd` (sDbNQ): surface · r4 · 1px line-strong, 2px bottom · mono 10.5. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-xs bg-surface px-[5px] py-px font-mono text-[10.5px] leading-[1.3] whitespace-nowrap text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong),inset_0_-1px_0_1px_var(--color-line-strong)]">
      {children}
    </span>
  )
}

function Heading({ label }: { label: string }) {
  return (
    <div className="px-[10px] pt-[10px] pb-[4px] text-[10.5px] leading-[1.21] font-semibold tracking-[1px] text-faint">
      {label}
    </div>
  )
}

function Lead({ icon, helper }: { icon?: string; helper?: Item['helper'] }) {
  if (helper) return <Mascot size={24} radius={7} area={helper} helper />
  const Icon = (icon && ICONS[icon]) || FileText
  return (
    <span className="flex size-[26px] shrink-0 items-center justify-center rounded-btn bg-soft outline-1 -outline-offset-1 outline-line">
      <Icon size={14} aria-hidden className="text-ink-2" />
    </span>
  )
}

/** pen `Command/Item` (w4Zgjz): h-38 · r8 · gap 10 · px 10. */
function Row({
  item,
  active,
  dim = false,
  onHover,
  onRun,
}: {
  item: Pick<Item, 'label' | 'meta' | 'icon' | 'helper' | 'hint'>
  active: boolean
  dim?: boolean
  onHover: () => void
  onRun: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      data-active={active || undefined}
      onMouseMove={onHover}
      onClick={onRun}
      className={`flex h-[38px] w-full shrink-0 items-center gap-[10px] rounded-base px-[10px] text-left ${
        active ? 'bg-hover' : ''
      } ${dim ? 'opacity-50' : ''}`}
    >
      <Lead icon={item.icon} helper={item.helper} />
      <span className="shrink-0 text-[13.5px] whitespace-nowrap text-ink">{item.label}</span>
      {item.meta && <span className="min-w-0 truncate text-[12.5px] text-faint">{item.meta}</span>}
      <span className="h-px min-w-0 flex-1" />
      {item.hint && <span className="shrink-0 font-mono text-[11px] whitespace-pre text-faint">{item.hint}</span>}
      {active && <Kbd>↵</Kbd>}
    </button>
  )
}

/** Active company chip (name + logo tile from the signed-in session). */
function Scope() {
  const company = useAuthSession((s) => s.company)
  const name = company?.name ?? 'Workspace'
  const look = useCompanyLook({ id: company?.id ?? '', name, initial: name.charAt(0).toUpperCase(), color: '#78716C' })
  return (
    <span className="flex h-[24px] shrink-0 items-center gap-[6px] rounded-sm bg-soft pr-[8px] pl-[4px] outline-1 -outline-offset-1 outline-line">
      {look.image ? (
        <img src={look.image} alt="" className="size-[16px] rounded-xs object-cover" />
      ) : (
        <span
          className="flex size-[16px] items-center justify-center rounded-xs text-[9.5px] font-bold text-white"
          style={{ background: look.color }}
        >
          {look.initial}
        </span>
      )}
      <span className="text-[12px] whitespace-nowrap text-ink-2">{name}</span>
    </span>
  )
}

function FooterHint({ k, label }: { k: string; label: string }) {
  return (
    <span className="flex items-center gap-[6px]">
      <Kbd>{k}</Kbd>
      <span className="text-[12px] whitespace-nowrap text-muted">{label}</span>
    </span>
  )
}

function Footer({ step = false }: { step?: boolean }) {
  return (
    <div className="flex w-full shrink-0 items-center gap-[14px] bg-soft px-[14px] py-[9px] shadow-[inset_0_1px_0_var(--color-line)]">
      {step ? (
        <>
          <FooterHint k="⌫" label="Back" />
          <FooterHint k="↵" label="Hire & set a loop" />
          <FooterHint k="⌘↵" label="Ask Chief who to hire" />
        </>
      ) : (
        <>
          <FooterHint k="↑↓" label="Navigate" />
          <FooterHint k="↵" label="Open" />
          <FooterHint k="⌘↵" label="Ask Chief" />
        </>
      )}
      <span className="h-px flex-1" />
      {!step && (
        <span className="flex items-center gap-[10px]">
          {(
            [
              ['>', 'actions'],
              ['@', 'helpers'],
              ['#', 'channels'],
            ] as const
          ).map(([k, l]) => (
            <span key={k} className="flex items-center gap-[4px]">
              <span className="font-mono text-[12px] font-semibold text-ink-2">{k}</span>
              <span className="text-[12px] text-muted">{l}</span>
            </span>
          ))}
        </span>
      )}
    </div>
  )
}

const DOT: Record<Preview['list'][number]['status'], string> = {
  done: 'bg-ok',
  running: 'bg-info',
  failed: 'bg-bad',
}

/** Right-hand preview (QnYZR): 280 · soft · left rule · p18 · gap 14. */
function PreviewPane({ item }: { item: Item }) {
  const p = item.preview
  const Icon = ICONS[p?.icon ?? item.icon ?? ''] ?? FileText
  return (
    <aside className="flex w-[280px] shrink-0 flex-col gap-[14px] bg-soft p-[18px] shadow-[inset_1px_0_0_var(--color-line)]">
      <div className="flex w-full items-center gap-[10px]">
        {item.helper && !p ? (
          <Mascot size={36} radius={9} area={item.helper} helper />
        ) : (
          <span className="flex size-[36px] shrink-0 items-center justify-center rounded-[9px] bg-surface outline-1 -outline-offset-1 outline-line-strong">
            <Icon size={18} aria-hidden className="text-ink" />
          </span>
        )}
        <span className="flex min-w-0 flex-col gap-[2px]">
          <span className="font-display truncate text-[16px] font-semibold text-ink">{p?.title ?? item.label}</span>
          <span className="truncate text-[12px] text-muted">{p?.sub ?? item.meta}</span>
        </span>
      </div>
      {p && (
        <>
          <div className="flex w-full gap-[16px]">
            {p.stats.map((s) => (
              <span key={s.label} className="flex flex-col gap-px">
                <span className="font-mono text-[18px] text-ink">{s.value}</span>
                <span className="text-[11.5px] text-muted">{s.label}</span>
              </span>
            ))}
          </div>
          <div className="h-px w-full bg-line-strong" />
          <span className="text-[10.5px] font-semibold tracking-[1px] text-faint">{p.listLabel}</span>
          {p.list.map((r) => (
            <div key={r.name} className="flex w-full items-center gap-[8px]">
              <span
                className={`flex size-[14px] shrink-0 items-center justify-center rounded-[7px] ${
                  r.status === 'running' ? 'bg-info-tint' : ''
                }`}
              >
                <span className={`size-[8px] rounded-pill ${DOT[r.status]}`} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{r.name}</span>
              <span className="font-mono text-[11px] text-faint">{r.time}</span>
            </div>
          ))}
        </>
      )}
      <span className="flex-1" />
      <div className="flex w-full items-center gap-[6px]">
        <Kbd>↵</Kbd>
        <span className="text-[12px] text-muted">Open</span>
        <Kbd>⌘ ↵</Kbd>
        <span className="truncate text-[12px] text-muted">{p?.askLabel ?? 'Ask Chief about this'}</span>
      </div>
    </aside>
  )
}

// ── Palette ──────────────────────────────────────────────────────────────────

type Step = { kind: 'search' } | { kind: 'hire' }

function Palette({ onClose, initial = '' }: { onClose: () => void; initial?: string }) {
  const navigate = useNavigate()
  const setMode = useUIStore((s) => s.setMode)
  const hireFirst = initial === ':hire'
  const [query, setQuery] = useState(hireFirst ? '' : initial)
  const [tab, setTab] = useState<TabId>('all')
  const [step, setStep] = useState<Step>({ kind: hireFirst ? 'hire' : 'search' })
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const corpus = useCommandCorpus()
  const result = useMemo(() => search(query, tab, corpus), [query, tab, corpus])
  const { data: helpers = [] } = useHelpers()
  const { data: areas = [] } = useAreas()
  const areaId = useUIStore((s) => s.areaId)
  const createHelper = useCreateHelper()
  const startChat = useStartChat()
  const hireRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const f = (o: HireOption) => !q || `${o.label} ${o.meta}`.toLowerCase().includes(q)
    const hiredNames = new Set(helpers.map((h) => h.name.toLowerCase()))
    const hired: HireOption[] = helpers
      .filter((h) => !h.isChief)
      .map((h) => ({ id: `hh-${h.id}`, label: h.name, meta: h.role ?? h.area, helper: h.area, hired: true }))
    return {
      ready: HIRE_TEMPLATES.filter((o) => !o.template || !hiredNames.has(o.template.name.toLowerCase())).filter(f),
      hired: hired.filter(f),
    }
  }, [query, helpers])

  // "Ask <helper> in #area instead": the area in view (else the default area) and
  // its first non-Chief helper — the question starts a chat there and is sent.
  const askArea = areas.find((a) => a.id === areaId) ?? areas.find((a) => a.isDefault) ?? areas[0]
  const askHelper = helpers.find((h) => !h.isChief && h.status !== 'paused') ?? helpers.find((h) => h.isChief)

  const flat: Item[] =
    step.kind === 'hire'
      ? []
      : result.mode === 'ask'
        ? []
        : flatten(result.sections)
  const count =
    step.kind === 'hire' ? hireRows.ready.length : result.mode === 'ask' ? 2 + result.closest.length : flat.length

  useEffect(() => setActive(0), [query, tab, step.kind])
  useEffect(() => {
    listRef.current?.querySelector('[data-active]')?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  function askChief(text: string, threadId?: string) {
    onClose()
    if (threadId) window.dispatchEvent(new CustomEvent('omilo:chief-thread', { detail: threadId }))
    else window.dispatchEvent(new CustomEvent('omilo:chief-ask', { detail: text }))
  }

  function askInArea(question: string) {
    onClose()
    if (!askArea) {
      void navigate({ to: '/chat' })
      return
    }
    const text = askHelper && !askHelper.isChief ? `@${askHelper.name} ${question}` : question
    startChat.mutate(
      { input: { channelId: askArea.id, title: question.slice(0, 60) }, text },
      {
        onSuccess: (session) => void navigate({ to: '/chat/$sessionId', params: { sessionId: session.id } }),
        onError: () => notify('Couldn’t start the chat — try again'),
      },
    )
  }

  function run(item: Item) {
    switch (item.run.kind) {
      case 'go':
        onClose()
        void navigate({ to: item.run.to })
        return
      case 'mode': {
        // Mode is persisted client state, not a route — flip it, then land on
        // that mode's home.
        onClose()
        const next = useUIStore.getState().mode === 'chat' ? 'office' : 'chat'
        setMode(next)
        void navigate({ to: MODE_HOME[next] })
        return
      }
      case 'chief':
        askChief('', item.run.threadId)
        return
      case 'hire':
        setQuery('')
        setStep({ kind: 'hire' })
        inputRef.current?.focus()
        return
    }
  }

  function runHire(o: HireOption) {
    if (o.hired) return
    if (!o.template) {
      // Custom helper: Chief drafts the job from what was typed.
      const what = query.trim()
      if (what) askChief(`Help me hire a helper: ${what}. Draft the job description and a first loop.`)
      else {
        onClose()
        void navigate({ to: '/team' })
      }
      return
    }
    onClose()
    createHelper.mutate(
      { name: o.template.name, area: o.template.area, role: o.template.role, jobDescription: o.template.jobDescription },
      {
        onSuccess: (h) => {
          notify(`${h.name} joined the team`)
          void navigate({ to: '/team/$helperId', params: { helperId: h.id } } as never)
        },
        onError: () => notify(`Couldn’t hire ${o.label} — try again`),
      },
    )
  }

  function runActive() {
    if (step.kind === 'hire') {
      const o = hireRows.ready[active]
      if (o) runHire(o)
      return
    }
    if (result.mode === 'ask') {
      if (active === 0) askChief(result.question)
      else if (active === 1) askInArea(result.question)
      else run(result.closest[active - 2])
      return
    }
    const item = flat[active]
    if (item) run(item)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (count ? (a + 1) % count : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (count ? (a - 1 + count) % count : 0))
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      askChief(query.trim())
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runActive()
    } else if (e.key === 'Backspace' && step.kind === 'hire' && !query) {
      e.preventDefault()
      setStep({ kind: 'search' })
    }
  }

  const showPreview = step.kind === 'search' && result.mode === 'results' && flat[active] !== undefined
  const width = showPreview ? 840 : 680

  return (
    <Dialog.Content
      aria-label="Command menu"
      aria-describedby={undefined}
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        inputRef.current?.focus()
      }}
      className="fixed top-[96px] left-1/2 z-50 flex max-h-[calc(100vh-120px)] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col overflow-hidden rounded-[16px] bg-surface shadow-[0_24px_64px_#0C0A0933] outline-1 -outline-offset-1 outline-line-strong"
      style={{ width }}
    >
      <Dialog.Title className="sr-only">Command menu</Dialog.Title>

      {/* Input (O445x) */}
      <div className="flex w-full shrink-0 items-center gap-[10px] px-[16px] py-[15px] shadow-[inset_0_-1px_0_var(--color-line)]">
        {step.kind === 'hire' ? (
          <>
            <button
              type="button"
              aria-label="Back"
              onClick={() => setStep({ kind: 'search' })}
              className="flex shrink-0 items-center justify-center text-muted hover:text-ink"
            >
              <ChevronLeft size={18} aria-hidden />
            </button>
            <span className="flex h-[26px] shrink-0 items-center gap-[6px] rounded-sm bg-primary px-[8px]">
              <UserPlus size={13} aria-hidden className="text-white" />
              <span className="text-[12.5px] font-medium text-white">Hire helper</span>
            </span>
          </>
        ) : (
          <Search size={18} aria-hidden className="shrink-0 text-muted" />
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            step.kind === 'hire' ? 'Pick a role, or describe one…' : 'Search pages, chats, helpers — or ask Chief'
          }
          aria-label="Search"
          role="combobox"
          aria-expanded
          className="h-[18px] min-w-0 flex-1 bg-transparent text-[15px] text-ink caret-ink outline-none placeholder:text-faint"
        />
        {step.kind === 'search' && result.mode === 'results' && (
          <span className="shrink-0 text-[12px] text-faint">
            {result.count} result{result.count === 1 ? '' : 's'}
          </span>
        )}
        <Scope />
        <Kbd>esc</Kbd>
      </div>

      {/* Filters (kY7fM) */}
      {step.kind === 'search' && (
        <div role="tablist" className="flex w-full shrink-0 gap-[4px] px-[12px] py-[8px] shadow-[inset_0_-1px_0_var(--color-line)]">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id)
                inputRef.current?.focus()
              }}
              className={`flex h-[26px] items-center rounded-sm px-[10px] text-[12.5px] transition-colors ${
                tab === t.id ? 'bg-hover font-medium text-ink' : 'text-muted hover:bg-hover'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      <div className={`flex min-h-0 w-full ${showPreview ? 'h-[435px] shrink-0' : 'flex-1'}`}>
        <div ref={listRef} role="listbox" className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-[8px] pt-[4px] pb-[8px]">
          {step.kind === 'hire' ? (
            <HireList rows={hireRows} active={active} setActive={setActive} onRun={runHire} />
          ) : result.mode === 'ask' ? (
            <AskList
              question={result.question}
              closest={result.closest}
              active={active}
              setActive={setActive}
              onAsk={() => askChief(result.question)}
              channel={{
                label: `Ask ${askHelper && !askHelper.isChief ? askHelper.name : 'Chief'} in #${(askArea?.name ?? 'general').toLowerCase()} instead`,
                meta: 'Shared with the area',
                helper: askHelper?.area ?? 'brand',
              }}
              onChannel={() => askInArea(result.question)}
              onRun={run}
            />
          ) : (
            <Sections sections={result.sections} flat={flat} active={active} setActive={setActive} onRun={run} />
          )}
        </div>
        {showPreview && <PreviewPane item={flat[active]} />}
      </div>

      <Footer step={step.kind === 'hire'} />
    </Dialog.Content>
  )
}

function Sections({
  sections,
  flat,
  active,
  setActive,
  onRun,
}: {
  sections: Section[]
  flat: Item[]
  active: number
  setActive: (i: number) => void
  onRun: (i: Item) => void
}) {
  if (!flat.length) {
    return (
      <EmptyState size="sm" title="Nothing found" description="Try another word, or ask Chief in any chat." />
    )
  }
  return (
    <>
      {sections.map((s) => (
        <div key={s.heading} className="contents">
          <Heading label={s.heading} />
          {s.items.map((item) => {
            const idx = flat.indexOf(item)
            return (
              <Row
                key={`${s.heading}-${item.id}`}
                item={item}
                active={idx === active}
                onHover={() => setActive(idx)}
                onRun={() => onRun(item)}
              />
            )
          })}
        </div>
      ))}
    </>
  )
}

function AskList({
  question,
  closest,
  active,
  setActive,
  onAsk,
  channel,
  onChannel,
  onRun,
}: {
  question: string
  closest: Item[]
  active: number
  setActive: (i: number) => void
  onAsk: () => void
  channel: { label: string; meta: string; helper: Item['helper'] }
  onChannel: () => void
  onRun: (i: Item) => void
}) {
  return (
    <>
      {/* Ask Chief card (BQCJb) */}
      <button
        type="button"
        role="option"
        aria-selected={active === 0}
        data-active={active === 0 || undefined}
        onMouseMove={() => setActive(0)}
        onClick={onAsk}
        className={`flex w-full items-center gap-[12px] rounded-md p-[12px] text-left ${active === 0 ? 'bg-hover' : ''}`}
      >
        <Mascot size={40} radius={11} area="brand" helper />
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="flex items-center gap-[8px]">
            <span className="text-[13.5px] font-semibold text-ink">Ask Chief</span>
            <span className="flex items-center gap-[3px] text-muted">
              <Lock size={11} aria-hidden />
              <span className="text-[11.5px]">Private</span>
            </span>
          </span>
          <span className="truncate text-[13px] text-ink-2">“{question}”</span>
          <span className="text-[12px] text-muted">
            Answers from your goals, flows, docs and chats. Opens in your Chief DM.
          </span>
        </span>
        {active === 0 && <Kbd>↵</Kbd>}
      </button>
      <Row
        item={{ label: channel.label, meta: channel.meta, helper: channel.helper }}
        active={active === 1}
        onHover={() => setActive(1)}
        onRun={onChannel}
      />
      {closest.length > 0 && <Heading label="CLOSEST MATCHES" />}
      {closest.map((item, i) => (
        <Row
          key={item.id}
          item={{ ...item, hint: undefined }}
          active={active === i + 2}
          onHover={() => setActive(i + 2)}
          onRun={() => onRun(item)}
        />
      ))}
    </>
  )
}

function HireList({
  rows,
  active,
  setActive,
  onRun,
}: {
  rows: { ready: HireOption[]; hired: HireOption[] }
  active: number
  setActive: (i: number) => void
  onRun: (o: HireOption) => void
}) {
  return (
    <>
      {rows.ready.length > 0 && <Heading label="READY TO HIRE" />}
      {rows.ready.map((o, i) => (
        <Row
          key={o.id}
          item={{ label: o.label, meta: o.meta, helper: o.helper, icon: o.icon }}
          active={i === active}
          onHover={() => setActive(i)}
          onRun={() => onRun(o)}
        />
      ))}
      {rows.hired.length > 0 && <Heading label="ALREADY ON THE TEAM" />}
      {rows.hired.map((o) => (
        <Row
          key={o.id}
          item={{ label: o.label, meta: o.meta, helper: o.helper, hint: 'Hired' }}
          active={false}
          dim
          onHover={() => {}}
          onRun={() => onRun(o)}
        />
      ))}
    </>
  )
}

// ── Root ─────────────────────────────────────────────────────────────────────

export function CommandMenu({ open, onOpenChange }: CommandMenuProps) {
  // Deep link for screenshots / sharing: ?cmdk=<query> or ?cmdk=:hire
  const [initial] = useState(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('cmdk'),
  )
  const [forced, setForced] = useState(initial !== null)
  const isOpen = open || forced
  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) setForced(false)
        onOpenChange(o)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#0C0A0947]" />
        {isOpen && (
          <Palette
            initial={forced ? (initial ?? '') : ''}
            onClose={() => {
              setForced(false)
              onOpenChange(false)
            }}
          />
        )}
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** pen d0lBaO "Search or jump to… ⌘K" — the sidebar trigger (h-30 · r7 · line-strong). */
export function SearchTrigger({ className = '' }: { className?: string }) {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return (
    <button
      type="button"
      onClick={openCommandMenu}
      className={`flex h-[30px] w-full items-center gap-[8px] rounded-btn bg-surface pr-[6px] pl-[9px] text-left outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft ${className}`}
    >
      <Search size={14} aria-hidden className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">Search or jump to…</span>
      <Kbd>{mac ? '⌘K' : 'Ctrl K'}</Kbd>
    </button>
  )
}
