import { Bot, GitBranch, Sparkles, SquareTerminal, TextCursor } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Coding-assistant "harnesses" whose subscriptions can be pooled. Unlike direct
 * provider keys (billed per token), these are seat/subscription accounts the
 * agents share — when one hits its rate-limit window, the next job moves to
 * another account in the pool.
 */
export type HarnessId = 'claude-code' | 'codex' | 'copilot' | 'gemini-cli' | 'cursor'

export interface Harness {
  id: HarnessId
  name: string
  icon: LucideIcon
  /** How this harness is authenticated / what a seat buys. */
  blurb: string
}

export const HARNESSES: Harness[] = [
  { id: 'claude-code', name: 'Claude Code', icon: Bot, blurb: 'Claude Pro or Max subscription' },
  { id: 'codex', name: 'Codex', icon: SquareTerminal, blurb: 'ChatGPT Plus, Pro or Team' },
  { id: 'copilot', name: 'GitHub Copilot', icon: GitBranch, blurb: 'Copilot Individual or Business' },
  { id: 'gemini-cli', name: 'Gemini CLI', icon: Sparkles, blurb: 'Google AI Pro or Ultra' },
  { id: 'cursor', name: 'Cursor', icon: TextCursor, blurb: 'Cursor Pro or Business' },
]

export const HARNESS_BY_ID: Record<HarnessId, Harness> = Object.fromEntries(
  HARNESSES.map((h) => [h.id, h]),
) as Record<HarnessId, Harness>
