/**
 * Mock-mode parity (plan Review Focus #1): every HTTP command must have a
 * matching mock implementation, else the default offline app crashes on click.
 *
 * We derive the canonical command name set from a real HTTP Commands client and
 * assert the mock client implements exactly the same keys (as functions).
 */

import { describe, it, expect } from 'vitest'
import { createCommands } from '../http/commands'
import type { Commands } from '../http/commands'
import { createMockCommands } from './mockCommands'

/** Every command the Commands port exposes (keep in sync with the interface). */
const COMMAND_NAMES: (keyof Commands)[] = [
  'createSession',
  'sendMessage',
  'approveProposal',
  'rejectProposal',
  'requestChanges',
  'mintMcpToken',
  'revokeMcpToken',
  'installConnector',
  'updateConnector',
  'connectorCredentials',
  'disconnectConnector',
  'createArea',
  'updateWallet',
  'topup',
  'changePlan',
  'updateCompanyProfile',
  'updateMe',
  'createAiAccount',
  'onboardCompany',
  'publishFlow',
  'runFlow',
  'testRunFlow',
  'runRoutineNow',
  'replanGoal',
  'publishSkill',
  'createGoal',
  'updateGoal',
  'deleteGoal',
  'createRoutine',
  'updateRoutine',
  'deleteRoutine',
  'skipRoutineNext',
  'createFlow',
  'updateFlow',
  'deleteFlow',
  'duplicateFlow',
  'createHelper',
  'updateHelper',
  'changeMemberRole',
  'removeMember',
  'inviteMember',
  'deleteCompany',
  'getCompanySettings',
  'updateCompanySettings',
  'checkAiAccounts',
  'testAiAccount',
  'createDoc',
  'updateDoc',
  // ── sweep/docs ──
  'patchDoc',
  'deleteDoc',
  'addKnowledgeSource',
  'deleteKnowledgeSource',
  'createLesson',
  'updateLesson',
  'confirmLesson',
  'forgetLesson',
  'ask',
  'saveHandbookFile',
  'suggestHandbookEdit',
  'acceptHandbookSuggestion',
  'dismissHandbookSuggestion',
  // ── sweep/goals-routines ──
  'cancelJob',
  'routineRunFeedback',
  'resendRoutineRun',
  'previewRoutine',
  'applyRoutineSuggestion',
  'dismissRoutineSuggestion',
  'openGoalSession',
  // ── sweep/inbox-flows ──
  'markInboxRead',
  'markAllInboxRead',
  'updateProposal',
  'approveProposalAmended',
  'undoApproval',
  'decideFlowRun',
  'retryFlowRun',
  'cancelFlowRun',
  'restoreFlowVersion',
  // ── sweep/team-analytics ──
  'retireHelper',
  'allowHelperJob',
  'connectHelperChannel',
  'updateHelperChannel',
  'disconnectHelperChannel',
  'setHelperTools',
  'setHelperSkills',
  'saveHelperFile',
  'retryJob',
]

describe('mock-mode parity', () => {
  it('mock Commands implements every command the HTTP client does', () => {
    const http = createCommands('http://api.test', () => null)
    const mock = createMockCommands()

    const httpKeys = Object.keys(http).sort()
    const mockKeys = Object.keys(mock).sort()

    expect(mockKeys).toEqual(httpKeys)
  })

  it('every declared command is a function on the mock client', () => {
    const mock = createMockCommands() as unknown as Record<string, unknown>
    for (const name of COMMAND_NAMES) {
      expect(typeof mock[name as string], `mock.${String(name)} must be a function`).toBe('function')
    }
  })

  it('the HTTP client exposes exactly the declared command set', () => {
    const http = createCommands('http://api.test', () => null)
    expect(Object.keys(http).sort()).toEqual([...COMMAND_NAMES].sort())
  })
})
