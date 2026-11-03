/**
 * ReplyBlocks — renders an agent reply's typed blocks (ported from omilo-os
 * "chat components"). A switch over block.type; an unknown/future type falls
 * back to markdown so the backend can add block types without a frontend
 * release.
 *
 * Ships reasoning · markdown · code · todos · sources · action_card ·
 * confirmation. The two interactive blocks (action_card, confirmation) keep
 * their decision locally (optimistic) and also call the optional `onDecide`
 * prop, so a later slice can wire them to real proposal commands without
 * touching the renderers. Remaining omilo-os blocks (task, usage_meter,
 * document, image, streaming, …) drop in as new cases here.
 */
import { useState } from 'react'
import {
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
  GitPullRequest,
  Loader2,
  Pencil,
  Send,
  TriangleAlert,
} from 'lucide-react'
import type { BlockDecision, MessageBlock } from '../../core/domain/types'
import { Button } from '../ds/Button'
import { Markdown } from './Markdown'

/** Called when the owner decides on an interactive block (action_card, confirmation). */
export type BlockDecideFn = (block: MessageBlock, decision: BlockDecision) => void | Promise<void>

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

/** Dispatch one block to its renderer; unknown types fall back to markdown. */
function renderBlock(block: MessageBlock, i: number, onDecide?: BlockDecideFn) {
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
    default:
      return <MarkdownBlock key={i} block={block} />
  }
}

/**
 * Render an agent reply built from typed blocks. `onDecide` (optional) is
 * called when the owner acts on an interactive block (action_card,
 * confirmation); without it those blocks still work with local optimistic
 * state.
 */
export function ReplyBlocks({ blocks, onDecide }: { blocks: MessageBlock[]; onDecide?: BlockDecideFn }) {
  return <div className="flex flex-col gap-[10px]">{blocks.map((b, i) => renderBlock(b, i, onDecide))}</div>
}
