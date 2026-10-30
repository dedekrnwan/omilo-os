import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Plus } from 'lucide-react'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  test('shows Chief, the title, the copy and runs the actions', async () => {
    const add = vi.fn()
    const browse = vi.fn()
    render(
      <EmptyState
        size="lg"
        title="No flows yet"
        description="Flows chain your helpers' work."
        primary={{ label: 'New flow', icon: Plus, onClick: add }}
        secondary={{ label: 'Browse templates', onClick: browse }}
      />,
    )
    const box = screen.getByTestId('empty-state')
    expect(box).toHaveTextContent('No flows yet')
    expect(box).toHaveTextContent("Flows chain your helpers' work.")
    expect(screen.getByRole('img', { name: 'Chief of Staff' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'New flow' }))
    await userEvent.click(screen.getByRole('button', { name: 'Browse templates' }))
    expect(add).toHaveBeenCalledOnce()
    expect(browse).toHaveBeenCalledOnce()
  })

  test('compact size renders without actions', () => {
    render(<EmptyState size="sm" title="No files yet" />)
    expect(screen.getByTestId('empty-state')).toHaveTextContent('No files yet')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  test('worried mood is announced as an alert', () => {
    render(<EmptyState mood="worried" title="Couldn't load the graph" />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the graph")
  })
})
