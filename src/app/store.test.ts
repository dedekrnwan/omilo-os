import { describe, test, expect, beforeEach } from 'vitest'
import { useUIStore, MODE_HOME } from './store'

describe('UIStore', () => {
  beforeEach(() => {
    useUIStore.setState({ mode: 'chat', areaId: null, companyId: 'sahabat-warga', autonomy: 'ask' })
  })

  test('autonomy defaults to "ask"', () => {
    expect(useUIStore.getState().autonomy).toBe('ask')
  })

  test('setAutonomy updates and persists the level', () => {
    useUIStore.getState().setAutonomy('yolo')
    expect(useUIStore.getState().autonomy).toBe('yolo')
    expect(JSON.parse(localStorage.getItem('omilo-ui') ?? '{}').state.autonomy).toBe('yolo')
    useUIStore.getState().setAutonomy('strict')
    expect(useUIStore.getState().autonomy).toBe('strict')
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

  test('setMode flips the persisted mode', () => {
    expect(useUIStore.getState().mode).toBe('chat')
    useUIStore.getState().setMode('office')
    expect(useUIStore.getState().mode).toBe('office')
    useUIStore.getState().setMode('chat')
    expect(useUIStore.getState().mode).toBe('chat')
  })

  test('MODE_HOME maps each mode to its mode-neutral primary route', () => {
    expect(MODE_HOME.chat).toBe('/chat')
    expect(MODE_HOME.office).toBe('/inbox')
  })

  test('mode persists to localStorage (route-free)', () => {
    useUIStore.getState().setMode('office')
    expect(JSON.parse(localStorage.getItem('omilo-ui') ?? '{}').state.mode).toBe('office')
  })
})
