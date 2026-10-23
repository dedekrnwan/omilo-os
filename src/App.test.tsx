import { render, screen } from '@testing-library/react'
import App from './App'

test('App renders the root shell landmark', () => {
  render(<App />)
  expect(screen.getByRole('application')).toBeInTheDocument()
})
