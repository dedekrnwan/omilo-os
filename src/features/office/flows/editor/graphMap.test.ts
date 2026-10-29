import { describe, expect, test, vi } from 'vitest'
import { fromApiGraph, toApiGraph } from './graphMap'
import type { FlowEdge, FlowNode } from './data'
import { DELETE_DELAY_MS, flowToCard, sparkBars, useFlowBoard } from '../boardStore'

const NODES: FlowNode[] = [
  { id: 't', kind: 'trigger', x: 10, y: 20, kindLabel: 'TRIGGER', source: 'GitHub', title: 'Deploy fails', desc: 'on main', app: 'github', config: { branch: 'main' } },
  { id: 'a', kind: 'ai', x: 10, y: 160, kindLabel: 'AI STEP', source: 'Ops', title: 'Read logs', helper: 'ops' },
  { id: 'c', kind: 'if', x: 30, y: 300, kindLabel: 'IF', title: 'If P1' },
  { id: 'ok', kind: 'approval', x: 10, y: 400, kindLabel: 'APPROVAL', source: 'Inbox', title: 'You approve', app: 'inbox' },
]
const EDGES: FlowEdge[] = [
  { from: 't', to: 'a', plus: true },
  { from: 'a', to: 'c' },
  { from: 'c', to: 'ok', branch: 'yes', via: 380 },
]

describe('graphMap', () => {
  test('editor → API uses engine kinds and Yes/No labels', () => {
    const api = toApiGraph(NODES, EDGES, { a: { instructionsLead: 'Use', input: 'x', instructions: 'Find the cause', returns: [], guardrails: [], costNote: '' } })
    expect(api.nodes.map((n) => n.kind)).toEqual(['trigger', 'ai_step', 'condition', 'approval'])
    expect(api.nodes[1].config?.brief).toBe('Find the cause')
    expect(api.edges[2]).toMatchObject({ from: 'c', to: 'ok', label: 'Yes', via: 380 })
  })

  test('round trip is lossless', () => {
    const ai = { a: { instructionsLead: 'Use', input: 'x', instructions: 'Find', returns: ['r'], guardrails: [], costNote: '' } }
    const api = toApiGraph(NODES, EDGES, ai)
    const back = fromApiGraph(api.nodes, api.edges)
    expect(back.nodes).toEqual(NODES)
    expect(back.edges).toEqual(EDGES)
    expect(back.ai).toEqual(ai)
  })

  test('nodes written by the backend (no ui block) still render', () => {
    const g = fromApiGraph([{ id: 'n1', kind: 'ai_step', label: 'Compile digest' }], [{ from: 'n1', to: 'missing' }])
    expect(g.nodes[0]).toMatchObject({ kind: 'ai', title: 'Compile digest', kindLabel: 'AI STEP' })
    expect(g.edges).toEqual([])
  })
})

describe('board', () => {
  test('sparkline bars scale run counts and keep empty days at 0', () => {
    expect(sparkBars([0, 1, 2, 4, 0, 0, 0])).toEqual([0, 1, 3, 5, 0, 0, 0])
  })

  test('card status and chain icons come from the API extras', () => {
    const card = flowToCard({
      id: 'f', title: 'F', status: 'published', enabled: true, count: 3, areas: [], createdAt: null,
      apps: ['github', 'slack'], aiSteps: 2, runs7d: [0, 0, 0, 0, 0, 0, 1], publishState: 'pending',
    })
    expect(card.from).toBe('github')
    expect(card.to).toBe('slack')
    expect(card.count).toBe(2)
    expect(card.statusLabel).toBe('Waiting for approval')
  })

  test('delete waits out the undo window; restore cancels it', () => {
    vi.useFakeTimers()
    const commit = vi.fn()
    useFlowBoard.getState().scheduleDelete('a', commit)
    expect(useFlowBoard.getState().deleted).toContain('a')
    useFlowBoard.getState().restore('a')
    vi.advanceTimersByTime(DELETE_DELAY_MS + 10)
    expect(commit).not.toHaveBeenCalled()
    useFlowBoard.getState().scheduleDelete('b', commit)
    vi.advanceTimersByTime(DELETE_DELAY_MS + 10)
    expect(commit).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
