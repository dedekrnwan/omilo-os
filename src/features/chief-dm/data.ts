/**
 * Static copy for the Chief DM drawer (pen ozMOv · pHj0k · nkqAN · N30qNb · hM9k9).
 * Threads, messages and nudges are live: private Chief chats are sessions with
 * kind='chief_private'; nudges come from GET /v1/chief/nudges.
 */

export interface ChiefMessage {
  id: string
  kind: 'user' | 'chief'
  text: string
  time: string
  /** Optimistic message still being sent. */
  pending?: boolean
}

export const QUICK_PROMPTS = ['What needs me today?', 'What am I forgetting?', 'Brain-dump'] as const

export const THREADS_NOTE =
  'Chief never posts these to a channel or acts on them unless you ask. Delete any chat any time.'
