/** All section ids for the control-panel left nav. */
export type ControlPanelSection =
  | 'general'
  | 'handbook'
  | 'members'
  | 'channels'
  | 'safety'
  | 'ai-engine'
  | 'ai-accounts'
  | 'knowledge'
  | 'connectors'
  | 'mcp-tokens'
  | 'skills'
  | 'usage'
  | 'activity'
  | 'data'
  | 'account'
  | 'notifications'

/**
 * Overlay states. Each is a state of a base section screen (never a route);
 * `?state=<kind>` on /control-panel/$section opens it for review.
 */
export type DialogKind =
  | 'delete-workspace'
  | 'invite'
  | 'seats-full'
  | 'add-seats'
  | 'pay-mayar'
  | 'plan-max'
  | 'connect-key'
  | 'add-harness'
  | 'add-mcp'
  | 'build-oas'
  | 'oas-tools'
  | 'connect-drive'
  | 'write-skill'
  | 'change-plan'
  | null

/** Page variants that change the base screen (not overlays). */
export type PageVariant = 'self-hosted' | 'cloud' | 'policies' | null

export const DIALOG_KINDS: Exclude<DialogKind, null>[] = [
  'delete-workspace', 'invite', 'seats-full', 'add-seats', 'pay-mayar', 'plan-max',
  'connect-key', 'add-harness', 'add-mcp', 'build-oas', 'oas-tools', 'connect-drive', 'write-skill',
  'change-plan',
]
