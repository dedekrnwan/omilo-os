import { Bot, GitBranch, Sparkles, SquareTerminal, TerminalSquare, TextCursor } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Coding-assistant "harnesses" whose subscriptions can be pooled. Unlike direct
 * provider keys (billed per token), these are seat/subscription accounts the
 * agents share — when one hits its rate-limit window, the next job moves to
 * another account in the pool.
 *
 * `icon` is a lucide fallback; the real brand mark is rendered via
 * <HarnessLogo id={h.id}> (src/ui/ds/harnessLogos.tsx).
 */
export type HarnessId = 'claude-code' | 'opencode' | 'codex' | 'copilot' | 'gemini-cli' | 'cursor'

export interface Harness {
  id: HarnessId
  name: string
  icon: LucideIcon
  /** Brand accent (used for subtle tile tints). */
  accent: string
  /** How this harness is authenticated / what a seat buys. */
  blurb: string
}

export const HARNESSES: Harness[] = [
  { id: 'claude-code', name: 'Claude Code', icon: Bot, accent: '#D97757', blurb: 'Claude Pro or Max subscription' },
  { id: 'opencode', name: 'OpenCode', icon: TerminalSquare, accent: '#1C1917', blurb: 'BYO provider via the OpenCode CLI' },
  { id: 'codex', name: 'Codex', icon: SquareTerminal, accent: '#0C0A09', blurb: 'ChatGPT Plus, Pro or Team' },
  { id: 'copilot', name: 'GitHub Copilot', icon: GitBranch, accent: '#0C0A09', blurb: 'Copilot Individual or Business' },
  { id: 'gemini-cli', name: 'Gemini CLI', icon: Sparkles, accent: '#7C6CF0', blurb: 'Google AI Pro or Ultra' },
  { id: 'cursor', name: 'Cursor', icon: TextCursor, accent: '#0C0A09', blurb: 'Cursor Pro or Business' },
]

export const HARNESS_BY_ID: Record<HarnessId, Harness> = Object.fromEntries(
  HARNESSES.map((h) => [h.id, h]),
) as Record<HarnessId, Harness>
