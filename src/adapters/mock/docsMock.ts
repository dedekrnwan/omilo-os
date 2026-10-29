/**
 * sweep/docs — in-memory mock for docs, lessons, knowledge sources, Ask and
 * the company handbook. Shared by createMockRepos() and createMockCommands()
 * so a mock mutation (rename, delete, confirm…) shows up in the next read.
 *
 * The demo content lives here (mock mode only); feature components never
 * import it.
 */
import type {
  AskAnswer,
  DocDetail,
  DocGraph,
  DocSummary,
  DocVersion,
  HandbookFileDetail,
  HandbookIndex,
  HandbookSuggestion,
  KbSource,
  Lesson,
} from '../../core/domain/types'
import type {
  AddKnowledgeSourceInput,
  CreateLessonInput,
  PatchDocInput,
  SaveHandbookFileInput,
  SuggestHandbookEditInput,
} from '../http/commands'
import { goals, kbSources } from './fixtures'

const now = Date.now()
const ago = (mins: number) => new Date(now - mins * 60_000).toISOString()

let seq = 0
const nid = (p: string) => `${p}-mock-${++seq}`

function doc(id: string, title: string, area: string | null, content: string, opts: Partial<DocSummary> = {}): DocSummary {
  return {
    id,
    path: `Docs/doc/${id}.md`,
    title,
    content,
    kind: 'doc',
    area,
    pinned: false,
    hidden: false,
    helperId: null,
    version: 1,
    updatedAt: ago(120),
    updatedBy: 'helper:h-dev',
    createdAt: ago(60 * 24 * 7),
    createdBy: 'helper:h-dev',
    ...opts,
  }
}

const SEED_DOCS: DocSummary[] = [
  doc(
    'd-passkey',
    'Passkey rollout — v1',
    'ch-engineering',
    `Ship passkeys to every user before the Nov 28 code freeze, in two waves. Owner: Dev. Part of [[Passwordless login by Q4]].

## Wave 1 — web + iOS

- Ship in staging Nov 10, to 10% of users Nov 12, to 100% Nov 14.
- Fallback stays on; password login remains for anyone without a passkey.
- Release notes reuse [[Launch checklist]].

## Wave 2 — Android

The legacy WebView blocks WebAuthn, so Android gets a password fallback flow first. Two extra days, now due Nov 23.

- Risk tracked in [[Freeze exceptions]]

## Rollback

Feature flag passkeys_enabled. Ops can flip it in under a minute; see [[Postmortem #482]].`,
    { version: 3, pinned: true },
  ),
  doc('d-launch', 'Launch checklist', 'ch-engineering', 'The steps every launch follows.\n\n## Before\n\n- Freeze check against [[Freeze exceptions]].\n- Comms ready in [[Launch comms copy]].', { createdBy: 'operator:usr-demo', updatedBy: 'operator:usr-demo' }),
  doc('d-freeze', 'Freeze exceptions', 'ch-engineering', 'Only P0 fixes after Nov 28, with Chief sign-off.'),
  doc('d-pm482', 'Postmortem #482', 'ch-engineering', 'Migrations ran twice during deploy. Run migrations once; rollback drill took 11 minutes.'),
  doc('d-brand', 'Brand voice guide', 'ch-marketing', 'Warm, plain and short. No slang.', { createdBy: 'operator:usr-demo', updatedBy: 'operator:usr-demo', updatedAt: ago(60 * 24 * 4) }),
  doc('d-comms', 'Launch comms copy', 'ch-marketing', 'Announcement copy for the passkey launch. Voice per [[Brand voice guide]].', { updatedBy: 'helper:h-growth', createdBy: 'helper:h-growth' }),
  doc('d-pricing', 'Pricing 2026', 'ch-business', 'Plans and prices for next year. See [[October close summary]].', { createdBy: 'operator:usr-demo', updatedBy: 'operator:usr-demo', updatedAt: ago(60 * 24 * 2) }),
  doc('d-close', 'October close summary', 'ch-business', 'Books closed on day 5. Cloud spend up 9%.', { updatedBy: 'helper:h-chief', createdBy: 'helper:h-chief' }),
  doc('d-offsite', 'Offsite venues', null, 'Three venues shortlisted for the Q1 offsite.', { updatedAt: ago(60 * 24 * 8) }),
]

