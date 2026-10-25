import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChatMenu } from './ChatMenu'

function renderMenu(overrides: Record<string, () => void> = {}) {
  const handlers = {
    onRename: vi.fn(),
    onMoveToFolder: vi.fn(),
    onLinkToGoal: vi.fn(),
    onPinToSidebar: vi.fn(),
    onExportMarkdown: vi.fn(),
    onCopyLink: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }

  render(
    <ChatMenu {...handlers} defaultOpen>
      <button type="button" aria-label="More options">…</button>
    </ChatMenu>,
  )

  return handlers
}

describe('ChatMenu — all 8 callbacks fire', () => {
  test('Rename fires onRename', async () => {
    const { onRename } = renderMenu()
    await waitFor(() => screen.getByText('Rename'))
    fireEvent.click(screen.getByText('Rename'))
    expect(onRename).toHaveBeenCalledTimes(1)
  })

  test('Move to folder fires onMoveToFolder', async () => {
    const { onMoveToFolder } = renderMenu()
    await waitFor(() => screen.getByText('Move to folder'))
    fireEvent.click(screen.getByText('Move to folder'))
    expect(onMoveToFolder).toHaveBeenCalledTimes(1)
  })

  test('Link to goal fires onLinkToGoal', async () => {
    const { onLinkToGoal } = renderMenu()
    await waitFor(() => screen.getByText('Link to goal'))
    fireEvent.click(screen.getByText('Link to goal'))
    expect(onLinkToGoal).toHaveBeenCalledTimes(1)
  })

  test('Pin to sidebar fires onPinToSidebar', async () => {
    const { onPinToSidebar } = renderMenu()
    await waitFor(() => screen.getByText('Pin to sidebar'))
    fireEvent.click(screen.getByText('Pin to sidebar'))
    expect(onPinToSidebar).toHaveBeenCalledTimes(1)
  })

  test('Export as Markdown fires onExportMarkdown', async () => {
    const { onExportMarkdown } = renderMenu()
    await waitFor(() => screen.getByText('Export as Markdown'))
    fireEvent.click(screen.getByText('Export as Markdown'))
    expect(onExportMarkdown).toHaveBeenCalledTimes(1)
  })

  test('Copy link fires onCopyLink', async () => {
    const { onCopyLink } = renderMenu()
    await waitFor(() => screen.getByText('Copy link'))
    fireEvent.click(screen.getByText('Copy link'))
    expect(onCopyLink).toHaveBeenCalledTimes(1)
  })

  test('Archive chat fires onArchive', async () => {
    const { onArchive } = renderMenu()
    await waitFor(() => screen.getByText('Archive chat'))
    fireEvent.click(screen.getByText('Archive chat'))
    expect(onArchive).toHaveBeenCalledTimes(1)
  })

  test('Delete chat fires onDelete', async () => {
    const { onDelete } = renderMenu()
    await waitFor(() => screen.getByText('Delete chat'))
    fireEvent.click(screen.getByText('Delete chat'))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  test('ChatMenu renders all 8 items when open', async () => {
    renderMenu()
    await waitFor(() => {
      expect(screen.getByText('Rename')).toBeInTheDocument()
      expect(screen.getByText('Move to folder')).toBeInTheDocument()
      expect(screen.getByText('Link to goal')).toBeInTheDocument()
      expect(screen.getByText('Pin to sidebar')).toBeInTheDocument()
      expect(screen.getByText('Export as Markdown')).toBeInTheDocument()
      expect(screen.getByText('Copy link')).toBeInTheDocument()
      expect(screen.getByText('Archive chat')).toBeInTheDocument()
      expect(screen.getByText('Delete chat')).toBeInTheDocument()
    })
  })
})
