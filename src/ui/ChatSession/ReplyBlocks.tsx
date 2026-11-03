/**
 * ReplyBlocks — renders an agent reply's typed blocks (ported from omilo-os
 * "chat components"). A switch over block.type; an unknown/future type falls
 * back to markdown so the backend can add block types without a frontend
 * release.
 *
 * Ships every omilo-os reply block: reasoning · markdown · code · todos ·
 * sources · action_card · confirmation · task · usage_meter · document ·
 * image · streaming · pr_card. The interactive blocks (action_card,
 * confirmation) keep their decision locally (optimistic) and also call the
 * optional `onDecide` prop so it can run real proposal commands; blocks with a
 * Stop affordance (image, streaming) call the optional `onStop`.
 */
import { useState } from 'react'
import {
  ArrowUpRight,
  BookOpen,
  Brain,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FlaskConical,
  GitBranch,
  GitPullRequest,
  Image as ImageIcon,
  Loader2,
  Pencil,
  RotateCcw,
  Send,
  Square,
  SquareCheck,
  Target,
  TriangleAlert,
  User,
  Users,
} from 'lucide-react'
import type { BlockDecision, MessageBlock } from '../../core/domain/types'
import { Button } from '../ds/Button'
import { Markdown } from './Markdown'

/** Called when the owner decides on an interactive block (action_card, confirmation). */
export type BlockDecideFn = (block: MessageBlock, decision: BlockDecision) => void | Promise<void>

/** Called when the owner stops an in-flight block (image generation, streaming). */
export type BlockStopFn = () => void

