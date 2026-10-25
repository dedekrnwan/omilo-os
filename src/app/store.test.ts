import { describe, test, expect, beforeEach } from 'vitest'
import { useUIStore } from './store'

describe('UIStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useUIStore.setState({
      mode: 'chat',
      areaId: null,
      lastPath: { chat: '', office: '' },
    })
  })

  test('areaId defaults to null (All areas)', () => {
    expect(useUIStore.getState().areaId).toBe(null)
  })

  test('setArea updates the selected area and back to null', () => {
    useUIStore.getState().setArea('ch-engineering')
    expect(useUIStore.getState().areaId).toBe('ch-engineering')
    useUIStore.getState().setArea(null)
    expect(useUIStore.getState().areaId).toBe(null)
  })

  test('toggleTarget from chat returns office mode with defaultPath when office never visited', () => {
    const result = useUIStore.getState().toggleTarget()
    expect(result.mode).toBe('office')
    expect(result.path).toBe('/office/inbox')
  })

  test('toggleTarget returns remembered path after rememberPath called', () => {
    useUIStore.getState().rememberPath('office', '/office/inbox/x')
    const result = useUIStore.getState().toggleTarget()
    expect(result.mode).toBe('office')
    expect(result.path).toBe('/office/inbox/x')
  })

  test('toggleTarget never returns empty or undefined path', () => {
    // From default state — toggling to office (no remembered path)
    const result1 = useUIStore.getState().toggleTarget()
    expect(result1.path).toBeTruthy()

    // Now from office mode with no chat remembered path
    useUIStore.setState({ mode: 'office', lastPath: { chat: '', office: '' } })
    const result2 = useUIStore.getState().toggleTarget()
    expect(result2.path).toBeTruthy()
    expect(result2.mode).toBe('chat')
  })
})
