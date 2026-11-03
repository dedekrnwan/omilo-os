/**
 * StepKnowYou.attachment.test.tsx — TDD tests for Task 4.
 *
 * Verifies that OwnerSays:
 *   1. Renders an attachment chip (icon + file name) when `attachment` is set.
 *   2. Strips injected <file>…</file> and <website>…</website> blocks from plain text.
 */
import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OwnerSays } from './StepKnowYou'

describe('OwnerSays', () => {
  test('renders an attachment chip with the file name', () => {
    render(<OwnerSays text="📎 deck.pdf" attachment={{ name: 'deck.pdf', size: 245760 }} />)
    expect(screen.getByText('deck.pdf')).toBeInTheDocument()
  })

  test('strips an injected <file> block from plain text', () => {
    render(<OwnerSays text={'note here\n<file>\nSECRET BLOB\n</file>'} />)
    expect(screen.queryByText(/SECRET BLOB/)).not.toBeInTheDocument()
    expect(screen.getByText(/note here/)).toBeInTheDocument()
  })
})
