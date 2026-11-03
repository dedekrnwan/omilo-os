/**
 * ReplyBlocks — renders an agent reply's typed blocks (ported from omilo-os
 * "chat components"). A switch over block.type; an unknown/future type falls
 * back to markdown so the backend can add block types without a frontend
 * release.
 *
 * This slice ships reasoning · markdown · code. The remaining omilo-os blocks
 * (action_card, confirmation, sources, todos, …) drop in as new cases here.
 */
import { useState } from 'react'
import { Brain, Check, ChevronDown, ChevronUp, Copy } from 'lucide-react'
import type { MessageBlock } from '../../core/domain/types'
import { Markdown } from './Markdown'

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

/** Dispatch one block to its renderer; unknown types fall back to markdown. */
function renderBlock(block: MessageBlock, i: number) {
  switch (block.type) {
    case 'reasoning':
      return <ReasoningBlock key={i} block={block} />
    case 'code':
      return <CodeBlock key={i} block={block} />
    case 'markdown':
      return <MarkdownBlock key={i} block={block} />
    default:
      return <MarkdownBlock key={i} block={block} />
  }
}

/** Render an agent reply built from typed blocks. */
export function ReplyBlocks({ blocks }: { blocks: MessageBlock[] }) {
  return <div className="flex flex-col gap-[10px]">{blocks.map((b, i) => renderBlock(b, i))}</div>
}
