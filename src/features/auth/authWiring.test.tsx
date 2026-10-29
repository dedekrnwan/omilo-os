import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AuthCheckbox, AuthField, AuthSelect } from './AuthPrimitives'

describe('AuthCheckbox (controlled)', () => {
  test('reflects checked and emits onChange', () => {
    const onChange = vi.fn()
    render(<AuthCheckbox label="Keep me signed in" checked={false} onChange={onChange} />)
    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  test('is uncontrolled when no onChange is passed', () => {
    render(<AuthCheckbox label="Keep me signed in" defaultChecked />)
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  })
})

describe('AuthField (controlled binding)', () => {
  test('emits onChange', () => {
    const onChange = vi.fn()
    render(<AuthField id="f" label="Name" value="a" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'ab' } })
    expect(onChange).toHaveBeenCalled()
  })
})

describe('AuthSelect (controlled)', () => {
  test('emits onChange', () => {
    const onChange = vi.fn()
    render(<AuthSelect id="s" label="Size" value="a" options={['a', 'b']} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'b' } })
    expect(onChange).toHaveBeenCalledWith('b')
  })
})
