/**
 * Onboarding interview client (steps "Get to know you", "Check", "Your team").
 *
 * Live mode talks to the API:
 *   GET  /v1/onboarding/interview          state
 *   POST /v1/onboarding/interview/stream   one turn, SSE (activity · text · note · done · error)
 *   PUT  /v1/onboarding/notes/{topic}      edit a note
 *   POST /v1/onboarding/team-plan          the helpers that fit
 * Mock mode runs a small offline practice interview so the screens still work.
 */
import { apiFetch } from '../../adapters/http/client'
import { postSse } from '../../adapters/http/sse'
import { platform } from '../../platform'
import type { HelperArea } from '../../core/domain/types'

export type TopicId = 'company' | 'customers' | 'goals' | 'offer' | 'rules' | 'systems' | 'voice'
export const TOPIC_IDS: TopicId[] = ['company', 'customers', 'goals', 'offer', 'rules', 'systems', 'voice']

export interface FilePayload {
  name: string
  mime: string
  /** Base64-encoded file content — no `data:` prefix. */
  data: string
}

export interface AttachmentMeta {
  name: string
  mime?: string
  size?: number
}

export interface InterviewEntry {
  role: 'owner' | 'ai'
  text: string
  options?: string[]
  attachment?: AttachmentMeta
}

export interface InterviewView {
  history: InterviewEntry[]
  topic: TopicId | 'finish' | null
  notes: Partial<Record<TopicId | 'extra', string>>
  coverage: { id: TopicId; label: string; done: boolean }[]
  options: string[]
  website: string
  /** Topics whose note is Chief's own proposal — Check asks the owner to check them. */
  suggested?: TopicId[]
  /** Minutes from the first to the latest answer, for "Took 9 minutes". */
  took_min?: number | null
  ai: { label: string; practice: boolean }
}

export interface TurnHandlers {
  onText?: (delta: string) => void
  onActivity?: (label: string) => void
  onNote?: (topic: TopicId, content: string) => void
  onDone?: (view: InterviewView) => void
  onError?: (message: string) => void
}

export interface PlannedHelper {
  id: string
  base: string
  name: string
  area: HelperArea
  role: string
  description: string
  reason: string
  on: boolean
}

const live = () => import.meta.env.VITE_USE_HTTP === '1'
const base = () => import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const token = () => platform.tokenStorage.getToken()

export async function getInterview(): Promise<InterviewView> {
  if (!live()) return mock.view()
  const res = await apiFetch(`${base()}/v1/onboarding/interview`, token)
  return (await res.json()) as InterviewView
}

export async function interviewTurn(
  body: { message?: string; website?: string; restart?: boolean; file?: FilePayload },
  h: TurnHandlers,
  signal?: AbortSignal,
): Promise<void> {
  if (!live()) {
    const attachment: AttachmentMeta | undefined = body.file
      ? { name: body.file.name, mime: body.file.mime }
      : undefined
    return mock.turn(body.message ?? (attachment ? `📎 ${attachment.name}` : ''), h, attachment)
  }
  let finished = false
  try {
    await postSse(
      `${base()}/v1/onboarding/interview/stream`,
      body,
      token,
      (event, data) => {
        const d = (data ?? {}) as Record<string, unknown>
        if (event === 'text') h.onText?.(String(d.delta ?? ''))
        else if (event === 'activity') h.onActivity?.(String(d.label ?? ''))
        else if (event === 'note') h.onNote?.(d.topic as TopicId, String(d.content ?? ''))
        else if (event === 'done') {
          finished = true
          h.onDone?.(d as unknown as InterviewView)
        } else if (event === 'error') {
          finished = true
          h.onError?.(String(d.message ?? 'Chief couldn’t answer'))
        }
      },
      signal,
    )
    if (!finished) h.onError?.('The answer was cut off — try again.')
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return
    h.onError?.(e instanceof Error ? e.message : 'Couldn’t reach Omilo')
  }
}

