/**
 * sweep/control — control-panel dialogs render from live data and send the
 * shapes the backend accepts (mock repos + spied mock commands).
 */
import { describe, test, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ReposProvider } from '../../app/ReposProvider'
import { CommandsProvider } from '../../app/CommandsProvider'
import { createMockRepos } from '../../adapters/mock/mockRepos'
import { createMockCommands } from '../../adapters/mock/mockCommands'
import type { Commands } from '../../adapters/http/commands'
import { DialogChangePlan } from './dialogs/DialogChangePlan'
import { DialogBuyCredits } from './dialogs/DialogBuyCredits'
import { DialogInvite } from './dialogs/DialogInvite'
import { SectionMembers } from './sections/SectionMembers'
import { SectionChannels } from './sections/SectionChannels'
import { formatIdrShort, parseIdr } from './format'

function wrap(ui: ReactNode, commands: Commands = createMockCommands()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ReposProvider repos={createMockRepos()}>
        <CommandsProvider commands={commands}>{ui}</CommandsProvider>
      </ReposProvider>
    </QueryClientProvider>,
  )
}

describe('format helpers', () => {
  test('short rupiah matches the designs', () => {
    expect(formatIdrShort(150_000)).toBe('Rp 150 rb')
    expect(formatIdrShort(2_000_000)).toBe('Rp 2 jt')
    expect(formatIdrShort(2_300_000)).toBe('Rp 2,3 jt')
    expect(parseIdr('Rp 200.000')).toBe(200_000)
    expect(parseIdr('2jt')).toBe(2_000_000)
    expect(parseIdr('')).toBeNull()
  })
})

describe('DialogChangePlan', () => {
  test('renders Starter / Team / Business from usePlans and marks the current plan', async () => {
    wrap(<DialogChangePlan onClose={() => {}} />)
    expect(await screen.findByText('Starter')).toBeInTheDocument()
    expect(screen.getByText('Business')).toBeInTheDocument()
    expect(screen.getByText('Rp 499 rb')).toBeInTheDocument()
    expect(screen.getByText(/250 GB for docs, files and knowledge/)).toBeInTheDocument()
    // Mock subscription is a Team trial → Team offers "Subscribe", Business "Upgrade".
    expect(screen.getByRole('button', { name: 'Subscribe' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeInTheDocument()
  })

  test('changing plan sends the catalog plan id', async () => {
    const commands = createMockCommands()
    const spy = vi.spyOn(commands, 'changePlan')
    const user = userEvent.setup()
    wrap(<DialogChangePlan onClose={() => {}} />, commands)
    await user.click(await screen.findByRole('button', { name: 'Upgrade' }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith('plan_business', 'monthly'))
  })
})

describe('DialogBuyCredits', () => {
  test('packs come from the catalog and the topup sends the pack id', async () => {
    const commands = createMockCommands()
    const spy = vi.spyOn(commands, 'topup')
    const user = userEvent.setup()
    wrap(<DialogBuyCredits onClose={() => {}} />, commands)
    expect(await screen.findByText('20,000 credits')).toBeInTheDocument()
    await user.click(screen.getByText('20,000 credits'))
    await user.click(screen.getByRole('button', { name: 'Pay with Mayar' }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith('20000'))
  })

  test('auto top-up toggle updates the wallet', async () => {
    const commands = createMockCommands()
    const spy = vi.spyOn(commands, 'updateWallet')
    const user = userEvent.setup()
    wrap(<DialogBuyCredits onClose={() => {}} />, commands)
    await screen.findByText('5,000 credits')
    await user.click(screen.getByRole('switch', { name: 'Auto top-up' }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ autoTopupEnabled: true })))
  })
})

describe('DialogInvite', () => {
  test('starts empty and sends a channel id list', async () => {
    const commands = createMockCommands()
    const spy = vi.spyOn(commands, 'inviteMember')
    const user = userEvent.setup()
    wrap(<DialogInvite onClose={() => {}} />, commands)
    // No prefilled demo addresses.
    expect(screen.queryByText(/sahabatwarga/)).toBeNull()
    await user.type(screen.getByLabelText('Add email'), 'new@saga.co.id{enter}')
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'Viewer')
    await user.click(screen.getByRole('button', { name: /Channels:/ }))
    await user.click(await screen.findByText('Engineering'))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /Send 1 invite/ }))
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ email: 'new@saga.co.id', role: 'viewer', channels: ['ch-engineering'] }),
    )
  })
})

describe('SectionMembers', () => {
  test('people, channels and pending invites come from the backend — unlimited people, no seats', async () => {
    wrap(<SectionMembers onDialog={() => {}} />)
    expect(await screen.findByText('Team plan · unlimited people, no per-seat fees')).toBeInTheDocument()
    expect(screen.queryByText(/ of \d+ seats|Add seats/)).toBeNull()
    expect(screen.getByText('andi@saga.co.id')).toBeInTheDocument()
    expect(screen.getByText('Engineering, General')).toBeInTheDocument()
  })

  test('Invite people always opens the plain invite on Cloud plans', async () => {
    const onDialog = vi.fn()
    const user = userEvent.setup()
    wrap(<SectionMembers onDialog={onDialog} />)
    await screen.findByText('Team plan · unlimited people, no per-seat fees')
    await user.click(screen.getByRole('button', { name: 'Invite people' }))
    expect(onDialog).toHaveBeenCalledWith('invite')
  })
})

describe('SectionChannels', () => {
  test('lists live channels with archived ones separately', async () => {
    wrap(<SectionChannels />)
    expect(await screen.findByText('Engineering')).toBeInTheDocument()
    expect(screen.getByText('Launch 2025')).toBeInTheDocument()
    expect(screen.getByText(/Archived .* read-only · 62 chats/)).toBeInTheDocument()
  })
})