/** Format a token/word count compactly: 1.2k, 860. */
function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/** Collapsed: a compact "Thought for 12s" pill. Open: a left-accent reasoning body. */
function ReasoningBlock({ block }: { block: MessageBlock }) {
  const [open, setOpen] = useState(false)
  const label =
    block.label || (block.durationS ? `Thought for ${Math.round(block.durationS)}s` : 'Thought')
  const content = block.text ?? ''
  return (
    <div className="flex flex-col gap-[6px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex w-fit items-center gap-[6px] rounded-full px-[8px] py-[3px] text-[12px] text-muted outline-1 -outline-offset-1 outline-line transition-colors hover:bg-soft hover:text-ink"
      >
        <Brain size={13} aria-hidden />
        <span>{label}</span>
        {open ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
      </button>
      {open && content && (
        <div className="border-l-2 border-line-strong pl-[12px]">
          <Markdown text={content} className="flex flex-col gap-[6px] text-[12.5px] leading-[1.5] text-muted" />
        </div>
      )}
    </div>
  )
}

/** Mono code block with a filename/lang header and a copy button. */
function CodeBlock({ block }: { block: MessageBlock }) {
  const [copied, setCopied] = useState(false)
  const code = block.text ?? ''
  const heading = block.name || block.lang || 'code'
  async function copy() {
    try {
      await navigator.clipboard?.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      // clipboard may be unavailable (insecure context) — no-op
    }
  }
  return (
    <div className="overflow-hidden rounded-md outline-1 -outline-offset-1 outline-line-strong">
      <div className="flex items-center gap-[8px] border-b border-line bg-soft px-[12px] py-[6px]">
        <span className="truncate font-mono text-[11.5px] text-muted">{heading}</span>
        <span className="h-px flex-1" />
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-[4px] text-[11.5px] text-muted transition-colors hover:text-ink"
        >
          {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto bg-surface p-[12px] font-mono text-[12px] leading-[1.55] text-ink">
        <code>{code}</code>
      </pre>
    </div>
  )
}

/** Plain markdown segment. */
function MarkdownBlock({ block }: { block: MessageBlock }) {
  return <Markdown text={block.text ?? ''} />
}

/** A plan checklist: label + "N of M done" and one row per step (done/active/pending). */
function TodosBlock({ block }: { block: MessageBlock }) {
  const items = block.items ?? []
  const label = block.title || block.label || 'Plan'
  const done = items.filter((i) => i.status === 'done').length
  return (
    <div className="flex flex-col gap-[6px] rounded-md outline-1 -outline-offset-1 outline-line-strong bg-surface p-[12px]">
      <div className="flex items-center gap-[8px]">
        <span className="text-[12.5px] font-semibold text-ink">{label}</span>
        {items.length > 0 && (
          <span className="text-[11.5px] text-muted">
            {done} of {items.length} done
          </span>
        )}
      </div>
      <div className="flex flex-col gap-[4px]">
        {items.map((item, i) => {
          const status = item.status ?? 'pending'
          return (
            <div key={i} className="flex items-center gap-[7px] text-[12.5px]">
              {status === 'done' ? (
                <CheckCircle2 size={14} aria-hidden className="shrink-0 text-ok" />
              ) : status === 'active' ? (
                <Loader2 size={14} aria-hidden className="shrink-0 animate-spin text-ink-2" />
              ) : (
                <Circle size={14} aria-hidden className="shrink-0 text-faint" />
              )}
              <span className={status === 'done' ? 'text-muted line-through' : 'text-ink-2'}>{item.text}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Citations: a row of numbered pills that expands into a linked list. */
function SourcesBlock({ block }: { block: MessageBlock }) {
  const [open, setOpen] = useState(false)
  const sources = block.sources ?? []
  if (sources.length === 0) return null
  return (
    <div className="flex flex-col gap-[6px]">
      <div className="flex flex-wrap items-center gap-[6px]">
        <span className="text-[11.5px] font-medium text-muted">Sources</span>
        {sources.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setOpen((o) => !o)}
            title={s.title}
            className="inline-flex items-center gap-[5px] rounded-full px-[8px] py-[2px] text-[11.5px] text-ink-2 outline-1 -outline-offset-1 outline-line transition-colors hover:bg-soft"
          >
            <span className="font-mono text-[10.5px] text-muted">{s.n ?? i + 1}</span>
            {s.title && <span className="max-w-[160px] truncate">{s.title}</span>}
          </button>
        ))}
      </div>
      {open && (
        <div className="flex flex-col overflow-hidden rounded-md outline-1 -outline-offset-1 outline-line-strong">
          {sources.map((s, i) => (
            <a
              key={i}
              href={s.url || '#'}
              target={s.url ? '_blank' : undefined}
              rel="noopener noreferrer"
              className={`flex items-center gap-[8px] px-[12px] py-[8px] transition-colors hover:bg-soft ${i > 0 ? 'border-t border-line' : ''}`}
            >
              <span className="font-mono text-[11px] text-muted">{s.n ?? i + 1}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[12.5px] font-medium text-ink">{s.title || 'Source'}</span>
                {s.subtitle && <span className="truncate text-[11.5px] text-muted">{s.subtitle}</span>}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

/** "Needs you" chip — a small warn pill shared by the interactive cards. */
function NeedsYou() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-warn-tint px-[7px] py-[2px] text-[10.5px] font-medium text-warn">
      Needs you
    </span>
  )
}

/**
 * An action the helper wants to take (open a PR, run a deploy, …). Three
 * choices: approve (primary), request changes, or defer. Decision is optimistic
 * and also forwarded to `onDecide`.
 */
function ActionCardBlock({ block, onDecide }: { block: MessageBlock; onDecide?: BlockDecideFn }) {
  const [decided, setDecided] = useState<BlockDecision | null>(null)
  const [busy, setBusy] = useState(false)
  const details = block.details ?? []

  async function decide(decision: BlockDecision) {
    setBusy(true)
    try {
      await onDecide?.(block, decision)
      setDecided(decision)
    } finally {
      setBusy(false)
    }
  }

  const decidedLabel =
    decided === 'approve' ? 'Opening…' : decided === 'changes' ? 'Noted, revising…' : 'Deferred'

  return (
    <div className="flex flex-col gap-[10px] rounded-md outline-1 -outline-offset-1 outline-line-strong bg-surface p-[12px]">
      <div className="flex items-center gap-[10px]">
        <span className="flex size-[32px] shrink-0 items-center justify-center rounded-base bg-soft text-ink-2">
          <GitPullRequest size={16} aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-semibold text-ink">{block.title}</span>
          {block.target && <span className="truncate text-[11.5px] text-muted">{block.target}</span>}
        </span>
        <NeedsYou />
      </div>
      {details.length > 0 && (
        <div className="flex flex-col gap-[4px] rounded-base bg-soft px-[10px] py-[8px]">
          {details.map((d, i) => (
            <span key={i} className="text-[12px] text-ink-2">
              {d}
            </span>
          ))}
        </div>
      )}
      {decided ? (
        <div className="text-[12px] text-muted">{decidedLabel}</div>
      ) : (
        <div className="flex flex-wrap gap-[8px]">
          <Button height={28} icon={Check} disabled={busy} onClick={() => void decide('approve')}>
            {block.actionLabel || 'Approve'}
          </Button>
          <Button height={28} variant="secondary" icon={Pencil} disabled={busy} onClick={() => void decide('changes')}>
            Change something
          </Button>
          <Button height={28} variant="secondary" disabled={busy} onClick={() => void decide('reject')}>
            Not now
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * A confirmation before something leaves the company (a send, a risky action).
 * Pending: a full card with Cancel / confirm + "who asked · when". Answered: a
 * compact row with an undo window. Optimistic, also forwarded to `onDecide`.
 */
function ConfirmationBlock({ block, onDecide }: { block: MessageBlock; onDecide?: BlockDecideFn }) {
  const [state, setState] = useState<'pending' | 'approved' | 'cancelled'>(block.done ? 'approved' : 'pending')
  const [busy, setBusy] = useState(false)
  const risky = block.risk != null && block.risk !== 'low'
  const confirmLabel = block.actionLabel || 'Confirm'
  const isSend = /^send/i.test(confirmLabel)

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true)
    try {
      await onDecide?.(block, decision === 'approve' ? 'approve' : 'reject')
      setState(decision === 'approve' ? 'approved' : 'cancelled')
    } finally {
      setBusy(false)
    }
  }

  if (state !== 'pending') {
    const approved = state === 'approved'
    const recap = block.doneLabel || block.title || (approved ? 'approved' : 'cancelled')
    return (
      <div className="flex items-center gap-[8px] rounded-md outline-1 -outline-offset-1 outline-line px-[12px] py-[8px] text-[12px]">
        {approved ? (
          <CheckCircle2 size={14} aria-hidden className="shrink-0 text-ok" />
        ) : (
          <TriangleAlert size={14} aria-hidden className="shrink-0 text-bad" />
        )}
        <span className="min-w-0 flex-1 truncate text-ink-2">
          {approved ? 'You approved' : 'You cancelled'}: {recap}
        </span>
        {approved && <span className="shrink-0 text-muted">Undo for {block.undoMin ?? 5} min</span>}
      </div>
    )
  }

  return (
    <div
      className={`flex flex-col gap-[10px] rounded-md bg-surface p-[12px] outline-1 -outline-offset-1 ${risky ? 'outline-bad-line' : 'outline-line-strong'}`}
    >
      <div className="flex items-center gap-[10px]">
        <span
          className={`flex size-[32px] shrink-0 items-center justify-center rounded-base ${risky ? 'bg-bad-tint text-bad' : 'bg-soft text-ink-2'}`}
        >
          {isSend ? <Send size={16} aria-hidden /> : <TriangleAlert size={16} aria-hidden />}
        </span>
        <span className="text-[13px] font-semibold text-ink">{block.title}</span>
      </div>
      {block.text && <p className="m-0 text-[12.5px] leading-[1.5] text-ink-2">{block.text}</p>}
      <div className="flex flex-wrap items-center gap-[8px]">
        <Button height={28} variant="secondary" disabled={busy} onClick={() => void decide('reject')}>
          Cancel
        </Button>
        <Button
          height={28}
          icon={isSend ? Send : Check}
          disabled={busy}
          onClick={() => void decide('approve')}
          className={risky ? 'bg-bad-solid text-white hover:opacity-90' : ''}
        >
          {confirmLabel}
        </Button>
        <span className="h-px flex-1" />
        {(block.who || block.when) && (
          <span className="text-[11.5px] text-muted">
            {block.who && `${block.who} asked`}
            {block.who && block.when && ' · '}
            {block.when}
          </span>
        )}
      </div>
    </div>
  )
}

/** Status chip colour for a task's lifecycle. */
function taskStatusChip(status: string): { label: string; cls: string } {
  switch (status) {
    case 'running':
    case 'in_progress':
      return { label: 'In progress', cls: 'bg-soft text-ink-2' }
    case 'done':
      return { label: 'Done', cls: 'bg-ok-tint text-ok' }
    case 'failed':
      return { label: 'Failed', cls: 'bg-bad-tint text-bad' }
    default:
      return { label: 'Pending', cls: 'bg-soft text-muted' }
  }
}

/** A task handed to a helper: status, meta chips, and a progress track. */
function TaskBlock({ block }: { block: MessageBlock }) {
  const stepsDone = block.stepsDone ?? 0
  const stepsTotal = block.stepsTotal ?? 0
  const pct = stepsTotal > 0 ? Math.round((stepsDone / stepsTotal) * 100) : 0
  const chip = taskStatusChip(block.status ?? 'pending')
  const metas: { icon: typeof Users; text: string }[] = [
    block.staff ? { icon: Users, text: block.staff } : null,
    block.due ? { icon: Calendar, text: block.due } : null,
    block.branch ? { icon: GitBranch, text: block.branch } : null,
    block.goal ? { icon: Target, text: block.goal } : null,
  ].filter((x): x is { icon: typeof Users; text: string } => x != null)
  return (
    <div className="flex flex-col gap-[8px] rounded-md outline-1 -outline-offset-1 outline-line-strong bg-surface p-[12px]">
      <div className="flex items-center gap-[8px]">
        <SquareCheck size={15} aria-hidden className="shrink-0 text-ink-2" />
        <span className="text-[11.5px] text-muted">Task{block.staff ? ` · handed to ${block.staff}` : ''}</span>
        <span className="h-px flex-1" />
        <span className={`rounded-full px-[7px] py-[2px] text-[10.5px] font-medium ${chip.cls}`}>{chip.label}</span>
      </div>
      {block.title && <div className="text-[13px] font-semibold text-ink">{block.title}</div>}
      {metas.length > 0 && (
        <div className="flex flex-wrap gap-x-[12px] gap-y-[4px]">
          {metas.map((m, i) => (
            <span key={i} className="inline-flex items-center gap-[4px] text-[11.5px] text-muted">
              <m.icon size={12} aria-hidden />
              {m.text}
            </span>
          ))}
        </div>
      )}
      {(stepsTotal > 0 || block.taskId) && (
        <div className="flex items-center gap-[8px]">
          {stepsTotal > 0 && (
            <>
              <span className="h-[5px] flex-1 overflow-hidden rounded-full bg-soft">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
              </span>
              <span className="shrink-0 text-[11.5px] text-muted">
                {stepsDone} of {stepsTotal} steps
              </span>
            </>
          )}
          {stepsTotal === 0 && <span className="h-px flex-1" />}
          {block.taskId && (
            <a
              href={`/jobs/${block.taskId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-[3px] text-[11.5px] text-muted transition-colors hover:text-ink"
            >
              Open job
              <ArrowUpRight size={12} aria-hidden />
            </a>
          )}
        </div>
      )}
    </div>
  )
}

/** A one-line usage meter: account · tokens · duration · share of today's budget. */
function UsageMeterBlock({ block }: { block: MessageBlock }) {
  const tokIn = block.tokensIn ?? 0
  const tokOut = block.tokensOut ?? 0
  const hasTok = tokIn > 0 || tokOut > 0
  const pct = block.budgetPct != null ? Math.min(100, block.budgetPct) : null
  const sep = <span aria-hidden className="text-faint">·</span>
  return (
    <div className="flex flex-wrap items-center gap-[6px] text-[11.5px] text-muted">
      {block.account && (
        <>
          <span className="inline-flex items-center gap-[5px]">
            <span aria-hidden className="size-[6px] rounded-full bg-ok" />
            {block.account}
            {block.tier ? ` · ${block.tier}` : ''}
          </span>
          {(hasTok || block.durationS != null) && sep}
        </>
      )}
      {hasTok && (
        <span>
          {compact(tokIn)} in / {compact(tokOut)} out
        </span>
      )}
      {block.durationS != null && (
        <>
          {hasTok && sep}
          <span>{block.durationS.toFixed(1)}s</span>
        </>
      )}
      {pct != null && pct > 0 && (
        <>
          <span className="h-px flex-1" />
          <span>of today</span>
          <span className="h-[5px] w-[64px] overflow-hidden rounded-full bg-soft">
            <span className="block h-full rounded-full bg-ink-2" style={{ width: `${pct}%` }} />
          </span>
        </>
      )}
    </div>
  )
}

/** A doc a helper wrote or read: peek thumbnail, meta, snippet, and open/download. */
function DocumentBlock({ block }: { block: MessageBlock }) {
  const title = block.title || block.name || 'Document'
  const chip = block.source || 'Docs'
  const words = block.words != null ? `${compact(block.words)} words` : ''
  const meta = [words, block.writtenBy ? `written by ${block.writtenBy}` : '', block.when].filter(Boolean).join(' · ')
  const href = block.docPath ? `/docs/?path=${encodeURIComponent(block.docPath)}` : block.url
  return (
    <div className="flex gap-[12px] rounded-md outline-1 -outline-offset-1 outline-line-strong bg-surface p-[12px]">
      <div
        aria-hidden
        className="flex h-[72px] w-[56px] shrink-0 flex-col gap-[3px] overflow-hidden rounded-base bg-soft p-[8px]"
      >
        <span className="h-[6px] w-full rounded-full bg-line-strong" />
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className="h-[3px] w-full rounded-full bg-line" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
        <div className="flex items-center gap-[8px]">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{title}</span>
          <span className="shrink-0 rounded-full bg-soft px-[7px] py-[2px] text-[10.5px] text-muted">{chip}</span>
        </div>
        {meta && <span className="text-[11.5px] text-muted">{meta}</span>}
        {block.text && <span className="line-clamp-2 text-[12px] text-ink-2">{block.text}</span>}
        <div className="mt-[2px] flex gap-[8px]">
          {href && (
            <a
              href={href}
              target={block.docPath ? undefined : '_blank'}
              rel="noopener noreferrer"
              className="inline-flex h-[28px] items-center gap-[5px] rounded-btn px-[10px] text-[12.5px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
            >
              <BookOpen size={14} aria-hidden className="text-ink-2" />
              Open in Docs
            </a>
          )}
          {block.url && (
            <a
              href={block.url}
              download
              aria-label="Download"
              className="inline-flex h-[28px] items-center gap-[5px] rounded-btn px-[10px] text-[12.5px] font-medium text-muted transition-colors hover:text-ink"
            >
              <Download size={14} aria-hidden />
              Download
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

/** A generated image: shimmer while generating, a 2-up chooser, or a single image. */
function ImageBlock({ block, onStop }: { block: MessageBlock; onStop?: BlockStopFn }) {
  const [selected, setSelected] = useState(block.selectedOption ?? 0)
  const options = block.imageOptions ?? []

  if (block.generating) {
    return (
      <div className="flex flex-col gap-[8px] rounded-md outline-1 -outline-offset-1 outline-line-strong bg-surface p-[12px]">
        <div className="flex items-center gap-[8px]">
          <ImageIcon size={14} aria-hidden className="text-ink-2" />
          <span className="text-[12.5px] text-ink-2">{block.text || 'Making images…'}</span>
          <span className="h-px flex-1" />
          {block.progress != null && <span className="text-[11.5px] text-muted">{block.progress}%</span>}
          {onStop && (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex items-center gap-[4px] text-[11.5px] text-muted transition-colors hover:text-ink"
            >
              <Square size={11} aria-hidden />
              Stop
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-[8px]">
          <span className="aspect-square animate-pulse rounded-base bg-soft" />
          <span className="aspect-square animate-pulse rounded-base bg-soft" />
        </div>
        {block.prompt && <p className="m-0 text-[12px] text-muted italic">“{block.prompt}”</p>}
      </div>
    )
  }

  if (options.length > 0) {
    return (
      <div className="flex flex-col gap-[8px]">
        <div className="grid grid-cols-2 gap-[8px]">
          {options.map((opt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSelected(i)}
              aria-label={`Select option ${i + 1}`}
              aria-pressed={selected === i}
              className={`overflow-hidden rounded-base outline-2 -outline-offset-2 transition ${selected === i ? 'outline-primary' : 'outline-transparent hover:outline-line-strong'}`}
            >
              <img src={opt.url} alt={`Option ${i + 1}`} loading="lazy" className="aspect-square w-full object-cover" />
            </button>
          ))}
        </div>
        <div className="flex gap-[8px]">
          <Button height={28} icon={Check}>
            Use option {selected + 1}
          </Button>
          {onStop && (
            <Button height={28} variant="secondary" icon={RotateCcw} onClick={onStop}>
              Try again
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (!block.url) return null
  return (
    <div className="overflow-hidden rounded-md outline-1 -outline-offset-1 outline-line-strong">
      <img src={block.url} alt={block.prompt || block.name || 'image'} loading="lazy" className="w-full" />
    </div>
  )
}

/** A live reply being written: partial text with a caret and a Stop control. */
function StreamingBlock({ block, onStop }: { block: MessageBlock; onStop?: BlockStopFn }) {
  const text = block.text ?? ''
  return (
    <div className="flex flex-col gap-[6px]">
      <p className="m-0 text-[13.5px] leading-[1.55] whitespace-pre-wrap text-ink-2">
        {text}
        <span aria-hidden className="ml-[1px] inline-block h-[14px] w-[7px] translate-y-[2px] animate-pulse bg-ink-2" />
      </p>
      <div className="flex items-center gap-[6px] text-[11.5px] text-muted">
        <Loader2 size={12} aria-hidden className="animate-spin" />
        <span>Writing…{block.tokens != null ? ` · ${block.tokens} tokens` : ''}</span>
        {onStop && (
          <>
            <span className="h-px flex-1" />
            <button
              type="button"
              onClick={onStop}
              className="inline-flex items-center gap-[4px] transition-colors hover:text-ink"
            >
              <Square size={11} aria-hidden />
              Stop
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/** A pull-request the helper opened or wants to open: stats + open/change/dismiss. */
function PrCardBlock({ block }: { block: MessageBlock }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  const base = block.base || 'main'
  const subtitle = [block.repo, block.branch ? `${block.branch} → ${base}` : base].filter(Boolean).join(' · ')
  const files = block.filesChanged ?? 0
  function openPr() {
    if (block.prUrl) window.open(block.prUrl, '_blank', 'noopener,noreferrer')
  }
  return (
    <div className="flex flex-col gap-[10px] rounded-md outline-1 -outline-offset-1 outline-line-strong bg-surface p-[12px]">
      <div className="flex items-center gap-[10px]">
        <span className="flex size-[32px] shrink-0 items-center justify-center rounded-base bg-soft text-ink-2">
          <GitPullRequest size={16} aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[13px] font-semibold text-ink">Open a pull request</span>
          {subtitle && <span className="truncate text-[11.5px] text-muted">{subtitle}</span>}
        </span>
        <NeedsYou />
      </div>
      <div className="flex flex-col gap-[4px] rounded-base bg-soft px-[10px] py-[8px] text-[12px] text-ink-2">
        <span className="inline-flex items-center gap-[6px]">
          <FileText size={12} aria-hidden />
          {files} file{files !== 1 ? 's' : ''} changed
          {block.additions != null && <span className="text-ok">+{block.additions}</span>}
          {block.deletions != null && <span className="text-bad">−{block.deletions}</span>}
        </span>
        {block.tests && (
          <span className="inline-flex items-center gap-[6px]">
            <FlaskConical size={12} aria-hidden />
            {block.tests}
          </span>
        )}
        <span className="inline-flex items-center gap-[6px]">
          <User size={12} aria-hidden />
          Reviewer: {block.reviewer || 'you'}
        </span>
      </div>
      <div className="flex flex-wrap gap-[8px]">
        <Button height={28} icon={ExternalLink} onClick={openPr}>
          Open PR
        </Button>
        <Button height={28} variant="secondary" icon={Pencil}>
          Change something
        </Button>
        <Button height={28} variant="secondary" onClick={() => setDismissed(true)}>
          Not now
        </Button>
      </div>
    </div>
  )
}

/** Dispatch one block to its renderer; unknown types fall back to markdown. */
function renderBlock(block: MessageBlock, i: number, onDecide?: BlockDecideFn, onStop?: BlockStopFn) {
  switch (block.type) {
    case 'reasoning':
      return <ReasoningBlock key={i} block={block} />
    case 'code':
      return <CodeBlock key={i} block={block} />
    case 'markdown':
      return <MarkdownBlock key={i} block={block} />
    case 'todos':
      return <TodosBlock key={i} block={block} />
    case 'sources':
      return <SourcesBlock key={i} block={block} />
    case 'action_card':
      return <ActionCardBlock key={i} block={block} onDecide={onDecide} />
    case 'confirmation':
      return <ConfirmationBlock key={i} block={block} onDecide={onDecide} />
    case 'task':
      return <TaskBlock key={i} block={block} />
    case 'usage_meter':
      return <UsageMeterBlock key={i} block={block} />
    case 'document':
      return <DocumentBlock key={i} block={block} />
    case 'image':
      return <ImageBlock key={i} block={block} onStop={onStop} />
    case 'streaming':
      return <StreamingBlock key={i} block={block} onStop={onStop} />
    case 'pr_card':
      return <PrCardBlock key={i} block={block} />
    default:
      return <MarkdownBlock key={i} block={block} />
  }
}

/**
 * Render an agent reply built from typed blocks. `onDecide` (optional) runs when
 * the owner acts on an interactive block (action_card, confirmation); `onStop`
 * (optional) runs when they stop an in-flight block (image, streaming). Without
 * them those blocks still render; interactive ones keep local optimistic state.
 */
export function ReplyBlocks({
  blocks,
  onDecide,
  onStop,
}: {
  blocks: MessageBlock[]
  onDecide?: BlockDecideFn
  onStop?: BlockStopFn
}) {
  return (
    <div className="flex flex-col gap-[10px]">{blocks.map((b, i) => renderBlock(b, i, onDecide, onStop))}</div>
  )
}