export async function saveNote(topic: TopicId | 'extra', content: string): Promise<InterviewView> {
  if (!live()) return mock.save(topic, content)
  const res = await apiFetch(`${base()}/v1/onboarding/notes/${topic}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  return (await res.json()) as InterviewView
}

export async function planTeam(): Promise<{ helpers: PlannedHelper[]; by: 'ai' | 'rules' }> {
  if (!live()) return { helpers: mock.team(), by: 'rules' }
  const res = await apiFetch(`${base()}/v1/onboarding/team-plan`, token, { method: 'POST' })
  return (await res.json()) as { helpers: PlannedHelper[]; by: 'ai' | 'rules' }
}

export interface ProfileSuggestion {
  industry: string
  teamSize: string
  region: string
  currency: string
  picRole: string
}

/**
 * GET /v1/onboarding/company-profile-suggestion — Chief's guess at the company
 * profile (industry, team size, region, currency, your role) from the interview
 * notes. Applied when onboarding finishes; editable later in Company settings.
 * Best-effort: any failure (incl. 401) resolves to empty, so a missing
 * suggestion never blocks the step or logs the owner out mid-onboarding.
 */
export async function getProfileSuggestion(): Promise<ProfileSuggestion> {
  const empty: ProfileSuggestion = { industry: '', teamSize: '', region: '', currency: '', picRole: '' }
  if (!live()) return empty
  try {
    const res = await apiFetch(`${base()}/v1/onboarding/company-profile-suggestion`, token)
    return { ...empty, ...((await res.json()) as Partial<ProfileSuggestion>) }
  } catch {
    return empty
  }
}

/**
 * Read a File as a base64-encoded FilePayload (no `data:` prefix).
 * Uses chunked String.fromCharCode to avoid call-stack overflow on large files.
 */
export async function readFileBase64(file: File): Promise<FilePayload> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return {
    name: file.name,
    mime: file.type || 'application/octet-stream',
    data: btoa(binary),
  }
}

// ── offline practice interview (mock mode) ───────────────────────────────────

const LABELS: Record<TopicId, string> = {
  company: 'Company', customers: 'Customers', goals: 'Goals', offer: 'Offer', rules: 'Rules', systems: 'Systems', voice: 'Voice',
}
const ASK: Record<TopicId, string> = {
  company: 'What does your company do, and who’s on the team?',
  customers: 'Who are your customers?',
  goals: 'What would make the next 3 months a win?',
  offer: 'What do you sell, and for how much?',
  rules: 'What should your helpers never do without asking you?',
  systems: 'Which tools do you run the business on?',
  voice: 'How should your helpers sound when they write for you?',
}

const mock = (() => {
  let state: InterviewView = {
    history: [], topic: 'company', notes: {}, coverage: [], options: [], website: '',
    ai: { label: 'Practice mode', practice: true },
  }
  let started: number | null = null
  const cov = () => TOPIC_IDS.map((id) => ({ id, label: LABELS[id], done: Boolean(state.notes[id]?.trim()) }))
  const view = (): InterviewView => ({ ...state, coverage: cov() })
  return {
    view: async () => view(),
    save: async (topic: TopicId | 'extra', content: string) => {
      state = { ...state, notes: { ...state.notes, [topic]: content } }
      return view()
    },
    turn: async (message: string, h: TurnHandlers, attachment?: AttachmentMeta) => {
      const now = Date.now()
      started ??= now
      const hasOwnerContent = Boolean(message.trim() || attachment)
      if (hasOwnerContent) state = { ...state, took_min: Math.max(1, Math.round((now - started) / 60000)) }
      const asked = state.topic && state.topic !== 'finish' ? state.topic : 'company'
      const history = [...state.history]
      if (hasOwnerContent) {
        const ownerText = attachment ? `📎 ${attachment.name}` : message.trim()
        const entry: InterviewEntry = { role: 'owner', text: ownerText }
        if (attachment) entry.attachment = attachment
        history.push(entry)
        // Only record a typed answer into notes — a file upload is not a topic answer.
        if (!attachment && message.trim()) {
          state = { ...state, notes: { ...state.notes, [asked]: message.trim() } }
          h.onNote?.(asked, message.trim())
        }
      }
      const next = hasOwnerContent && !attachment
        ? TOPIC_IDS.find((t) => !state.notes[t]?.trim()) ?? 'finish'
        : asked
      const reply = next === 'finish' ? 'Thank you — that’s everything I need.' : (hasOwnerContent ? 'Got it. ' : 'Hi! I’m Chief. ') + ASK[next]
      h.onText?.(reply)
      history.push({ role: 'ai', text: reply, options: [] })
      state = { ...state, history, topic: next }
      h.onDone?.(view())
    },
    team: (): PlannedHelper[] => [
      { id: 'grower', base: 'grower', name: 'Grower', area: 'marketing', role: 'growth & marketing',
        description: 'Content, campaigns and a weekly growth review.', reason: 'Growth and content', on: true },
      { id: 'support', base: 'support', name: 'Support', area: 'support', role: 'customer support',
        description: 'Answers customers in your voice; anything unusual comes to you.', reason: 'Customers reach you on chat', on: true },
    ],
  }
})()

// ── Is an AI ready? (Your AI → interview gate) ───────────────────────────────

export interface AiStatus {
  ready: boolean
  label: string
  pooled: boolean
  mode: 'local' | 'cloud'
  reason: string | null
}

/** GET /v1/onboarding/ai-status — a connected account, or Omilo Cloud with credits. */
export async function getAiStatus(): Promise<AiStatus> {
  if (!live()) return { ready: true, label: 'Practice mode', pooled: false, mode: 'local', reason: null }
  const res = await apiFetch(`${base()}/v1/onboarding/ai-status`, token)
  return (await res.json()) as AiStatus
}