function hb(name: string, title: string, description: string, content: string, opts: Partial<HandbookFileDetail> = {}): HandbookFileDetail {
  return {
    id: `hb-${name.toLowerCase().replace('.md', '')}`,
    name,
    title,
    description,
    visibility: 'everyone',
    brief: name === 'BRIEF.md',
    version: 1,
    updatedAt: ago(60 * 24 * 5),
    updatedBy: 'operator:usr-demo',
    openSuggestions: 0,
    content,
    versions: [{ version: 1, updatedBy: 'operator:usr-demo', note: 'Created', createdAt: ago(60 * 24 * 30) }],
    suggestions: [],
    ...opts,
  }
}

function seedHandbook(): HandbookFileDetail[] {
  return [
    hb('BRIEF.md', 'Company brief', 'The paragraph every helper reads first',
      'Demo Workspace runs neighbourhood admin for 64 RTs: monthly dues, cover letters, facility bookings and clean-up days. We serve residents first, RT heads second. We speak warm and plain, and never share a resident’s data outside their RT.'),
    hb('COMPANY.md', 'Company', 'Who we are, who we serve and the 64 RTs we cover',
      'Who we are, who we serve, and the 64 RTs we cover.\n\n## Who we are\n\nNeighbourhood admin for 64 RTs — dues, letters, bookings and clean-up days.\n\n## Who we serve\n\n- Residents first.\n- RT heads second — they approve, we do the admin.'),
    hb('SERVICES.md', 'Services', 'Dues, letters and bookings — what each costs and takes',
      'What each service costs and how long it takes.\n\n## Monthly dues\n\n- Rp 50.000 per household, due by the 10th.\n\n## Facility bookings\n\n- Hall and sports court, Rp 150.000 deposit.'),
    hb('POLICIES.md', 'Policies', 'Refunds, resident data, and what needs an owner’s OK',
      'The rules every helper and every person follows. When something isn’t covered here, ask the owner — don’t guess.\n\n## Refunds\n\n- Dues paid twice are refunded within 3 working days.\n- Anything else needs an owner’s OK first.\n\n## Late dues\n\n- A Rp 10.000 late fee applies after the 10th of the month.',
      { version: 3, updatedAt: ago(60 * 24), versions: [
        { version: 3, updatedBy: 'operator:usr-demo', note: null, createdAt: ago(60 * 24) },
        { version: 2, updatedBy: 'suggestion:Growth', note: 'Accepted from Growth', createdAt: ago(60 * 24 * 7) },
        { version: 1, updatedBy: 'operator:usr-demo', note: 'Created', createdAt: ago(60 * 24 * 30) },
      ] }),
    hb('VOICE.md', 'Voice', 'How we talk to residents and RT heads',
      'How we talk — the same voice, every helper.\n\n## Tone\n\nWarm, plain and short.'),
    hb('FAQ.md', 'FAQ', 'What residents ask every week, answered once',
      'What residents ask every week.\n\n## When are dues due?\n\nBy the 10th of each month.', { updatedAt: ago(60) }),
    hb('PEOPLE.md', 'People', 'Who owns what, and who to call after hours',
      'Who owns what. Members and helpers only.\n\n## Owners\n\n- Dues and refunds — Finance.\n- Everything else — the Chief of Staff.', { visibility: 'members' }),
  ]
}

function seedSuggestions(): HandbookSuggestion[] {
  return [
    {
      id: 'hbs-1',
      docId: 'hb-policies',
      file: 'POLICIES.md',
      helperId: 'h-chief',
      author: 'Chief',
      text: 'Residents asked about the late fee for elders 4 times this month. Adding the rule lets helpers answer without asking you.',
      proposedContent: null,
      status: 'open',
      createdAt: ago(60 * 5),
      resolvedAt: null,
    },
  ]
}

