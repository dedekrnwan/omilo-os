/**
 * Markdown — a compact, dependency-free renderer for agent replies.
 *
 * Builds React nodes directly (no `dangerouslySetInnerHTML`, so no XSS surface)
 * for the common chat subset: headings, bold/italic/inline-code, links,
 * bullet/numbered lists, fenced code, and paragraphs. Richer needs (tables,
 * syntax highlighting) can later swap this for a full markdown pipeline behind
 * the same component API.
 */
import type { ReactNode } from 'react'

// Inline spans, first match wins: `code`, **bold**, *italic*/_italic_, [text](url).
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*|_[^_]+_)|(\[[^\]]+\]\([^)]+\))/

function inline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let rest = text
  let i = 0
  while (rest) {
    const m = INLINE.exec(rest)
    if (!m) {
      nodes.push(rest)
      break
    }
    if (m.index > 0) nodes.push(rest.slice(0, m.index))
    const tok = m[0]
    const key = `${keyBase}-${i++}`
    if (tok.startsWith('`')) {
      nodes.push(
        <code key={key} className="rounded-[4px] bg-soft px-[4px] py-[1px] font-mono text-[12px] text-ink">
          {tok.slice(1, -1)}
        </code>,
      )
    } else if (tok.startsWith('**')) {
      nodes.push(
        <strong key={key} className="font-semibold text-ink">
          {tok.slice(2, -2)}
        </strong>,
      )
    } else if (tok.startsWith('[')) {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)
      if (lm) {
        nodes.push(
          <a
            key={key}
            href={lm[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-link underline underline-offset-2 hover:opacity-80"
          >
            {lm[1]}
          </a>,
        )
      } else {
        nodes.push(tok)
      }
    } else {
      nodes.push(
        <em key={key} className="italic">
          {tok.slice(1, -1)}
        </em>,
      )
    }
    rest = rest.slice(m.index + tok.length)
  }
  return nodes
}

function parseBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  let k = 0
  const isUl = (l: string) => /^\s*[-*]\s+/.test(l)
  const isOl = (l: string) => /^\s*\d+\.\s+/.test(l)
  const isH = (l: string) => /^#{1,6}\s+/.test(l)
  const isFence = (l: string) => l.trimStart().startsWith('```')

  while (i < lines.length) {
    const line = lines[i]
    if (isFence(line)) {
      const body: string[] = []
      i++
      while (i < lines.length && !isFence(lines[i])) {
        body.push(lines[i])
        i++
      }
      i++ // closing fence
      out.push(
        <pre
          key={k++}
          className="overflow-x-auto rounded-md bg-soft p-[12px] font-mono text-[12px] leading-[1.5] text-ink"
        >
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const lvl = h[1].length
      const sz = lvl <= 1 ? 'text-[17px]' : lvl === 2 ? 'text-[15px]' : 'text-[13.5px]'
      out.push(
        <p key={k} className={`${sz} font-semibold text-ink`}>
          {inline(h[2], `h${k++}`)}
        </p>,
      )
      i++
      continue
    }
    if (isUl(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && isUl(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*[-*]\s+/, ''), `ul${k}-${items.length}`)}</li>)
        i++
      }
      out.push(
        <ul key={k++} className="flex list-disc flex-col gap-[2px] pl-[18px]">
          {items}
        </ul>,
      )
      continue
    }
    if (isOl(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && isOl(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*\d+\.\s+/, ''), `ol${k}-${items.length}`)}</li>)
        i++
      }
      out.push(
        <ol key={k++} className="flex list-decimal flex-col gap-[2px] pl-[20px]">
          {items}
        </ol>,
      )
      continue
    }
    if (line.trim() === '') {
      i++
      continue
    }
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !isUl(lines[i]) &&
      !isOl(lines[i]) &&
      !isH(lines[i]) &&
      !isFence(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    out.push(
      <p key={k} className="m-0">
        {inline(para.join(' '), `p${k++}`)}
      </p>,
    )
  }
  return out
}

/** Render a markdown string as styled React nodes. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className ?? 'flex flex-col gap-[8px] text-[13.5px] leading-[1.55] text-ink-2'}>
      {parseBlocks(text || '')}
    </div>
  )
}
