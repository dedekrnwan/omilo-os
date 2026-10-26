import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextMenuArea, MoreMenu } from './ItemMenu'
import type { MenuEntries } from './ItemMenu'

function setup() {
  const rename = vi.fn()
  const remove = vi.fn()
  const items: MenuEntries = [
    { label: 'Rename', onSelect: rename },
    false,
    { type: 'separator' },
    { type: 'separator' },
    { label: 'Delete', danger: true, onSelect: remove },
    { type: 'separator' },
  ]
  render(
    <>
      <ContextMenuArea items={items} label="Row actions">
        <div data-testid="row">
          Row <input aria-label="field" />
        </div>
      </ContextMenuArea>
      <MoreMenu items={items} label="Row options" />
    </>,
  )
  return { rename, remove }
}

describe('ItemMenu', () => {
  test('right-click opens the same items as the ⋯ button', async () => {
    const user = userEvent.setup()
    const { rename } = setup()
    fireEvent.contextMenu(screen.getByTestId('row'))
    const menu = await screen.findByRole('menu', { name: 'Row actions' })
    expect(menu).toHaveTextContent('Rename')
    expect(menu).toHaveTextContent('Delete')
    // stray separators are dropped
    expect(menu.querySelectorAll('.h-px')).toHaveLength(1)
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(rename).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Row options' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
  })

  test('text fields keep the browser menu', () => {
    setup()
    fireEvent.contextMenu(screen.getByRole('textbox', { name: 'field' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