function seedLessons(): Lesson[] {
  const l = (id: string, text: string, tag: Lesson['tag'], helperId: string | null, extra: Partial<Lesson> = {}): Lesson => ({
    id, text, tag, helperId, source: tag === 'fact' ? 'Company facts' : 'Learned in chat', status: 'active', createdBy: 'system', createdAt: ago(60 * 24 * 3), ...extra,
  })
  return [
    l('les-deploys', 'Deploys not after 21:00', 'lesson', 'h-chief', { status: 'review', source: 'Your Inbox decision · Nov 4' }),
    l('les-urgent', 'Urgent → WhatsApp', 'preference', 'h-chief'),
    l('les-brief', 'Brief: max 5 bullets', 'lesson', 'h-chief', { status: 'review', source: 'Your edit to a brief · Nov 2' }),
    l('les-refunds', 'Big refunds go to Finance', 'lesson', 'h-chief'),
    l('les-serves', 'Serves RT/RW admins', 'fact', null),
    l('les-q4', 'Q4 freeze: Nov 28', 'fact', null),
    l('les-staging', 'Staging before prod', 'preference', 'h-dev'),
    l('les-migr', 'Run migrations once', 'lesson', 'h-dev', { source: 'Postmortem #482' }),
    l('les-push', 'Never force-push main', 'lesson', 'h-dev'),
    l('les-voice', 'Voice: warm, no slang', 'preference', 'h-growth'),
    l('les-ads', 'Ads stop at the cap', 'lesson', 'h-growth'),
  ]
}

interface Store {
  docs: DocSummary[]
  versions: Record<string, DocVersion[]>
  handbook: HandbookFileDetail[]
  suggestions: HandbookSuggestion[]
  lessons: Lesson[]
  sources: KbSource[]
}

function seed(): Store {
  return {
    docs: SEED_DOCS.map((d) => ({ ...d })),
    versions: {},
    handbook: seedHandbook(),
    suggestions: seedSuggestions(),
    lessons: seedLessons(),
    sources: kbSources.filter((s) => s.kind === 'upload').map((s) => ({ ...s, chunks: 3, createdAt: ago(60 * 24) })),
  }
}

let store: Store = seed()

