/** Pure search helpers for the command menu — no React. */
import { GROUP_ORDER, tabOf } from './data'
import type { Corpus, Group, Item, TabId } from './data'

export interface Section {
  heading: string
  items: Item[]
}

export type SearchResult =
  | { mode: 'empty'; sections: Section[] }
  | { mode: 'results'; sections: Section[]; count: number }
  | { mode: 'ask'; question: string; closest: Item[] }

const norm = (s: string) => s.toLowerCase()
const STOP = new Set(['why', 'did', 'the', 'last', 'what', 'how', 'when', 'who', 'does', 'is', 'are', 'was', 'our', 'we', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'do'])

function inTab(item: Item, tab: TabId) {
  return tab === 'all' || tabOf(item.group) === tab
}

/** Leading prefixes from the footer: `>` actions · `@` helpers · `#` channels. */
function prefixTab(raw: string): { tab: TabId | null; needle: string } {
  if (raw.startsWith('>')) return { tab: 'actions', needle: raw.slice(1).trim() }
  if (raw.startsWith('@')) return { tab: 'helpers', needle: raw.slice(1).trim() }
  if (raw.startsWith('#')) return { tab: 'chats', needle: raw.slice(1).trim() }
  return { tab: null, needle: raw }
}

function isQuestion(q: string) {
  return q.endsWith('?') || /^(why|how|what|when|who|which|should|can|is|are|do|does)\b/i.test(q)
}

export function search(query: string, tab: TabId, corpus: Corpus): SearchResult {
  const CORPUS = corpus.all
  const raw = query.trim()
  const { tab: forced, needle } = prefixTab(raw)
  const t = forced ?? tab

  if (!needle) {
    if (t === 'all') {
      return {
        mode: 'empty',
        sections: [
          ...(corpus.recent.length ? [{ heading: 'RECENT', items: corpus.recent }] : []),
          { heading: 'JUMP TO', items: corpus.jumpTo },
          { heading: 'ACTIONS', items: corpus.actions },
        ],
      }
    }
    return { mode: 'empty', sections: grouped(CORPUS.filter((i) => inTab(i, t))) }
  }

  const n = norm(needle)
  const hits = CORPUS.filter(
    (i) => inTab(i, t) && norm(`${i.label} ${i.meta ?? ''} ${i.keywords ?? ''}`).includes(n),
  )
  if (hits.length && !(isQuestion(needle) && needle.includes(' '))) {
    const sections = grouped(hits)
    return { mode: 'results', sections, count: hits.length }
  }

  // Nothing matches the phrase itself → Ask Chief, with the closest word matches.
  const words = n.split(/[^a-z0-9-]+/).filter((w) => w.length > 2 && !STOP.has(w))
  const scored = CORPUS.map((i) => {
    const hay = norm(`${i.label} ${i.meta ?? ''} ${i.keywords ?? ''}`)
    return { i, s: words.filter((w) => hay.includes(w)).length }
  })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
  const seen = new Set<string>()
  const closest: Item[] = []
  for (const { i } of scored) {
    if (seen.has(i.label)) continue
    seen.add(i.label)
    closest.push(i)
    if (closest.length === 3) break
  }
  const order: Group[] = ['GOALS', 'DOCS', 'CHATS', 'PAGES', 'FLOWS', 'ACTIONS', 'HELPERS', 'SETTINGS']
  closest.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
  return { mode: 'ask', question: needle, closest }
}

function grouped(items: Item[]): Section[] {
  return GROUP_ORDER.map((g) => ({ heading: g, items: items.filter((i) => i.group === g) })).filter(
    (s) => s.items.length > 0,
  )
}

/** Flat list of selectable items, in display order. */
export function flatten(sections: Section[]): Item[] {
  return sections.flatMap((s) => s.items)
}
