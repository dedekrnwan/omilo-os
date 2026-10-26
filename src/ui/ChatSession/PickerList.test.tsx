import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PickerList } from './ComposerPopovers'
import { buildItems } from './composerModel'

const items = buildItems('mention') // Chief, Builder, Grower, Support, Rina Ayu, Budi Santoso

describe('PickerList', () => {
  test('renders a row per item', () => {
    render(<PickerList kind="mention" items={items} activeIndex={0} onSelect={() => {}} onHover={() => {}} />)
    expect(screen.getByText('Chief of Staff')).toBeInTheDocument()
    expect(screen.getByText('Builder')).toBeInTheDocument()
  })

  test('marks the active row with aria-selected', () => {
    render(<PickerList kind="mention" items={items} activeIndex={1} onSelect={() => {}} onHover={() => {}} />)
    const rows = screen.getAllByRole('option')
    expect(rows[1]).toHaveAttribute('aria-selected', 'true')
    expect(rows[0]).toHaveAttribute('aria-selected', 'false')
  })

  test('clicking a row selects that item', async () => {
    const onSelect = vi.fn()
    render(<PickerList kind="mention" items={items} activeIndex={0} onSelect={onSelect} onHover={() => {}} />)
    await userEvent.click(screen.getByText('Builder'))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'Builder' }))
  })

  test('empty items renders a no-results message', () => {
    render(<PickerList kind="mention" items={[]} activeIndex={0} onSelect={() => {}} onHover={() => {}} />)
    expect(screen.getByText(/no matches/i)).toBeInTheDocument()
  })
})