/** Reset the mock docs store (tests). */
export function resetDocsMock(): void {
  store = seed()
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const wikilinks = (content: string) => [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim())

function handbookAsDocs(): DocSummary[] {
  return store.handbook.map((f) => ({
    id: f.id,
    path: `Handbook/${f.name}`,
    title: f.title,
    content: f.content,
    kind: 'handbook',
    area: null,
    pinned: true,
    hidden: false,
    helperId: null,
    version: f.version,
    updatedAt: f.updatedAt,
    updatedBy: f.updatedBy,
    createdAt: null,
    createdBy: 'system',
  }))
}

function findByTitle(title: string): DocSummary | undefined {
  const t = title.toLowerCase()
  return [...store.docs, ...handbookAsDocs()].find((d) => d.title.toLowerCase() === t || d.path.split('/').pop()!.toLowerCase() === t)
}

function refreshHandbookCounts() {
  for (const f of store.handbook) f.openSuggestions = store.suggestions.filter((s) => s.docId === f.id && s.status === 'open').length
  for (const f of store.handbook) f.suggestions = store.suggestions.filter((s) => s.docId === f.id && s.status === 'open')
}

// ── Repos ────────────────────────────────────────────────────────────────────

export const mockDocsRepos = {
  docs: {
    list: (params?: { helperId?: string; kind?: string }) => {
      let out = [...store.docs, ...handbookAsDocs()]
      if (params?.helperId) out = out.filter((d) => d.helperId === params.helperId)
      if (params?.kind) out = out.filter((d) => d.kind === params.kind)
      return Promise.resolve(clone(out))
    },
    get: (id: string): Promise<DocDetail | null> => {
      const d = [...store.docs, ...handbookAsDocs()].find((x) => x.id === id)
      if (!d) return Promise.resolve(null)
      const links: DocDetail['links'] = []
      const goalLinks: DocDetail['goals'] = []
      const unresolved: string[] = []
      for (const t of wikilinks(d.content)) {
        const target = findByTitle(t)
        const goal = goals.find((g) => g.title.toLowerCase() === t.toLowerCase())
        if (target && target.id !== d.id) links.push({ id: target.id, title: target.title, kind: target.kind })
        else if (goal) goalLinks.push({ id: goal.id, title: goal.title, progress: goal.progress, status: 'active' })
        else unresolved.push(t)
      }
      const backlinks = store.docs
        .filter((o) => o.id !== d.id && wikilinks(o.content).some((t) => t.toLowerCase() === d.title.toLowerCase()))
        .map((o) => ({ id: o.id, title: o.title, kind: o.kind }))
      return Promise.resolve(clone({ ...d, links, goals: goalLinks, unresolved, backlinks }))
    },
    versions: (id: string): Promise<DocVersion[]> => {
      const d = store.docs.find((x) => x.id === id)
      const extra = store.versions[id] ?? []
      const base: DocVersion[] = d
        ? [{ id: `${id}-v1`, version: 1, title: d.title, updatedBy: d.createdBy, note: 'Created', createdAt: d.createdAt }]
        : []
      return Promise.resolve(clone([...extra, ...base]))
    },
    graph: (): Promise<DocGraph> => {
      const docs = store.docs.filter((d) => !d.hidden)
      const nodes: DocGraph['nodes'] = docs.map((d) => ({
        id: d.id,
        title: d.title,
        area: d.area,
        kind: d.kind,
        by: d.createdBy.startsWith('operator:') ? 'team' : 'agents',
        updatedAt: d.updatedAt,
        excerpt: d.content.split('\n')[0].slice(0, 160),
      }))
      const edges: DocGraph['edges'] = []
      const goalNodes = new Map<string, DocGraph['nodes'][number]>()
      for (const d of docs) {
        for (const t of wikilinks(d.content)) {
          const target = docs.find((x) => x.title.toLowerCase() === t.toLowerCase())
          if (target && target.id !== d.id) {
            edges.push({ from: d.id, to: target.id })
            continue
          }
          const g = goals.find((x) => x.title.toLowerCase() === t.toLowerCase())
          if (g) {
            goalNodes.set(`goal:${g.id}`, { id: `goal:${g.id}`, title: g.title, area: null, kind: 'goal', by: 'team' })
            edges.push({ from: d.id, to: `goal:${g.id}` })
          }
        }
      }
      return Promise.resolve(clone({ nodes: [...nodes, ...goalNodes.values()], edges }))
    },
  },
  lessons: {
    list: (params?: { status?: 'review' | 'active' }) =>
      Promise.resolve(clone(params?.status ? store.lessons.filter((l) => l.status === params.status) : store.lessons)),
  },
  handbook: {
    index: (): Promise<HandbookIndex> => {
      refreshHandbookCounts()
      return Promise.resolve(
        clone({
          files: store.handbook.map(({ content: _c, versions: _v, suggestions: _s, ...f }) => f),
          openSuggestions: store.suggestions.filter((s) => s.status === 'open').length,
        }),
      )
    },
    file: (name: string) => {
      refreshHandbookCounts()
      const f = store.handbook.find((x) => x.name.toLowerCase() === name.toLowerCase() || x.name.toLowerCase() === `${name.toLowerCase()}.md`)
      return Promise.resolve(f ? clone(f) : null)
    },
    suggestions: (params?: { file?: string; status?: string }) => {
      const status = params?.status ?? 'open'
      return Promise.resolve(clone(store.suggestions.filter((s) => s.status === status && (!params?.file || s.file === params.file))))
    },
  },
  /** Sources list used by mockRepos.knowledge.sources. */
  sources: () => Promise.resolve(clone(store.sources)),
}

// ── Commands ─────────────────────────────────────────────────────────────────

function lessonOrThrow(id: string): Lesson {
  const l = store.lessons.find((x) => x.id === id)
  if (!l) throw new Error('Not found')
  return l
}

function suggestionOrThrow(id: string): HandbookSuggestion {
  const s = store.suggestions.find((x) => x.id === id)
  if (!s) throw new Error('Not found')
  return s
}

export const mockDocsCommands = {
  /** Called by mock createDoc so new docs show up in the list. */
  addDoc(input: { id: string; title: string; content: string; kind?: string; area?: string }): void {
    store.docs.unshift(
      doc(input.id, input.title, input.area ?? null, input.content, {
        kind: input.kind ?? 'doc',
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedBy: 'operator:usr-demo',
        createdBy: 'operator:usr-demo',
      }),
    )
  },
  /** Called by mock updateDoc. */
  setContent(id: string, content: string): void {
    void mockDocsCommands.patchDoc(id, { content })
  },
  patchDoc(id: string, p: PatchDocInput): Promise<DocSummary> {
    const d = store.docs.find((x) => x.id === id)
    if (!d) return Promise.reject(new Error('Not found'))
    const textChanged = (p.content !== undefined && p.content !== d.content) || (p.title !== undefined && p.title !== d.title)
    if (p.content !== undefined) d.content = p.content
    if (p.title !== undefined && p.title.trim()) d.title = p.title.trim()
    if (p.pinned !== undefined) d.pinned = p.pinned
    if (p.area !== undefined) d.area = p.area || null
    if (p.hidden !== undefined) d.hidden = p.hidden
    if (textChanged) {
      d.version += 1
      d.updatedAt = new Date().toISOString()
      d.updatedBy = 'operator:usr-demo'
      store.versions[id] = [
        { id: nid('mdv'), version: d.version, title: d.title, updatedBy: 'operator:usr-demo', note: null, createdAt: d.updatedAt },
        ...(store.versions[id] ?? []),
      ]
    }
    return Promise.resolve(clone(d))
  },
  deleteDoc(id: string): Promise<void> {
    store.docs = store.docs.filter((d) => d.id !== id)
    return Promise.resolve()
  },
  addKnowledgeSource(input: AddKnowledgeSourceInput): Promise<KbSource> {
    const src: KbSource = {
      id: nid('kbs'),
      companyId: 'cmp-demo',
      kind: input.kind,
      ref: input.ref,
      title: input.title,
      contentHash: String(input.body.length),
      helperId: null,
      chunks: Math.max(1, input.body.split(/\n\s*\n/).filter((p) => p.trim()).length),
      createdAt: new Date().toISOString(),
    }
    store.sources.unshift(src)
    return Promise.resolve(clone(src))
  },
  deleteKnowledgeSource(id: string): Promise<void> {
    store.sources = store.sources.filter((s) => s.id !== id)
    return Promise.resolve()
  },
  createLesson(input: CreateLessonInput): Promise<Lesson> {
    const l: Lesson = {
      id: nid('les'),
      helperId: input.helperId ?? null,
      tag: input.tag ?? (input.helperId ? 'lesson' : 'fact'),
      text: input.text.trim(),
      source: 'You taught it',
      status: 'active',
      createdBy: 'operator:usr-demo',
      createdAt: new Date().toISOString(),
    }
    store.lessons.unshift(l)
    return Promise.resolve(clone(l))
  },
  updateLesson(id: string, p: { text?: string; tag?: Lesson['tag'] }): Promise<Lesson> {
    const l = lessonOrThrow(id)
    if (p.text?.trim()) l.text = p.text.trim()
    if (p.tag) l.tag = p.tag
    return Promise.resolve(clone(l))
  },
  confirmLesson(id: string): Promise<Lesson> {
    const l = lessonOrThrow(id)
    l.status = 'active'
    return Promise.resolve(clone(l))
  },
  forgetLesson(id: string): Promise<void> {
    store.lessons = store.lessons.filter((l) => l.id !== id)
    return Promise.resolve()
  },
  ask(q: string): Promise<AskAnswer> {
    const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 3)
    const score = (text: string) => words.filter((w) => text.toLowerCase().includes(w)).length
    const pool = [
      ...store.docs.map((d) => ({ kind: 'doc', title: d.title, text: d.content, docId: d.id as string | null, ref: d.path })),
      ...store.handbook.map((f) => ({ kind: 'handbook', title: f.name, text: f.content, docId: f.id as string | null, ref: `Handbook/${f.name}` })),
    ]
    const hits = pool
      .map((p) => ({ ...p, s: score(`${p.title} ${p.text}`) }))
      .filter((p) => p.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 4)
    const citations = hits.map((h, i) => ({
      n: i + 1, sourceId: `src-${h.docId}`, kind: h.kind, title: h.title, heading: '', text: h.text.slice(0, 400), ref: h.ref, docId: h.docId,
    }))
    const answer = citations.length
      ? `${citations[0].text.replace(/[#*[\]]/g, '').split(/(?<=[.!?])\s+/).slice(0, 2).join(' ')} [1]`
      : 'I couldn’t find anything about that in your docs yet.'
    return Promise.resolve({ answer, citations, memorySearched: false })
  },
  saveHandbookFile(name: string, input: SaveHandbookFileInput): Promise<HandbookFileDetail> {
    const norm = name.toLowerCase().endsWith('.md') ? name : `${name}.md`
    let f = store.handbook.find((x) => x.name.toLowerCase() === norm.toLowerCase())
    const at = new Date().toISOString()
    if (!f) {
      f = hb(norm.toUpperCase().replace('.MD', '.md'), input.title ?? norm.replace(/\.md$/i, ''), input.description ?? '', input.content, {
        updatedAt: at,
        visibility: input.visibility ?? 'everyone',
        versions: [{ version: 1, updatedBy: 'operator:usr-demo', note: 'Created', createdAt: at }],
      })
      f.id = nid('hb')
      store.handbook.push(f)
      return Promise.resolve(clone(f))
    }
    if (input.title) f.title = input.title
    if (input.description !== undefined) f.description = input.description
    if (input.visibility) f.visibility = input.visibility
    if (input.content !== f.content) {
      f.content = input.content
      f.version += 1
      f.updatedAt = at
      f.updatedBy = 'operator:usr-demo'
      f.versions = [{ version: f.version, updatedBy: 'operator:usr-demo', note: input.note ?? null, createdAt: at }, ...f.versions]
    }
    return Promise.resolve(clone(f))
  },
  suggestHandbookEdit(input: SuggestHandbookEditInput): Promise<HandbookSuggestion> {
    const f = store.handbook.find((x) => x.name === input.file)
    if (!f) return Promise.reject(new Error('Not found'))
    const s: HandbookSuggestion = {
      id: nid('hbs'),
      docId: f.id,
      file: f.name,
      helperId: null,
      author: 'Demo',
      text: input.text,
      proposedContent: input.proposedContent ?? null,
      status: 'open',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    }
    store.suggestions.unshift(s)
    return Promise.resolve(clone(s))
  },
  acceptHandbookSuggestion(id: string): Promise<HandbookSuggestion> {
    const s = suggestionOrThrow(id)
    const f = store.handbook.find((x) => x.id === s.docId)
    if (f && s.proposedContent != null) {
      void mockDocsCommands.saveHandbookFile(f.name, { content: s.proposedContent, note: `Accepted from ${s.author}` })
    }
    s.status = 'accepted'
    s.resolvedAt = new Date().toISOString()
    return Promise.resolve(clone(s))
  },
  dismissHandbookSuggestion(id: string): Promise<HandbookSuggestion> {
    const s = suggestionOrThrow(id)
    s.status = 'dismissed'
    s.resolvedAt = new Date().toISOString()
    return Promise.resolve(clone(s))
  },
}
