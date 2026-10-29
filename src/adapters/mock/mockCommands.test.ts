/**
 * Behavioural tests for the mock Commands client: each mutation mutates the
 * shared in-memory fixture and resolves with a plausibly-shaped object, so the
 * default offline app reflects creates/deletes on the next repos read.
 */

import { describe, it, expect } from 'vitest'
import { createMockCommands } from './mockCommands'
import { goals, routines, flows, helpers, members } from './fixtures'

describe('createMockCommands', () => {
  it('createGoal appends to the goals fixture and resolves the new goal', async () => {
    const before = goals.length
    const commands = createMockCommands()
    const goal = await commands.createGoal({ channelId: 'ch-general', title: 'Mock goal', target: 'Q4' })
    expect(goal.title).toBe('Mock goal')
    expect(goal.channelId).toBe('ch-general')
    expect(goals.length).toBe(before + 1)
    expect(goals.some(g => g.id === goal.id)).toBe(true)
  })

  it('deleteGoal removes the goal from the fixture', async () => {
    const commands = createMockCommands()
    const goal = await commands.createGoal({ channelId: 'ch-general', title: 'Temp', target: 't' })
    const before = goals.length
    await commands.deleteGoal(goal.id)
    expect(goals.length).toBe(before - 1)
    expect(goals.some(g => g.id === goal.id)).toBe(false)
  })

  it('createRoutine appends a routine and updateRoutine mutates it', async () => {
    const commands = createMockCommands()
    const r = await commands.createRoutine({ helperId: 'h-chief', name: 'Mock', instructions: 'do', freq: 'daily', at: '08:00' })
    expect(routines.some(x => x.id === r.id)).toBe(true)
    const updated = await commands.updateRoutine(r.id, { paused: true, name: 'Renamed' })
    expect(updated.paused).toBe(true)
    expect(updated.name).toBe('Renamed')
  })

  it('skipRoutineNext resolves {nextAt}', async () => {
    const commands = createMockCommands()
    const r = await commands.createRoutine({ helperId: 'h-chief', name: 'Mock', instructions: 'do', freq: 'daily', at: '08:00' })
    const res = await commands.skipRoutineNext(r.id)
    expect(res).toHaveProperty('nextAt')
  })

  it('createFlow / duplicateFlow append to the flows fixture; deleteFlow removes', async () => {
    const commands = createMockCommands()
    const f = await commands.createFlow({ trigger: { kind: 'manual', spec: {} }, nodes: [{}], edges: [] })
    expect(flows.some(x => x.id === f.id)).toBe(true)
    const dup = await commands.duplicateFlow({ title: f.title, trigger: f.trigger!, nodes: f.nodes!, edges: f.edges! })
    expect(dup.id).not.toBe(f.id)
    const before = flows.length
    await commands.deleteFlow(f.id)
    expect(flows.length).toBe(before - 1)
  })

  it('createHelper appends and updateHelper mutates', async () => {
    const commands = createMockCommands()
    const h = await commands.createHelper({ name: 'Mock', area: 'dev', role: 'Eng' })
    expect(helpers.some(x => x.id === h.id)).toBe(true)
    const updated = await commands.updateHelper(h.id, { status: 'paused' })
    expect(updated.status).toBe('paused')
  })

  it('changeMemberRole mutates and removeMember removes from the fixture', async () => {
    const commands = createMockCommands()
    const existing = members[0]
    const updated = await commands.changeMemberRole(existing.id, 'viewer')
    expect(updated.role).toBe('viewer')
    const before = members.length
    await commands.removeMember(existing.id)
    expect(members.length).toBe(before - 1)
  })

  it('getCompanySettings/updateCompanySettings deep-merges partials without clobbering siblings', async () => {
    const commands = createMockCommands()
    await commands.updateCompanySettings({ safety: { autonomy: 'yolo' } })
    await commands.updateCompanySettings({ notifications: { email: true } })
    const settings = await commands.getCompanySettings()
    expect((settings.safety as Record<string, unknown>).autonomy).toBe('yolo')
    expect((settings.notifications as Record<string, unknown>).email).toBe(true)
  })

  it('createDoc and updateDoc resolve a MemoryDoc', async () => {
    const commands = createMockCommands()
    const doc = await commands.createDoc({ title: 'Doc', content: 'body' })
    expect(doc.title).toBe('Doc')
    const updated = await commands.updateDoc(doc.id, 'new body')
    expect(updated.content).toBe('new body')
  })

  it('checkAiAccounts / testAiAccount resolve', async () => {
    const commands = createMockCommands()
    await expect(commands.checkAiAccounts()).resolves.toBeDefined()
    await expect(commands.testAiAccount('acc_1')).resolves.toBeDefined()
  })

  it('deleteCompany resolves void', async () => {
    const commands = createMockCommands()
    await expect(commands.deleteCompany()).resolves.toBeUndefined()
  })
})
