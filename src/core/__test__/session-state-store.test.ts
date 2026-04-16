import { describe, expect, it } from 'vitest'
import { SessionStateStore } from '../session-state-store'

describe('SessionStateStore', () => {
  it('tracks selected tabs independently per session', () => {
    const store = new SessionStateStore()

    store.setSelectedTab('session-a', 11)
    store.setSelectedTab('session-b', 22)

    expect(store.getSelectedTab('session-a')).toBe(11)
    expect(store.getSelectedTab('session-b')).toBe(22)
  })

  it('clears only the targeted session state', () => {
    const store = new SessionStateStore()

    store.setSelectedTab('session-a', 11)
    store.setSelectedTab('session-b', 22)
    store.clearSession('session-a')

    expect(store.getSelectedTab('session-a')).toBeNull()
    expect(store.getSelectedTab('session-b')).toBe(22)
  })
})
