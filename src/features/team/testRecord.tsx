/** Test helpers for the Team feature: a live-shaped helper record + providers. */
import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../app/ReposProvider'
import { CommandsProvider } from '../../app/CommandsProvider'
import { createMockRepos } from '../../adapters/mock/mockRepos'
import type { Commands } from '../../adapters/http/commands'
import type { Repos } from '../../core/ports/repos'
import type { Helper, HelperDetail } from '../../core/domain/types'
import { buildHelperRecord } from './model'
import type { HelperRecord } from './teamData'

export function makeRecord(over: Partial<Helper> = {}, detail?: Partial<HelperDetail>): HelperRecord {
  const helper: Helper = {
    id: 'h-support',
    name: 'Support',
    area: 'support',
    role: 'Support',
    status: 'active',
    isChief: false,
    jobDescription: 'Answer customer questions.',
    loops: 1,
    costMonth: 120,
    ...over,
  }
  return buildHelperRecord(
    helper,
    { helpers: [helper], ownerName: 'Owner', defaultModel: 'Opus 5.5' },
    {
      helper,
      routines: [],
      skills: [],
      counts: { channels: 1, tools: 0, skills: 0, routines: 0 },
      ...detail,
    },
    [
      { name: 'PERSONA.md', description: 'Who it is', docId: null, content: '', updatedAt: null, updatedBy: null },
      { name: 'STYLE.md', description: 'Tone', docId: null, content: '', updatedAt: null, updatedBy: null },
      { name: 'PLAYBOOK.md', description: 'Steps', docId: null, content: '', updatedAt: null, updatedBy: null },
      { name: 'MEMORY.md', description: 'Memory', docId: null, content: '', updatedAt: null, updatedBy: null },
    ],
  )
}

export function renderWithData(ui: ReactNode, opts: { repos?: Repos; commands?: Commands } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ReposProvider repos={opts.repos ?? createMockRepos()}>
        <CommandsProvider commands={opts.commands}>{ui}</CommandsProvider>
      </ReposProvider>
    </QueryClientProvider>,
  )
}
